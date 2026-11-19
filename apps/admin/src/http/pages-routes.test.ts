import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { pagesRoutes } from "./pages-routes";
import { buildOnlineStoreApp, headersFor, type StaffRole } from "./testing/online-store-harness";

/**
 * Phase 4 T4.6 — regression guard for the new Pages/Templates read routes (list/get, both
 * aggregates). Same technique as `reviews-routes.test.ts`: drives the REAL `wireAdmin()`
 * composition (in-memory branch) through the actual `RouteDefinition.handle()` boundary.
 */

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
const staff: Principal = {
  id: "staff-1",
  kind: "staff",
  roles: ["admin"],
  tenantId: "tenant-local",
};

function buildAdmin(): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireAdmin({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

interface Response {
  readonly status: number;
  readonly body: unknown;
}

function byPathAndMethod(
  routes: readonly RouteDefinition[],
  method: string,
  path: string,
): RouteDefinition {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no route ${method} ${path}`);
  return route;
}

function call(
  route: RouteDefinition,
  params: Record<string, string>,
  query: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  return route.handle({
    body,
    params,
    query,
    context: { tenantId: "tenant-local", principal: staff, requestId: "req-1" },
  } as never) as Promise<Response>;
}

function unwrap<T>(response: Response, action: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
}

describe("pages routes — read side (Phase 4 T4.6)", () => {
  it("list/get pages and templates return flat DTOs with no aggregate internals", async () => {
    const admin = buildAdmin();
    const routes = pagesRoutes(admin);

    const createdPage = unwrap<{ pageId: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/pages"),
        {},
        {},
        { name: "Home", routePath: "/" },
      ),
      "create page",
    );
    const createdTemplate = unwrap<{ templateId: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/templates"),
        {},
        {},
        { name: "Product page", experienceRef: "experience-1" },
      ),
      "create template",
    );

    const pageListResponse = await call(byPathAndMethod(routes, "GET", "/pages"), {}, {});
    expect(pageListResponse.status).toBe(200);
    const pageListBody = pageListResponse.body as { items: unknown[]; pageInfo: unknown };
    expect(pageListBody.items).toHaveLength(1);
    expect(pageListBody.pageInfo).toEqual({ hasNextPage: false, endCursor: expect.any(String) });

    const pageGetResponse = await call(
      byPathAndMethod(routes, "GET", "/pages/:pageId"),
      { pageId: createdPage.pageId },
      {},
    );
    expect(pageGetResponse.status).toBe(200);

    for (const dto of [
      ...(pageListBody.items as Record<string, unknown>[]),
      pageGetResponse.body as Record<string, unknown>,
    ]) {
      expect(dto).not.toHaveProperty("props");
      expect(dto).not.toHaveProperty("_id");
      expect(dto).toMatchObject({ id: createdPage.pageId, name: "Home", routePath: "/" });
    }

    const templateListResponse = await call(byPathAndMethod(routes, "GET", "/templates"), {}, {});
    expect(templateListResponse.status).toBe(200);
    const templateListBody = templateListResponse.body as { items: unknown[] };
    expect(templateListBody.items).toHaveLength(1);

    const templateGetResponse = await call(
      byPathAndMethod(routes, "GET", "/templates/:templateId"),
      { templateId: createdTemplate.templateId },
      {},
    );
    expect(templateGetResponse.status).toBe(200);

    for (const dto of [
      ...(templateListBody.items as Record<string, unknown>[]),
      templateGetResponse.body as Record<string, unknown>,
    ]) {
      expect(dto).not.toHaveProperty("props");
      expect(dto).not.toHaveProperty("_id");
      expect(dto).toMatchObject({
        id: createdTemplate.templateId,
        name: "Product page",
        experienceRef: "experience-1",
      });
    }

    const pageNotFound = await call(
      byPathAndMethod(routes, "GET", "/pages/:pageId"),
      { pageId: "does-not-exist" },
      {},
    );
    expect(pageNotFound.status).toBe(404);

    const templateNotFound = await call(
      byPathAndMethod(routes, "GET", "/templates/:templateId"),
      { templateId: "does-not-exist" },
      {},
    );
    expect(templateNotFound.status).toBe(404);
  });
});

describe("the pages route table (Part 2, spec 2.6)", () => {
  const routes = pagesRoutes({} as WiredAdmin);

  it("adds the content route: pages:update_page, idempotent, strict and version-guarded", () => {
    const route = routes.find((r) => r.method === "PUT" && r.path === "/pages/:pageId/content");
    expect(route).toBeDefined();
    expect(route?.permission).toBe("pages:update_page");
    expect(route?.idempotent).toBe(true);
    const ok = { title: {}, body: {}, metaDescription: {}, expectedVersion: 0 };
    expect(route?.schema.body?.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, extra: 1 },
      { ...ok, expectedVersion: -1 },
      { ...ok, expectedVersion: 1.5 },
      { ...ok, expectedVersion: "1" },
      { ...ok, title: { en: "x", fr: "y" } },
      { ...ok, body: { en: "x".repeat(120_001) } },
      { title: {}, body: {}, expectedVersion: 0 },
    ]) {
      expect(route?.schema.body?.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(
        false,
      );
    }
  });
});

describe("page content over HTTP (Part 2, spec 2.4 and 2.6)", () => {
  let app: FastifyInstance;
  let key = 0;
  beforeAll(async () => {
    app = await buildOnlineStoreApp({ serializer: new InMemoryEventSerializer() });
  });
  afterAll(async () => {
    await app.close();
  });

  const send = (role: StaffRole, method: "GET" | "PUT" | "POST", url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: headersFor(role, method === "GET" ? {} : { "idempotency-key": `pg-${(key += 1)}` }),
      ...(payload === undefined ? {} : { payload }),
    });

  it("create accepts content; the DTO gains the content fields and the version", async () => {
    const created = await send("operator", "POST", "/pages", {
      name: "About",
      routePath: "/pages/about",
      title: { en: "About us" },
      body: { en: "Hello" },
      metaDescription: { ar: "عنا" },
    });
    expect(created.statusCode).toBe(201);
    const { pageId } = created.json<{ pageId: string }>();
    const read = await send("viewer", "GET", `/pages/${pageId}`);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({
      id: pageId,
      name: "About",
      routePath: "/pages/about",
      templateRef: null,
      experienceRef: null,
      seoProfileRef: null,
      localeRef: null,
      status: "draft",
      title: { en: "About us" },
      body: { en: "Hello" },
      metaDescription: { ar: "عنا" },
      publishedAt: null,
      version: 1,
      updatedAt: "2026-10-27T10:00:00.000Z",
    });
  });

  it("content update needs pages:update_page and bumps the version", async () => {
    const { pageId } = (
      await send("operator", "POST", "/pages", { name: "FAQ", routePath: "/pages/faq" })
    ).json<{ pageId: string }>();
    const content = {
      title: { en: "FAQ" },
      body: { en: "Ask us." },
      metaDescription: {},
      expectedVersion: 1,
    };
    expect((await send("viewer", "PUT", `/pages/${pageId}/content`, content)).statusCode).toBe(403);
    const saved = await send("operator", "PUT", `/pages/${pageId}/content`, content);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ pageId, version: 2 });
    const read = await send("viewer", "GET", `/pages/${pageId}`);
    expect(read.json()).toMatchObject({
      title: { en: "FAQ" },
      body: { en: "Ask us." },
      version: 2,
    });

    const stale = await send("operator", "PUT", `/pages/${pageId}/content`, content);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    const missing = await send("operator", "PUT", "/pages/nope/content", content);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "PAGE_NOT_FOUND" });
    const unsafe = await send("operator", "PUT", `/pages/${pageId}/content`, {
      ...content,
      body: { en: "[x](javascript:alert(1))" },
      expectedVersion: 2,
    });
    expect(unsafe.statusCode).toBe(422);
    expect(unsafe.json()).toMatchObject({
      code: "INVALID_CONTENT",
      fields: [{ field: "body.en", message: "UNSAFE_LINK" }],
    });
  });

  it("the list omits body but keeps the rest of the DTO", async () => {
    const list = await send("viewer", "GET", "/pages");
    expect(list.statusCode).toBe(200);
    const items = list.json<{ items: Record<string, unknown>[] }>().items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).not.toHaveProperty("body");
      expect(Object.keys(item).sort()).toEqual([
        "experienceRef",
        "id",
        "localeRef",
        "metaDescription",
        "name",
        "publishedAt",
        "routePath",
        "seoProfileRef",
        "status",
        "templateRef",
        "title",
        "updatedAt",
        "version",
      ]);
    }
  });
});
