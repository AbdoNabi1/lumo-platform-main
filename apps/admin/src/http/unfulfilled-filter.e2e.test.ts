import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireAdmin, type WiredAdmin } from "../composition";
import { adminRoutes } from "./admin-routes";
import { salesAnalyticsRoutes } from "./sales-analytics-routes";

/**
 * Plan 3D, on the REAL in-memory composition: the Home card's "orders to fulfill" and the list it
 * links to (`GET /orders?fulfillment=unfulfilled`) are two readers of one definition, so they cannot
 * disagree. Both go through the actual route handlers.
 */

const clock: Clock = { now: () => new Date("2026-07-05T00:00:00.000Z") };
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: "shop-a" };

function buildAdmin(): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
  };
  return wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    tenantId: "tenant-local",
  });
}

async function place(admin: WiredAdmin, tenantId: string): Promise<string> {
  const response = await admin.orders.placeOrder(staff, {
    tenantId,
    customerRef: "customer-1",
    currency: "EGP",
    items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1000, quantity: 1 }],
    shippingAddress: { line1: "1 Main St", city: "Cairo", postalCode: "11511", country: "EG" },
  });
  expect(response.status).toBe(201);
  return (response.body as { orderId: string }).orderId;
}

interface Body {
  readonly items: readonly { readonly id: string; readonly fulfillmentStatus: string }[];
  readonly pageInfo: { readonly hasNextPage: boolean };
  readonly current: { readonly ordersToFulfill: number };
}

async function call(
  routes: ReturnType<typeof adminRoutes>,
  path: string,
  tenantId: string,
  query: Record<string, string>,
) {
  const route = routes.find((r) => r.method === "GET" && r.path === path);
  if (route === undefined) throw new Error(`no GET ${path} route`);
  return (await route.handle({
    body: undefined,
    params: undefined,
    query,
    context: { tenantId, principal: staff, requestId: "req-1" },
  } as never)) as { status: number; body: Body };
}

describe("orders to fulfill: the card and the list agree (end to end)", () => {
  it("lists exactly the open orders with no fulfillment under way, and the card counts the same", async () => {
    const admin = buildAdmin();
    const first = await place(admin, "shop-a");
    const second = await place(admin, "shop-a");
    const third = await place(admin, "shop-a");
    await place(admin, "shop-b"); // somebody else's

    // an order with a fulfillment order opened is "in progress": no longer waiting to be fulfilled
    const opened = await admin.fulfillment.create(staff, {
      tenantId: "shop-a",
      orderRef: second,
      items: [{ productRef: "p-1", quantity: 1 }],
    });
    expect(opened.status).toBe(201);

    const routes = adminRoutes(admin);
    const list = await call(routes, "/orders", "shop-a", { fulfillment: "unfulfilled" });
    const card = await call(
      [...salesAnalyticsRoutes(admin, { now: () => new Date("2026-07-05T00:00:00.000Z") })],
      "/analytics/sales",
      "shop-a",
      { range: "today" },
    );

    expect(list.status).toBe(200);
    const listed = (list.body.items as { id: string; fulfillmentStatus: string }[]).map(
      (o) => o.id,
    );
    expect([...listed].sort()).toEqual([first, third].sort());
    expect(list.body.items.every((o) => o.fulfillmentStatus === "unfulfilled")).toBe(true);
    expect(card.status).toBe(200);
    expect(card.body.current.ordersToFulfill).toBe(listed.length);
  });

  it("answers an empty list, not an error, when nothing is waiting", async () => {
    const admin = buildAdmin();

    const list = await call(adminRoutes(admin), "/orders", "shop-a", {
      fulfillment: "unfulfilled",
    });

    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
    expect(list.body.pageInfo.hasNextPage).toBe(false);
  });
});
