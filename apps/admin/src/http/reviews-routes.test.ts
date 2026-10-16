import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { reviewsRoutes } from "./reviews-routes";

/**
 * Phase 4 T4.1 — regression guard for the new Reviews read routes (list/get/list-by-product).
 * Drives the REAL `wireAdmin()` composition (in-memory branch) through the actual
 * `RouteDefinition.handle()` boundary, same technique as
 * `financial-security-remediation.e2e.test.ts`, so the DTO assertions below exercise the real
 * `Review` aggregate rather than a hand-built fixture — `public-catalog-routes.ts`'s header comment
 * documents the real incident this class of test guards against (an aggregate's `props`/`_id`/
 * `_domainEvents`/`_version` reaching the wire verbatim).
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

describe("reviews routes — read side (Phase 4 T4.1)", () => {
  it("list/get/list-by-product return flat DTOs with no aggregate internals", async () => {
    const admin = buildAdmin();
    const routes = reviewsRoutes(admin);

    const created = unwrap<{ reviewId: string }>(
      await call(
        byPathAndMethod(routes, "POST", "/reviews"),
        {},
        {},
        {
          productRef: "product-1",
          customerRef: "customer-1",
          rating: 5,
          bodyText: "Great!",
        },
      ),
      "create review",
    );

    const listResponse = await call(byPathAndMethod(routes, "GET", "/reviews"), {}, {});
    expect(listResponse.status).toBe(200);
    const listBody = listResponse.body as { items: unknown[]; pageInfo: unknown };
    expect(Array.isArray(listBody.items)).toBe(true);
    expect(listBody.items).toHaveLength(1);
    expect(listBody.pageInfo).toEqual({ hasNextPage: false, endCursor: expect.any(String) });

    const byProductResponse = await call(
      byPathAndMethod(routes, "GET", "/reviews/by-product/:productRef"),
      { productRef: "product-1" },
      {},
    );
    expect(byProductResponse.status).toBe(200);
    const byProductBody = byProductResponse.body as { items: unknown[] };
    expect(byProductBody.items).toHaveLength(1);

    const getResponse = await call(
      byPathAndMethod(routes, "GET", "/reviews/:reviewId"),
      { reviewId: created.reviewId },
      {},
    );
    expect(getResponse.status).toBe(200);

    for (const dto of [
      ...(listBody.items as Record<string, unknown>[]),
      ...(byProductBody.items as Record<string, unknown>[]),
      getResponse.body as Record<string, unknown>,
    ]) {
      expect(dto).not.toHaveProperty("props");
      expect(dto).not.toHaveProperty("_id");
      expect(dto).not.toHaveProperty("_domainEvents");
      expect(dto).not.toHaveProperty("_version");
      expect(dto).toMatchObject({
        id: created.reviewId,
        productRef: "product-1",
        customerRef: "customer-1",
        rating: 5,
        bodyText: "Great!",
        status: "pending",
      });
    }

    const notFound = await call(
      byPathAndMethod(routes, "GET", "/reviews/:reviewId"),
      { reviewId: "does-not-exist" },
      {},
    );
    expect(notFound.status).toBe(404);
  });

  it("the status filter narrows /reviews to the moderation queue", async () => {
    const admin = buildAdmin();
    const routes = reviewsRoutes(admin);

    await call(
      byPathAndMethod(routes, "POST", "/reviews"),
      {},
      {},
      { productRef: "product-1", customerRef: "customer-1", rating: 4, bodyText: "Good" },
    );

    const pending = await call(
      byPathAndMethod(routes, "GET", "/reviews"),
      {},
      { status: "pending" },
    );
    expect((pending.body as { items: unknown[] }).items).toHaveLength(1);

    const published = await call(
      byPathAndMethod(routes, "GET", "/reviews"),
      {},
      { status: "published" },
    );
    expect((published.body as { items: unknown[] }).items).toHaveLength(0);
  });
});
