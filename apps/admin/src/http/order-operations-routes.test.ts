import { describe, expect, it, vi } from "vitest";
import type { Order } from "@platform/orders";
import type { WiredAdmin } from "../composition";
import { adminRoutes } from "./admin-routes";
import { bulkOrdersBody, orderOperationsRoutes } from "./order-operations-routes";
import {
  adminStaff,
  buildOrdersAdmin,
  callRoute,
  operatorStaff,
  placeTestOrder,
  viewerStaff,
} from "./testing/orders-harness";

interface BulkBody {
  readonly results: readonly {
    readonly orderId: string;
    readonly outcome: string;
    readonly reason?: string;
  }[];
}

const bulk = (admin: WiredAdmin, body: unknown, principal = adminStaff) =>
  callRoute(adminRoutes(admin), "POST", "/orders/bulk", { body }, principal);

async function archivedIds(admin: WiredAdmin): Promise<string[]> {
  const list = await callRoute(adminRoutes(admin), "GET", "/orders", {
    query: { view: "archived" },
  });
  return (list.body as { items: { id: string }[] }).items.map((item) => item.id).sort();
}

describe("POST /orders/bulk body (order operations Part 1)", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, i) => `o-${i}`);

  it("accepts 1 to 50 ids for each known action", () => {
    for (const action of [
      "archive",
      "unarchive",
      "fulfill",
      "capture_payments",
      "mark_cod_collected",
    ]) {
      expect(bulkOrdersBody.safeParse({ action, orderIds: ids(50) }).success, action).toBe(true);
    }
  });

  it("rejects 51 ids, no ids, an unknown action and unknown keys (strict)", () => {
    expect(bulkOrdersBody.safeParse({ action: "archive", orderIds: ids(51) }).success).toBe(false);
    expect(bulkOrdersBody.safeParse({ action: "archive", orderIds: [] }).success).toBe(false);
    expect(bulkOrdersBody.safeParse({ action: "cancel", orderIds: ids(1) }).success).toBe(false);
    expect(
      bulkOrdersBody.safeParse({ action: "archive", orderIds: ids(1), tags: ["vip"] }).success,
    ).toBe(false);
  });
});

describe("POST /orders/bulk on the real in-memory composition", () => {
  it("answers a result per order — ok, skipped and failed mixed — and collapses duplicate ids", async () => {
    const admin = buildOrdersAdmin();
    const fresh = await placeTestOrder(admin);
    const already = await placeTestOrder(admin);
    await bulk(admin, { action: "archive", orderIds: [already] });

    const response = await bulk(admin, {
      action: "archive",
      orderIds: [fresh, fresh, already, "00000000-0000-7000-8000-0000000000ff"],
    });

    expect(response.status).toBe(200);
    expect((response.body as BulkBody).results).toEqual([
      { orderId: fresh, outcome: "ok" },
      { orderId: already, outcome: "skipped", reason: "already_archived" },
      { orderId: "00000000-0000-7000-8000-0000000000ff", outcome: "failed", reason: "not_found" },
    ]);
    expect(await archivedIds(admin)).toEqual([fresh, already].sort());
  });

  it("opens fulfillments through the order page's call", async () => {
    const admin = buildOrdersAdmin();
    const orderId = await placeTestOrder(admin);

    const response = await bulk(admin, { action: "fulfill", orderIds: [orderId] });
    const again = await bulk(admin, { action: "fulfill", orderIds: [orderId] });

    expect((response.body as BulkBody).results).toEqual([{ orderId, outcome: "ok" }]);
    expect((again.body as BulkBody).results).toEqual([
      { orderId, outcome: "skipped", reason: "fulfillment_already_open" },
    ]);
  });

  it("refuses a viewer before touching any order", async () => {
    const admin = buildOrdersAdmin();
    const orderId = await placeTestOrder(admin);
    expect(
      (await bulk(admin, { action: "archive", orderIds: [orderId] }, viewerStaff)).status,
    ).toBe(403);
    expect(await archivedIds(admin)).toEqual([]);
  });

  it("checks each action's own permission: an operator archives but cannot mark cash received", async () => {
    const admin = buildOrdersAdmin();
    const orderId = await placeTestOrder(admin);
    expect(
      (await bulk(admin, { action: "mark_cod_collected", orderIds: [orderId] }, operatorStaff))
        .status,
    ).toBe(403);
    expect(
      (await bulk(admin, { action: "archive", orderIds: [orderId] }, operatorStaff)).status,
    ).toBe(200);
  });

  it("is idempotent by key at the transport", () => {
    const route = adminRoutes(buildOrdersAdmin()).find(
      (r) => r.method === "POST" && r.path === "/orders/bulk",
    );
    expect(route?.idempotent).toBe(true);
  });
});

