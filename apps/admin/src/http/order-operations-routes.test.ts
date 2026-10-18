import { describe, expect, it } from "vitest";
import type { WiredAdmin } from "../composition";
import { adminRoutes } from "./admin-routes";
import { bulkOrdersBody } from "./order-operations-routes";
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
