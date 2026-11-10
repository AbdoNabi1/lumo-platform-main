import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@platform/http";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { WiredAdmin } from "../composition";
import { publicContentRoutes } from "./public-content-routes";
import { publicOnlineStoreRoutes } from "./public-online-store-routes";
import { buildOnlineStoreApp, headersFor } from "./testing/online-store-harness";

const NOT_STORED = "private, no-store";
let key = 0;

/** Every object key anywhere in a JSON value (arrays and nested objects included). */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
}

describe("the public content route table (spec 2.6)", () => {
  it("is the three public, non-idempotent rows, in their own file", () => {
    const rows = publicContentRoutes({} as WiredAdmin).map((r) => [
      r.method,
      r.path,
      r.public,
      r.idempotent ?? false,
    ]);
    expect(rows).toEqual([
      ["GET", "/public/policies/:type", true, false],
      ["GET", "/public/pages/:handle", true, false],
      ["GET", "/public/pages", true, false],
    ]);
  });

  it("leaves the storefront shell's file to the /public/online-store routes", () => {
    for (const route of publicOnlineStoreRoutes({} as WiredAdmin)) {
      expect(route.path.startsWith("/public/online-store"), route.path).toBe(true);
    }
  });

  it("a Pages failure is an error, never a 404", async () => {
    const down = () => Promise.reject(new Error("pages database unreachable"));
    const admin = {
      publicReads: { pages: { byHandle: down, list: down } },
    } as unknown as WiredAdmin;
    const routes = publicContentRoutes(admin);
    const context = { tenantId: "t-1", requestId: "r-1" } as RequestContext;
    const byHandle = routes.find((r) => r.path === "/public/pages/:handle");
    const list = routes.find((r) => r.path === "/public/pages");
    expect(byHandle).toBeDefined();
    expect(list).toBeDefined();
    await expect(
      byHandle?.handle({ body: undefined, params: { handle: "about" }, query: undefined, context }),
    ).rejects.toThrow("pages database unreachable");
    await expect(
      list?.handle({ body: undefined, params: undefined, query: undefined, context }),
    ).rejects.toThrow("pages database unreachable");
  });
});

