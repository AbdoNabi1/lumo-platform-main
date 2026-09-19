import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { tenancyRoutes } from "./tenancy-routes";

/**
 * Phase 4 T4.15 — regression guard for the new Tenancy read routes: list/get across both Tenant
 * and Workspace, plus `GET /workspaces/current` (Settings' actual blocker — see the plan's T4.15
 * note). Same technique as `reviews-routes.test.ts`: drives the REAL `wireAdmin()` composition
 * (in-memory branch) through the actual `RouteDefinition.handle()` boundary.
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

function assertNoLeak(dto: Record<string, unknown>): void {
  expect(dto).not.toHaveProperty("props");
  expect(dto).not.toHaveProperty("_id");
  expect(dto).not.toHaveProperty("_domainEvents");
  expect(dto).not.toHaveProperty("_version");
}

describe("tenancy routes — read side (Phase 4 T4.15)", () => {
  it("list/get tenants return flat DTOs", async () => {
    const routes = tenancyRoutes(buildAdmin());
    const created = unwrap<{ id: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/tenants"),
        {},
        {},
        { slug: "acme", name: "Acme Inc", isolationTier: "pooled" },
      ),
      "create tenant",
    );
    const list = await call(byPathAndMethod(routes, "GET", "/tenants"), {}, {});
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    const get = await call(
      byPathAndMethod(routes, "GET", "/tenants/:tenantId"),
      { tenantId: created.id },
      {},
    );
    expect(get.status).toBe(200);
    assertNoLeak(get.body as Record<string, unknown>);
    expect(get.body).toMatchObject({ id: created.id, slug: "acme", name: "Acme Inc" });

    const notFound = await call(
      byPathAndMethod(routes, "GET", "/tenants/:tenantId"),
      { tenantId: "does-not-exist" },
      {},
    );
    expect(notFound.status).toBe(404);
  });

  it("list/get workspaces and GET /workspaces/current return flat DTOs", async () => {
    const routes = tenancyRoutes(buildAdmin());

    const noWorkspaceYet = await call(
      byPathAndMethod(routes, "GET", "/workspaces/current"),
      {},
      {},
    );
    expect(noWorkspaceYet.status).toBe(404);

    const tenant = unwrap<{ id: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/tenants"),
        {},
        {},
        { slug: "acme", name: "Acme Inc", isolationTier: "pooled" },
      ),
      "create tenant",
    );
    const created = unwrap<{ id: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/workspaces"),
        {},
        {},
        { tenantId: tenant.id, env: "production", name: "Main" },
      ),
      "create workspace",
    );

    const list = await call(byPathAndMethod(routes, "GET", "/workspaces"), {}, {});
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);

    const get = await call(
      byPathAndMethod(routes, "GET", "/workspaces/:workspaceId"),
      { workspaceId: created.id },
      {},
    );
    expect(get.status).toBe(200);
    assertNoLeak(get.body as Record<string, unknown>);
    expect(get.body).toMatchObject({ id: created.id, env: "production", name: "Main" });

    const current = await call(byPathAndMethod(routes, "GET", "/workspaces/current"), {}, {});
    expect(current.status).toBe(200);
    assertNoLeak(current.body as Record<string, unknown>);
    expect(current.body).toMatchObject({ id: created.id, env: "production" });

    const notFound = await call(
      byPathAndMethod(routes, "GET", "/workspaces/:workspaceId"),
      { workspaceId: "does-not-exist" },
      {},
    );
    expect(notFound.status).toBe(404);
  });
});
