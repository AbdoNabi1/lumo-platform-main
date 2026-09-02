import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { pagesRoutes } from "./pages-routes";

/**
 * Phase 4 T4.6 — regression guard for the new Pages/Templates read routes (list/get, both
 * aggregates). Same technique as `reviews-routes.test.ts`: drives the REAL `wireAdmin()`
 * composition (in-memory branch) through the actual `RouteDefinition.handle()` boundary.
 */

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"] };

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
