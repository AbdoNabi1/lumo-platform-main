import { describe, expect, it, vi } from "vitest";
import type { Order } from "@platform/orders";
import type { WiredAdmin } from "../composition";
import { listUnfulfilledOrders, UNFULFILLED_SCAN_CAP } from "./unfulfilled-orders";

const principal = { id: "staff-1", kind: "staff", roles: ["admin"] } as never;

/** An order as the list sees it: an id and an append-only history. */
function order(id: string, ...history: string[]): Order {
  return {
    id: { toString: () => id },
    history: (history.length === 0 ? ["created"] : history).map((type) => ({ type })),
  } as unknown as Order;
}

/**
 * A stand-in for Orders + Fulfillment over `orders` (newest first). `opened` are the order ids that
 * have a fulfillment order, with the Fulfillment status each one is in.
 */
function adminOver(orders: readonly Order[], opened: Readonly<Record<string, string>> = {}) {
  const listOrders = vi.fn(
    async (_principal: unknown, input: { first?: number; after?: string }) => {
      const start =
        input.after === undefined
          ? 0
          : orders.findIndex((o) => o.id.toString() === input.after) + 1;
      const first = input.first ?? 20;
      const items = orders.slice(start, start + first);
      const hasNextPage = start + first < orders.length;
      return {
        status: 200,
        body: {
          items,
          pageInfo: { hasNextPage, endCursor: items.at(-1)?.id.toString() ?? null },
        },
      };
    },
  );
  const fulfillmentsOfOrders = vi.fn(
    async (_principal: unknown, input: { orderIds: readonly string[] }) => ({
      status: 200,
      body: input.orderIds
        .filter((id) => opened[id] !== undefined)
        .map((id) => ({ orderRef: id, status: { value: opened[id] } })),
    }),
  );
  return {
    admin: { orders: { listOrders, fulfillmentsOfOrders } } as unknown as WiredAdmin,
    listOrders,
    fulfillmentsOfOrders,
  };
}

const ids = (page: { items: readonly Order[] }) => page.items.map((o) => o.id.toString());

async function run(
  admin: WiredAdmin,
  query: { first?: number; after?: string; search?: string } = {},
) {
  const result = await listUnfulfilledOrders(admin, principal, "tenant-a", query);
  if (!result.ok) throw new Error(`unexpected failure ${JSON.stringify(result.response)}`);
  return result;
}

describe("listUnfulfilledOrders (GET /orders?fulfillment=unfulfilled)", () => {
  it("keeps the open orders Plan 3B calls unfulfilled and leaves the others out", async () => {
    const { admin } = adminOver(
      [
        order("o1"), // no fulfillment order: unfulfilled
        order("o2"), // being picked: in progress
        order("o3"), // shipped: fulfilled
        order("o4"), // reservation failed, nothing moving: unfulfilled
      ],
      { o2: "picking_started", o3: "shipment_dispatched", o4: "failed" },
    );

    const result = await run(admin);

    expect(ids(result.page)).toEqual(["o1", "o4"]);
    expect(result.page.pageInfo.hasNextPage).toBe(false);
    expect(result.statuses.get("o1")).toBe("unfulfilled");
  });

  it("leaves out cancelled and closed orders without asking Fulfillment about them", async () => {
    const { admin, fulfillmentsOfOrders } = adminOver([
      order("open"),
      order("cancelled", "created", "cancelled"),
      order("cancelled-closed", "created", "cancelled", "closed"),
      order("closed", "created", "delivered", "closed"),
    ]);

    const result = await run(admin);

    expect(ids(result.page)).toEqual(["open"]);
    expect(fulfillmentsOfOrders).toHaveBeenCalledTimes(1);
    expect(fulfillmentsOfOrders.mock.calls[0]?.[1].orderIds).toEqual(["open"]);
  });

  it("fills a page from several batches of the list, newest first", async () => {
    const all = Array.from({ length: 250 }, (_, index) => order(`o${index}`));
    // only every tenth order (o1, o11, o21, …) is still unfulfilled
    const opened = Object.fromEntries(
      all.filter((_, index) => index % 10 !== 1).map((o) => [o.id.toString(), "created"]),
    );
    const { admin, listOrders } = adminOver(all, opened);

    const result = await run(admin, { first: 20 });

    expect(ids(result.page)).toEqual(
      Array.from({ length: 20 }, (_, index) => `o${index * 10 + 1}`),
    );
    expect(result.page.pageInfo.hasNextPage).toBe(true);
    expect(result.page.pageInfo.endCursor).toBe("o191");
    expect(listOrders.mock.calls.length).toBeGreaterThan(1);
  });

  it("continues from the cursor of the last order it returned, without skipping or repeating one", async () => {
    const all = Array.from({ length: 30 }, (_, index) => order(`o${index}`));
    const { admin } = adminOver(all);

    const first = await run(admin, { first: 10 });
    const second = await run(admin, {
      first: 10,
      after: first.page.pageInfo.endCursor ?? undefined,
    });
    const third = await run(admin, {
      first: 10,
      after: second.page.pageInfo.endCursor ?? undefined,
    });

    expect([...ids(first.page), ...ids(second.page), ...ids(third.page)]).toEqual(
      all.map((o) => o.id.toString()),
    );
    expect(first.page.pageInfo.hasNextPage).toBe(true);
    expect(third.page.pageInfo.hasNextPage).toBe(false);
  });

  it(`stops after scanning ${UNFULFILLED_SCAN_CAP} orders and hands back the cursor to resume from`, async () => {
    // every order is fulfilled, so nothing ever matches and the cap is what ends the scan
    const all = Array.from({ length: 1200 }, (_, index) => order(`o${index}`));
    const opened = Object.fromEntries(all.map((o) => [o.id.toString(), "shipment_dispatched"]));
    const { admin, listOrders } = adminOver(all, opened);

    const result = await run(admin, { first: 20 });

    expect(result.page.items).toEqual([]);
    expect(result.page.pageInfo.hasNextPage).toBe(true);
    expect(result.page.pageInfo.endCursor).toBe(`o${UNFULFILLED_SCAN_CAP - 1}`);
    const scanned = listOrders.mock.calls.reduce((sum, call) => sum + (call[1].first ?? 0), 0);
    expect(scanned).toBe(UNFULFILLED_SCAN_CAP);
  });

  it("passes the search through to the orders it scans", async () => {
    const { admin, listOrders } = adminOver([order("o1")]);

    await run(admin, { search: "1001" });

    expect(listOrders.mock.calls[0]?.[1]).toMatchObject({ tenantId: "tenant-a", search: "1001" });
  });

  it("answers the failure of the orders read as it is", async () => {
    const { admin } = adminOver([]);
    (admin.orders as unknown as { listOrders: unknown }).listOrders = async () => ({
      status: 500,
      body: {},
    });

    const result = await listUnfulfilledOrders(admin, principal, "tenant-a", {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(500);
  });

  it("never lists an order as unfulfilled when Fulfillment cannot be read: it answers the failure", async () => {
    const { admin } = adminOver([order("o1")]);
    (admin.orders as unknown as { fulfillmentsOfOrders: unknown }).fulfillmentsOfOrders =
      async () => ({
        status: 500,
        body: {},
      });

    const result = await listUnfulfilledOrders(admin, principal, "tenant-a", {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(500);
  });
});