describe("public content routes (spec 2.6)", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildOnlineStoreApp({ serializer: new InMemoryEventSerializer() });
  });
  afterEach(async () => {
    await app.close();
  });

  const staff = (method: "PUT" | "POST", url: string, payload: object, tenant = "t-1") =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: headersFor("admin", { "idempotency-key": `c-${(key += 1)}`, "x-tenant-id": tenant }),
      payload,
    });
  const anon = (url: string, tenant = "t-1") =>
    app.inject({
      method: "GET",
      url: `/api/v1/public${url}`,
      headers: { "x-tenant-id": tenant },
    });
  const createPage = async (payload: object, tenant = "t-1") => {
    const res = await staff("POST", "/pages", payload, tenant);
    expect(res.statusCode).toBe(201);
    return res.json<{ pageId: string }>().pageId;
  };
  const publish = async (pageId: string, tenant = "t-1") => {
    const res = await staff(
      "POST",
      `/pages/${pageId}/transitions`,
      { toStatus: "published" },
      tenant,
    );
    expect(res.statusCode).toBe(200);
  };

  it("a policy: 404 until set, then exactly type, body and updatedAt", async () => {
    const before = await anon("/policies/refund");
    expect(before.statusCode).toBe(404);
    expect(before.json()).toMatchObject({ code: "POLICY_NOT_FOUND" });
    expect(before.headers["cache-control"]).toBe(NOT_STORED);

    const saved = await staff("PUT", "/online-store/policies/refund", {
      body: { en: "Returns within 14 days." },
      expectedVersion: 0,
    });
    expect(saved.statusCode).toBe(200);

    const res = await anon("/policies/refund");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe(NOT_STORED);
    expect(res.json()).toEqual({
      type: "refund",
      body: { en: "Returns within 14 days." },
      updatedAt: "2026-10-27T10:00:00.000Z",
    });
    expect(res.body).not.toContain("staff-admin");
    expect(res.body).not.toContain("updatedBy");
    expect(res.body).not.toContain("version");
  });

  it("a policy type outside the five is 422, not a 404", async () => {
    for (const type of ["cookies", "__proto__", "Refund"]) {
      const res = await anon(`/policies/${type}`);
      expect(res.statusCode, type).toBe(422);
    }
  });

  it("a page: only published and under /pages/; the DTO leaks nothing", async () => {
    const about = await createPage({
      name: "About us",
      routePath: "/pages/about",
      title: { en: "About", ar: "من نحن" },
      body: { en: "We sell **tea**." },
      metaDescription: { en: "Who we are" },
    });
    const landing = await createPage({ name: "Landing", routePath: "/landing" });
    await publish(landing);

    const draft = await anon("/pages/about");
    expect(draft.statusCode).toBe(404);
    expect(draft.json()).toMatchObject({ code: "PAGE_NOT_FOUND" });
    expect(draft.headers["cache-control"]).toBe(NOT_STORED);
    await publish(about);

    expect((await anon("/pages/landing")).statusCode).toBe(404);
    const res = await anon("/pages/about");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe(NOT_STORED);
    expect(res.json()).toEqual({
      handle: "about",
      title: { en: "About", ar: "من نحن" },
      body: { en: "We sell **tea**." },
      metaDescription: { en: "Who we are" },
      updatedAt: "2026-10-27T10:00:00.000Z",
    });
    expect(keysOf(res.json()).sort()).toEqual([
      "ar",
      "body",
      "en",
      "en",
      "en",
      "handle",
      "metaDescription",
      "title",
      "updatedAt",
    ]);
    for (const leak of [about, "t-1", "published", "routePath", "version", "status", "About us"]) {
      expect(res.body, leak).not.toContain(leak);
    }
    expect((await anon("/pages/About")).statusCode).toBe(422);
    expect((await anon("/pages/a.b")).statusCode).toBe(422);
    // Fastify's 100-character path-parameter cap answers first, before any lookup.
    expect((await anon(`/pages/${"a".repeat(101)}`)).statusCode).toBe(414);
    expect((await anon(`/pages/${"a".repeat(100)}`)).statusCode).toBe(404);

    const list = await anon("/pages");
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe(NOT_STORED);
    expect(list.json()).toEqual({
      pages: [{ handle: "about", updatedAt: "2026-10-27T10:00:00.000Z" }],
    });
  });

  it("a page with no title falls back to its name, in English", async () => {
    const pageId = await createPage({ name: "Shipping info", routePath: "/pages/shipping-info" });
    await publish(pageId);
    const res = await anon("/pages/shipping-info");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      handle: "shipping-info",
      title: { en: "Shipping info" },
      body: {},
      metaDescription: {},
    });
  });

  it("an unpublished page leaves the list and its URL", async () => {
    const pageId = await createPage({ name: "FAQ", routePath: "/pages/faq" });
    await publish(pageId);
    expect((await anon("/pages")).json().pages).toHaveLength(1);
    const back = await staff("POST", `/pages/${pageId}/transitions`, { toStatus: "draft" });
    expect(back.statusCode).toBe(200);
    expect((await anon("/pages/faq")).statusCode).toBe(404);
    expect((await anon("/pages")).json()).toEqual({ pages: [] });
  });

  it("another shop's page is a 404 (x-tenant-id t-2)", async () => {
    const pageId = await createPage({ name: "About", routePath: "/pages/about" });
    await publish(pageId);
    expect((await anon("/pages/about")).statusCode).toBe(200);
    const elsewhere = await anon("/pages/about", "t-2");
    expect(elsewhere.statusCode).toBe(404);
    expect((await anon("/pages", "t-2")).json()).toEqual({ pages: [] });
    await staff("PUT", "/online-store/policies/terms", { body: { en: "T" }, expectedVersion: 0 });
    expect((await anon("/policies/terms")).statusCode).toBe(200);
    expect((await anon("/policies/terms", "t-2")).statusCode).toBe(404);
  });
});