describe("GET /orders/export-rows (order operations Part 1)", () => {
  const routeOf = (path: string) =>
    adminRoutes(buildOrdersAdmin()).find((r) => r.method === "GET" && r.path === path);

  it("is operator/admin only (orders:export) and validates its query", () => {
    const route = routeOf("/orders/export-rows");
    expect(route?.permission).toBe("orders:export");
    const schema = route?.schema.querystring;
    expect(schema?.safeParse({ first: "250" }).success).toBe(true);
    expect(schema?.safeParse({ first: "251" }).success).toBe(false);
    expect(
      schema?.safeParse({ ids: Array.from({ length: 51 }, (_, i) => `o-${i}`).join(",") }).success,
    ).toBe(false);
    expect(
      schema?.safeParse({ createdFrom: "2026-10-02T00:00:00Z", createdTo: "2026-10-01T00:00:00Z" })
        .success,
    ).toBe(false);
    expect(schema?.safeParse({ view: "unpaid", search: "mona", status: "placed" }).success).toBe(
      true,
    );
  });

  it("pages, narrows to ids and filters by date on the real composition", async () => {
    const admin = buildOrdersAdmin();
    const a = await placeTestOrder(admin);
    const b = await placeTestOrder(admin);
    const c = await placeTestOrder(admin);
    const routes = adminRoutes(admin);
    const rows = async (query: Record<string, string>) => {
      const response = await callRoute(routes, "GET", "/orders/export-rows", {
        query: routeOf("/orders/export-rows")?.schema.querystring?.parse(query),
      });
      expect(response.status).toBe(200);
      return response.body as {
        items: { orderId: string; codAmountMinor: number; tags: string[] }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };

    const first = await rows({ first: "2" });
    expect(first.items.map((r) => r.orderId)).toEqual([c, b]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const rest = await rows({ first: "2", after: first.pageInfo.endCursor ?? "" });
    expect(rest.items.map((r) => r.orderId)).toEqual([a]);
    expect((await rows({ ids: `${a},${c}` })).items.map((r) => r.orderId).sort()).toEqual(
      [a, c].sort(),
    );
    expect(
      (await rows({ createdFrom: "2026-07-04T00:00:00Z", createdTo: "2026-07-06T00:00:00Z" }))
        .items,
    ).toHaveLength(3);
    expect((await rows({ createdFrom: "2026-07-06T00:00:00Z" })).items).toHaveLength(0);
    expect(first.items[0]).toMatchObject({ codAmountMinor: 0, tags: [] });
  });

  it("answers the payments failure instead of rows whose cash amounts would be 0 (Review Focus 3)", async () => {
    const order = {
      id: { toString: () => "o-1" },
      orderNumber: { value: "1001" },
      customerRef: "c-1",
      currency: "EGP",
      paymentRef: "i-1",
      history: [{ type: "payment_requested", occurredAt: new Date(0) }],
      shippingAddress: { line1: "1", city: "Cairo", postalCode: "", country: "EG" },
      items: [],
      totalAmount: () => ({ amountMinor: 100 }),
    } as unknown as Order;
    const admin = {
      orders: {
        listOrders: vi.fn().mockResolvedValue({
          status: 200,
          body: { items: [order], pageInfo: { hasNextPage: false, endCursor: null } },
        }),
        fulfillmentsOfOrders: vi.fn().mockResolvedValue({ status: 200, body: [] }),
        orderAnnotations: vi.fn().mockResolvedValue({ status: 200, body: new Map() }),
        paymentIntentsOf: vi
          .fn()
          .mockResolvedValue({ status: 503, body: { message: "payments down" } }),
      },
      customers: { contactsOfCustomers: vi.fn().mockResolvedValue({ status: 200, body: [] }) },
    } as unknown as WiredAdmin;
    const routes = orderOperationsRoutes(admin);

    const exported = await callRoute(routes, "GET", "/orders/export-rows", { query: {} });
    const slips = await callRoute(routes, "GET", "/orders/packing-slips", {
      query: { ids: ["o-1"] },
    });

    expect(exported).toEqual({ status: 503, body: { message: "payments down" } });
    expect(slips).toEqual({ status: 503, body: { message: "payments down" } });
  });
});

describe("GET /orders/packing-slips", () => {
  it("is readable by anyone who reads orders, and caps at 50 ids", () => {
    const route = adminRoutes(buildOrdersAdmin()).find(
      (r) => r.method === "GET" && r.path === "/orders/packing-slips",
    );
    expect(route?.permission).toBe("orders:read");
    const ids = (count: number) => Array.from({ length: count }, (_, i) => `o-${i}`).join(",");
    expect(route?.schema.querystring?.safeParse({ ids: ids(50) }).success).toBe(true);
    expect(route?.schema.querystring?.safeParse({ ids: ids(51) }).success).toBe(false);
    expect(route?.schema.querystring?.safeParse({ ids: "" }).success).toBe(false);
  });

  it("answers the slips in the order asked, leaving out ids this shop does not have", async () => {
    const admin = buildOrdersAdmin();
    const a = await placeTestOrder(admin);
    const b = await placeTestOrder(admin);
    const theirs = await placeTestOrder(admin, "shop-b");

    const response = await callRoute(
      adminRoutes(admin),
      "GET",
      "/orders/packing-slips",
      {
        query: { ids: [b, theirs, a] },
      },
      viewerStaff,
    );

    expect(response.status).toBe(200);
    expect((response.body as { slips: { orderId: string }[] }).slips.map((s) => s.orderId)).toEqual(
      [b, a],
    );
  });

  it("reads the orders with one plain tenant-scoped list — no Fulfillment read", async () => {
    const order = {
      id: { toString: () => "o-1" },
      orderNumber: { value: "1001" },
      customerRef: "c-1",
      currency: "EGP",
      history: [{ type: "placed", occurredAt: new Date(0) }],
      shippingAddress: { line1: "1", city: "Cairo", postalCode: "", country: "EG" },
      items: [],
      totalAmount: () => ({ amountMinor: 100 }),
    } as unknown as Order;
    const admin = {
      orders: {
        listOrders: vi.fn().mockResolvedValue({
          status: 200,
          body: { items: [order], pageInfo: { hasNextPage: false, endCursor: null } },
        }),
        fulfillmentsOfOrders: vi.fn().mockResolvedValue({ status: 200, body: [] }),
        orderAnnotations: vi.fn().mockResolvedValue({ status: 200, body: new Map() }),
        paymentIntentsOf: vi.fn().mockResolvedValue({ status: 200, body: [] }),
      },
      customers: { contactsOfCustomers: vi.fn().mockResolvedValue({ status: 200, body: [] }) },
    } as unknown as WiredAdmin;

    const response = await callRoute(
      orderOperationsRoutes(admin),
      "GET",
      "/orders/packing-slips",
      { query: { ids: ["o-1", "o-2"] } },
      viewerStaff,
    );

    expect(response.status).toBe(200);
    expect(admin.orders.listOrders).toHaveBeenCalledTimes(1);
    expect(admin.orders.listOrders).toHaveBeenCalledWith(viewerStaff, {
      tenantId: expect.any(String),
      ids: ["o-1", "o-2"],
      first: 2,
    });
    expect(admin.orders.fulfillmentsOfOrders).not.toHaveBeenCalled();
  });
});

describe("Part 2: tags on the list, in bulk and in the export", () => {
  const listOf = async (admin: WiredAdmin, query: Record<string, unknown>) => {
    const routes = adminRoutes(admin);
    const route = routes.find((r) => r.method === "GET" && r.path === "/orders");
    const response = await callRoute(routes, "GET", "/orders", {
      query: route?.schema.querystring?.parse(query),
    });
    expect(response.status).toBe(200);
    return (response.body as { items: { id: string; tags: string[] }[] }).items;
  };

  it("accepts add_tags / remove_tags with 1..20 tags only", () => {
    const tags = (count: number) => Array.from({ length: count }, (_, i) => `t${i}`);
    expect(
      bulkOrdersBody.safeParse({ action: "add_tags", orderIds: ["o-1"], tags: tags(20) }).success,
    ).toBe(true);
    expect(
      bulkOrdersBody.safeParse({ action: "remove_tags", orderIds: ["o-1"], tags: tags(21) })
        .success,
    ).toBe(false);
    expect(
      bulkOrdersBody.safeParse({ action: "add_tags", orderIds: ["o-1"], tags: [] }).success,
    ).toBe(false);
    expect(bulkOrdersBody.safeParse({ action: "add_tags", orderIds: ["o-1"] }).success).toBe(false);
  });

  it("tags in bulk as an operator; refuses a viewer before touching any order", async () => {
    const admin = buildOrdersAdmin();
    const a = await placeTestOrder(admin);
    const b = await placeTestOrder(admin);
    const denied = await bulk(
      admin,
      { action: "add_tags", orderIds: [a], tags: ["vip"] },
      viewerStaff,
    );
    expect(denied.status).toBe(403);
    expect((await listOf(admin, {})).every((item) => item.tags.length === 0)).toBe(true);

    await bulk(admin, { action: "add_tags", orderIds: [a], tags: ["VIP"] }, operatorStaff);
    const both = await bulk(
      admin,
      { action: "add_tags", orderIds: [a, b], tags: ["vip"] },
      operatorStaff,
    );
    expect((both.body as BulkBody).results).toEqual([
      { orderId: a, outcome: "skipped", reason: "already_tagged" },
      { orderId: b, outcome: "ok" },
    ]);
    const removed = await bulk(
      admin,
      { action: "remove_tags", orderIds: [a, b], tags: ["Vip"] },
      operatorStaff,
    );
    expect((removed.body as BulkBody).results.map((result) => result.outcome)).toEqual([
      "ok",
      "ok",
    ]);
  });

  it("fails only the order that would pass 250 tags (Review Focus 3)", async () => {
    const admin = buildOrdersAdmin();
    const full = await placeTestOrder(admin);
    const other = await placeTestOrder(admin);
    for (let start = 0; start < 249; start += 20) {
      const size = Math.min(20, 249 - start);
      await bulk(admin, {
        action: "add_tags",
        orderIds: [full],
        tags: Array.from({ length: size }, (_, i) => `t${start + i}`),
      });
    }
    const response = await bulk(admin, {
      action: "add_tags",
      orderIds: [full, other],
      tags: ["new-a", "new-b"],
    });
    expect((response.body as BulkBody).results).toEqual([
      { orderId: full, outcome: "failed", reason: "too_many_tags" },
      { orderId: other, outcome: "ok" },
    ]);
  });

  it("answers a per-order too_many_tags result, not a 422, when the one selected order is over the cap (carried 1)", async () => {
    const admin = buildOrdersAdmin();
    const full = await placeTestOrder(admin);
    for (let start = 0; start < 250; start += 20) {
      const size = Math.min(20, 250 - start);
      await bulk(admin, {
        action: "add_tags",
        orderIds: [full],
        tags: Array.from({ length: size }, (_, i) => `t${start + i}`),
      });
    }
    const response = await bulk(admin, {
      action: "add_tags",
      orderIds: [full],
      tags: ["one-more"],
    });
    expect(response.status).toBe(200);
    expect((response.body as BulkBody).results).toEqual([
      { orderId: full, outcome: "failed", reason: "too_many_tags" },
    ]);
    expect((await listOf(admin, {}))[0]?.tags).toHaveLength(250);
  });

  it("GET /orders filters by every tag given (AND) and lists each order's tags", async () => {
    const admin = buildOrdersAdmin();
    const a = await placeTestOrder(admin);
    const b = await placeTestOrder(admin);
    const c = await placeTestOrder(admin);
    await bulk(admin, { action: "add_tags", orderIds: [a, b], tags: ["VIP"] });
    await bulk(admin, { action: "add_tags", orderIds: [a], tags: ["urgent"] });

    expect((await listOf(admin, { tag: "vip" })).map((item) => item.id).sort()).toEqual(
      [a, b].sort(),
    );
    expect((await listOf(admin, { tag: ["vip", "URGENT"] })).map((item) => item.id)).toEqual([a]);
    const all = await listOf(admin, {});
    expect(all.find((item) => item.id === a)?.tags).toEqual(["urgent", "VIP"]);
    expect(all.find((item) => item.id === c)?.tags).toEqual([]);
  });

  it("export rows (filtered by tag) and packing slips carry the tags and the note", async () => {
    const admin = buildOrdersAdmin();
    const a = await placeTestOrder(admin);
    await placeTestOrder(admin);
    const routes = adminRoutes(admin);
    await bulk(admin, { action: "add_tags", orderIds: [a], tags: ["VIP"] });
    await callRoute(routes, "PUT", "/orders/:orderId/note", {
      params: { orderId: a },
      body: { note: "Ring twice" },
    });
    const exportRoute = routes.find((r) => r.method === "GET" && r.path === "/orders/export-rows");
    const rows = await callRoute(routes, "GET", "/orders/export-rows", {
      query: exportRoute?.schema.querystring?.parse({ tag: "vip" }),
    });
    expect((rows.body as { items: unknown[] }).items).toEqual([
      expect.objectContaining({ orderId: a, tags: ["VIP"], note: "Ring twice" }),
    ]);
    const slipsRoute = routes.find((r) => r.method === "GET" && r.path === "/orders/packing-slips");
    const slips = await callRoute(routes, "GET", "/orders/packing-slips", {
      query: slipsRoute?.schema.querystring?.parse({ ids: a }),
    });
    expect((slips.body as { slips: { note: string | null }[] }).slips[0]?.note).toBe("Ring twice");
  });
});
