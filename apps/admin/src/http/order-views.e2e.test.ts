import { describe, expect, it } from "vitest";
import type { WiredAdmin } from "../composition";
import { adminRoutes } from "./admin-routes";
import { salesAnalyticsRoutes } from "./sales-analytics-routes";
import {
  adminStaff,
  buildOrdersAdmin,
  callRoute,
  HARNESS_NOW,
  HARNESS_TENANT,
  placeTestOrder,
  viewerStaff,
} from "./testing/orders-harness";

interface ListBody {
  readonly items: readonly { readonly id: string; readonly archivedAt: string | null }[];
}

async function listed(admin: WiredAdmin, query: Record<string, string>): Promise<string[]> {
  const response = await callRoute(adminRoutes(admin), "GET", "/orders", { query });
  expect(response.status).toBe(200);
  return (response.body as ListBody).items.map((item) => item.id).sort();
}

async function archive(admin: WiredAdmin, orderId: string, principal = adminStaff) {
  return callRoute(
    adminRoutes(admin),
    "POST",
    "/orders/:orderId/archive",
    { params: { orderId } },
    principal,
  );
}

describe("GET /orders views (order operations Part 1, on the real in-memory composition)", () => {
  it("lists Shopify's tabs: All, Open, Unpaid, Archived and Unfulfilled (legacy link included)", async () => {
    const admin = buildOrdersAdmin();
    const open = await placeTestOrder(admin);
    const paid = await placeTestOrder(admin);
    const cancelled = await placeTestOrder(admin);
    const archived = await placeTestOrder(admin);
    expect(
      (
        await admin.orders.markOrderPaid(adminStaff, {
          tenantId: HARNESS_TENANT,
          orderId: paid,
          paymentRef: "pay-1",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.orders.advanceOrder(adminStaff, {
          tenantId: HARNESS_TENANT,
          orderId: cancelled,
          toStatus: "cancelled",
        })
      ).status,
    ).toBe(200);
    expect((await archive(admin, archived)).status).toBe(200);

    expect(await listed(admin, {})).toEqual([open, paid, cancelled, archived].sort());
    expect(await listed(admin, { view: "all" })).toEqual([open, paid, cancelled, archived].sort());
    expect(await listed(admin, { view: "open" })).toEqual([open, paid].sort());
    expect(await listed(admin, { view: "unpaid" })).toEqual([open]);
    expect(await listed(admin, { view: "archived" })).toEqual([archived]);
    expect(await listed(admin, { view: "unfulfilled" })).toEqual([open, paid].sort());
    expect(await listed(admin, { fulfillment: "unfulfilled" })).toEqual([open, paid].sort());
  });

  it("shows archivedAt on the archived row only, and on the order page", async () => {
    const admin = buildOrdersAdmin();
    const kept = await placeTestOrder(admin);
    const archived = await placeTestOrder(admin);
    await archive(admin, archived);

    const list = await callRoute(adminRoutes(admin), "GET", "/orders", { query: {} });
    const byId = new Map((list.body as ListBody).items.map((item) => [item.id, item.archivedAt]));
    expect(byId.get(kept)).toBeNull();
    expect(byId.get(archived)).toBe(HARNESS_NOW.toISOString());

    const detail = await callRoute(adminRoutes(admin), "GET", "/orders/:orderId", {
      params: { orderId: archived },
    });
    expect((detail.body as { archivedAt: string | null }).archivedAt).toBe(
      HARNESS_NOW.toISOString(),
    );
  });
});

describe("POST /orders/:orderId/archive and /unarchive", () => {
  it("archives, answers the same timestamp again (idempotent) and unarchives", async () => {
    const admin = buildOrdersAdmin();
    const orderId = await placeTestOrder(admin);

    const first = await archive(admin, orderId);
    const again = await archive(admin, orderId);
    const undone = await callRoute(adminRoutes(admin), "POST", "/orders/:orderId/unarchive", {
      params: { orderId },
    });

    expect(first).toEqual({
      status: 200,
      body: { orderId, archivedAt: HARNESS_NOW.toISOString() },
    });
    expect(again).toEqual(first);
    expect(undone).toEqual({ status: 200, body: { orderId, archivedAt: null } });
  });

  it("answers 404 for an order this shop does not have", async () => {
    const admin = buildOrdersAdmin();
    const theirs = await placeTestOrder(admin, "shop-b");
    expect((await archive(admin, theirs)).status).toBe(404);
    expect((await archive(admin, "00000000-0000-7000-8000-0000000000ff")).status).toBe(404);
  });

  it("refuses a viewer and archives nothing", async () => {
    const admin = buildOrdersAdmin();
    const orderId = await placeTestOrder(admin);
    expect((await archive(admin, orderId, viewerStaff)).status).toBe(403);
    expect(await listed(admin, { view: "archived" })).toEqual([]);
  });

  it("declares orders:archive on both routes", () => {
    const routes = adminRoutes(buildOrdersAdmin());
    for (const path of ["/orders/:orderId/archive", "/orders/:orderId/unarchive"]) {
      expect(routes.find((r) => r.method === "POST" && r.path === path)?.permission).toBe(
        "orders:archive",
      );
    }
  });
});

describe("Home's Orders to fulfill and the Unfulfilled tab stay one definition (Review Focus 2)", () => {
  it("archiving removes an order from the card and the tab together", async () => {
    const admin = buildOrdersAdmin();
    const kept = await placeTestOrder(admin);
    const archived = await placeTestOrder(admin);
    await archive(admin, archived);

    const card = await callRoute(
      salesAnalyticsRoutes(admin, { now: () => HARNESS_NOW }),
      "GET",
      "/analytics/sales",
      { query: { range: "today" } },
    );
    const tab = await listed(admin, { view: "unfulfilled" });

    expect(tab).toEqual([kept]);
    expect((card.body as { current: { ordersToFulfill: number } }).current.ordersToFulfill).toBe(
      tab.length,
    );
  });
});
