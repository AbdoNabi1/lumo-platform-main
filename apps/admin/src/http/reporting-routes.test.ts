import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { reportingRoutes } from "./reporting-routes";

/**
 * Phase 4 T4.20 — regression guard for the new Reporting read routes (list/get on report
 * definitions and dashboards). Same technique as `recommendations-routes.test.ts`: drives the
 * REAL `wireAdmin()` composition (in-memory branch) through the actual `RouteDefinition.handle()`
 * boundary.
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

describe("reporting routes — read side (Phase 4 T4.20)", () => {
  it("report-definition list/get return flat DTOs with no aggregate internals", async () => {
    const admin = buildAdmin();
    const routes = reportingRoutes(admin);

    const created = unwrap<{ reportDefinitionId: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/reporting/report-definitions"),
        {},
        {},
        { name: "orders-by-day", type: "table", metricRefs: ["orders_count"] },
      ),
      "create report definition",
    );

    const listResponse = await call(
      byPathAndMethod(routes, "GET", "/reporting/report-definitions"),
      {},
      {},
    );
    expect(listResponse.status).toBe(200);
    const listBody = listResponse.body as { items: unknown[]; pageInfo: unknown };
    expect(listBody.items).toHaveLength(1);
    expect(listBody.pageInfo).toEqual({ hasNextPage: false, endCursor: expect.any(String) });

    const getResponse = await call(
      byPathAndMethod(routes, "GET", "/reporting/report-definitions/:reportDefinitionId"),
      { reportDefinitionId: created.reportDefinitionId },
      {},
    );
    expect(getResponse.status).toBe(200);

    for (const dto of [
      ...(listBody.items as Record<string, unknown>[]),
      getResponse.body as Record<string, unknown>,
    ]) {
      expect(dto).not.toHaveProperty("props");
      expect(dto).not.toHaveProperty("_id");
      expect(dto).not.toHaveProperty("_domainEvents");
      expect(dto).not.toHaveProperty("_version");
      expect(dto).toMatchObject({
        id: created.reportDefinitionId,
        name: "orders-by-day",
        type: "table",
        metricRefs: ["orders_count"],
        status: "draft",
      });
    }

    const notFound = await call(
      byPathAndMethod(routes, "GET", "/reporting/report-definitions/:reportDefinitionId"),
      { reportDefinitionId: "does-not-exist" },
      {},
    );
    expect(notFound.status).toBe(404);
  });

  it("dashboard list/get return flat DTOs with no aggregate internals", async () => {
    const admin = buildAdmin();
    const routes = reportingRoutes(admin);

    const created = unwrap<{ dashboardId: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/reporting/dashboards"),
        {},
        {},
        { name: "sales-overview", tileRefs: ["tile-1"] },
      ),
      "create dashboard",
    );

    const listResponse = await call(
      byPathAndMethod(routes, "GET", "/reporting/dashboards"),
      {},
      {},
    );
    expect(listResponse.status).toBe(200);
    const listBody = listResponse.body as { items: unknown[]; pageInfo: unknown };
    expect(listBody.items).toHaveLength(1);
    expect(listBody.pageInfo).toEqual({ hasNextPage: false, endCursor: expect.any(String) });

    const getResponse = await call(
      byPathAndMethod(routes, "GET", "/reporting/dashboards/:dashboardId"),
      { dashboardId: created.dashboardId },
      {},
    );
    expect(getResponse.status).toBe(200);

    for (const dto of [
      ...(listBody.items as Record<string, unknown>[]),
      getResponse.body as Record<string, unknown>,
    ]) {
      expect(dto).not.toHaveProperty("props");
      expect(dto).not.toHaveProperty("_id");
      expect(dto).not.toHaveProperty("_domainEvents");
      expect(dto).not.toHaveProperty("_version");
      expect(dto).toMatchObject({
        id: created.dashboardId,
        name: "sales-overview",
        tileRefs: ["tile-1"],
        status: "active",
      });
    }

    const notFound = await call(
      byPathAndMethod(routes, "GET", "/reporting/dashboards/:dashboardId"),
      { dashboardId: "does-not-exist" },
      {},
    );
    expect(notFound.status).toBe(404);
  });
});
