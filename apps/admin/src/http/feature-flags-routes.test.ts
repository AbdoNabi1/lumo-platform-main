import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { featureFlagsRoutes } from "./feature-flags-routes";

/**
 * Phase 4 T4.16 — regression guard for the new Feature Flags read routes (list/get). Same
 * technique as `reviews-routes.test.ts`: drives the REAL `wireAdmin()` composition (in-memory
 * branch) through the actual `RouteDefinition.handle()` boundary.
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

describe("feature-flags routes — read side (Phase 4 T4.16)", () => {
  it("list/get return flat DTOs with no aggregate internals", async () => {
    const admin = buildAdmin();
    const routes = featureFlagsRoutes(admin);

    const created = unwrap<{ flagId: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/feature-flags"),
        {},
        {},
        { key: "new-checkout", name: "New Checkout" },
      ),
      "create feature flag",
    );

    const listResponse = await call(byPathAndMethod(routes, "GET", "/feature-flags"), {}, {});
    expect(listResponse.status).toBe(200);
    const listBody = listResponse.body as { items: unknown[]; pageInfo: unknown };
    expect(listBody.items).toHaveLength(1);
    expect(listBody.pageInfo).toEqual({ hasNextPage: false, endCursor: expect.any(String) });

    const getResponse = await call(
      byPathAndMethod(routes, "GET", "/feature-flags/:flagId"),
      { flagId: created.flagId },
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
        id: created.flagId,
        key: "new-checkout",
        name: "New Checkout",
        status: "active",
        rolloutPercentage: 0,
      });
    }

    const notFound = await call(
      byPathAndMethod(routes, "GET", "/feature-flags/:flagId"),
      { flagId: "does-not-exist" },
      {},
    );
    expect(notFound.status).toBe(404);
  });
});
