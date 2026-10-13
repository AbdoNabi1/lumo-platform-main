import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireAdmin, type WiredAdmin } from "../composition";
import { adminRoutes } from "./admin-routes";

/**
 * Plan 3D, on the REAL in-memory composition: an order with no recipient name on its shipping address
 * is labelled with the customer's name (else their email) by `GET /orders`, through the actual route
 * handler and the real Identity context behind it.
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

interface ListedOrder {
  readonly customerRef: string;
  readonly customerName: string | null;
}

async function register(admin: WiredAdmin, tenantId: string, name: string, email: string) {
  const response = await admin.customers.registerCustomer(staff, { tenantId, name, email });
  expect(response.status).toBe(201);
  return (response.body as { customerId: string }).customerId;
}

async function place(admin: WiredAdmin, tenantId: string, customerRef: string) {
  const response = await admin.orders.placeOrder(staff, {
    tenantId,
    customerRef,
    currency: "EGP",
    items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1000, quantity: 1 }],
    shippingAddress: { line1: "1 Main St", city: "Cairo", postalCode: "11511", country: "EG" },
  });
  expect(response.status).toBe(201);
}

async function listOrders(admin: WiredAdmin, tenantId: string): Promise<readonly ListedOrder[]> {
  const route = adminRoutes(admin).find((r) => r.method === "GET" && r.path === "/orders");
  if (route === undefined) throw new Error("no GET /orders route");
  const response = (await route.handle({
    body: undefined,
    params: undefined,
    query: {},
    context: { tenantId, principal: staff, requestId: "req-1" },
  } as never)) as { status: number; body: { items: ListedOrder[] } };
  expect(response.status).toBe(200);
  return response.body.items;
}

describe("GET /orders: the customer name fallback (end to end)", () => {
  it("shows the customer's name and nothing for an unknown customer", async () => {
    const admin = buildAdmin();
    const alice = await register(admin, "shop-a", "Alice Adams", "alice@example.com");
    await place(admin, "shop-a", alice);
    await place(admin, "shop-a", "customer-1");

    const orders = await listOrders(admin, "shop-a");
    const nameOf = (customerRef: string) =>
      orders.find((order) => order.customerRef === customerRef)?.customerName;

    expect(nameOf(alice)).toBe("Alice Adams");
    expect(nameOf("customer-1")).toBeNull();
  });

  it("never labels an order with another shop's customer", async () => {
    const admin = buildAdmin();
    const theirs = await register(admin, "shop-b", "Mallory Other", "mallory@example.com");
    await place(admin, "shop-a", theirs);

    const orders = await listOrders(admin, "shop-a");

    expect(orders.find((order) => order.customerRef === theirs)?.customerName).toBeNull();
  });
});
