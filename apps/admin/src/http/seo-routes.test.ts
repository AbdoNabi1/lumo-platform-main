import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { seoRoutes } from "./seo-routes";

/**
 * Phase 4 T4.7 — regression guard for the new SEO read routes (list/get across all 4
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

function assertNoLeak(dto: Record<string, unknown>): void {
  expect(dto).not.toHaveProperty("props");
  expect(dto).not.toHaveProperty("_id");
  expect(dto).not.toHaveProperty("_domainEvents");
  expect(dto).not.toHaveProperty("_version");
}

describe("seo routes — read side (Phase 4 T4.7)", () => {
  it("list/get SEO profiles return flat DTOs", async () => {
    const routes = seoRoutes(buildAdmin());
    const created = unwrap<{ id: string }>(
      await call(byPathAndMethod(routes, "POST", "/seo/profiles"), {}, {}, { pageRef: "/home" }),
      "set profile",
    );
    const list = await call(byPathAndMethod(routes, "GET", "/seo/profiles"), {}, {});
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    const get = await call(
      byPathAndMethod(routes, "GET", "/seo/profiles/:profileId"),
      { profileId: created.id },
      {},
    );
    expect(get.status).toBe(200);
    assertNoLeak(get.body as Record<string, unknown>);
    expect(get.body).toMatchObject({ id: created.id, pageRef: "/home" });

    const notFound = await call(
      byPathAndMethod(routes, "GET", "/seo/profiles/:profileId"),
      { profileId: "does-not-exist" },
      {},
    );
    expect(notFound.status).toBe(404);
  });

  it("list/get redirects return flat DTOs", async () => {
    const routes = seoRoutes(buildAdmin());
    const created = unwrap<{ id: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/seo/redirects"),
        {},
        {},
        { fromPath: "/old", toPath: "/new", statusCode: 301 },
      ),
      "create redirect",
    );
    const list = await call(byPathAndMethod(routes, "GET", "/seo/redirects"), {}, {});
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    const get = await call(
      byPathAndMethod(routes, "GET", "/seo/redirects/:redirectId"),
      { redirectId: created.id },
      {},
    );
    expect(get.status).toBe(200);
    assertNoLeak(get.body as Record<string, unknown>);
    expect(get.body).toMatchObject({ id: created.id, fromPath: "/old", toPath: "/new" });
  });

  it("list/get sitemaps return flat DTOs", async () => {
    const routes = seoRoutes(buildAdmin());
    const created = unwrap<{ id: string }>(
      await call(byPathAndMethod(routes, "POST", "/seo/sitemaps"), {}, {}, { name: "main" }),
      "create sitemap",
    );
    const list = await call(byPathAndMethod(routes, "GET", "/seo/sitemaps"), {}, {});
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    const get = await call(
      byPathAndMethod(routes, "GET", "/seo/sitemaps/:sitemapId"),
      { sitemapId: created.id },
      {},
    );
    expect(get.status).toBe(200);
    assertNoLeak(get.body as Record<string, unknown>);
    expect(get.body).toMatchObject({ id: created.id, name: "main" });
  });

  it("list/get robots policies return flat DTOs", async () => {
    const routes = seoRoutes(buildAdmin());
    const created = unwrap<{ id: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/seo/robots-policies"),
        {},
        {},
        { userAgent: "*", rules: [] },
      ),
      "set robots policy",
    );
    const list = await call(byPathAndMethod(routes, "GET", "/seo/robots-policies"), {}, {});
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    const get = await call(
      byPathAndMethod(routes, "GET", "/seo/robots-policies/:policyId"),
      { policyId: created.id },
      {},
    );
    expect(get.status).toBe(200);
    assertNoLeak(get.body as Record<string, unknown>);
    expect(get.body).toMatchObject({ id: created.id, userAgent: "*" });
  });
});
