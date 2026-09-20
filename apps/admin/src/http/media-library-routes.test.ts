import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { mediaLibraryRoutes } from "./media-library-routes";

/**
 * Phase 4 T4.14 — regression guard for the new Media Library read routes (list/get across both
 * Folder and MediaAsset). Same technique as `reviews-routes.test.ts`: drives the REAL
 * `wireAdmin()` composition (in-memory branch) through the actual `RouteDefinition.handle()`
 * boundary.
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

describe("media library routes — read side (Phase 4 T4.14)", () => {
  it("list/get folders return flat DTOs", async () => {
    const routes = mediaLibraryRoutes(buildAdmin());
    const created = unwrap<{ folderId: string }>(
      await call(byPathAndMethod(routes, "POST", "/media/folders"), {}, {}, { name: "Products" }),
      "create folder",
    );
    const list = await call(byPathAndMethod(routes, "GET", "/media/folders"), {}, {});
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    const get = await call(
      byPathAndMethod(routes, "GET", "/media/folders/:folderId"),
      { folderId: created.folderId },
      {},
    );
    expect(get.status).toBe(200);
    assertNoLeak(get.body as Record<string, unknown>);
    expect(get.body).toMatchObject({ id: created.folderId, name: "Products", status: "active" });

    const notFound = await call(
      byPathAndMethod(routes, "GET", "/media/folders/:folderId"),
      { folderId: "does-not-exist" },
      {},
    );
    expect(notFound.status).toBe(404);
  });

  it("list/get media assets return flat DTOs", async () => {
    const routes = mediaLibraryRoutes(buildAdmin());
    const created = unwrap<{ mediaAssetId: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/media/assets"),
        {},
        {},
        { name: "hero.png", storageKey: "tenants/tenant-local/product-images/2026/09/hero.png" },
      ),
      "register media asset",
    );
    const list = await call(byPathAndMethod(routes, "GET", "/media/assets"), {}, {});
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    const get = await call(
      byPathAndMethod(routes, "GET", "/media/assets/:mediaAssetId"),
      { mediaAssetId: created.mediaAssetId },
      {},
    );
    expect(get.status).toBe(200);
    assertNoLeak(get.body as Record<string, unknown>);
    expect(get.body).toMatchObject({
      id: created.mediaAssetId,
      name: "hero.png",
      storageKey: "tenants/tenant-local/product-images/2026/09/hero.png",
      status: "active",
    });

    const notFound = await call(
      byPathAndMethod(routes, "GET", "/media/assets/:mediaAssetId"),
      { mediaAssetId: "does-not-exist" },
      {},
    );
    expect(notFound.status).toBe(404);
  });
});
