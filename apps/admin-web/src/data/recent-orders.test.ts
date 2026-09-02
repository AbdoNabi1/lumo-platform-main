import { describe, expect, it, vi } from "vitest";
import type { FetchOrdersResult } from "@/lib/api/orders";

const fetchRecentOrders = vi.fn<() => Promise<FetchOrdersResult>>();
vi.mock("@/lib/api/orders", () => ({ fetchRecentOrders: () => fetchRecentOrders() }));

const { getRecentOrders } = await import("./recent-orders");

describe("getRecentOrders", () => {
  it("maps a real order into the widget's RecentOrder shape, without a fabricated customer name", async () => {
    fetchRecentOrders.mockResolvedValue({
      outcome: "ok",
      orders: [
        {
          id: "order-1",
          orderNumber: "ORD-1",
          customerRef: "cust-abc123",
          status: "paid",
          currency: "USD",
          totalMinor: 1999,
          createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        },
      ],
    });

    const result = await getRecentOrders();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.orders).toHaveLength(1);
    const order = result.orders[0];
    expect(order?.id).toBe("order-1");
    expect(order?.reference).toBe("#ORD-1");
    expect(order?.status).toBe("paid");
    expect(order?.total).toEqual({ amountMinor: 1999, currency: "USD" });
    expect(order?.minutesAgo).toBeGreaterThanOrEqual(4);
    // No Identity integration exists yet — the display name must come from the real
    // customerRef, never an invented name (a human name would never contain "ABC123").
    expect(order?.customerName).toContain("ABC123");
  });

  it("buckets mid-lifecycle statuses to 'processing' rather than guessing paid/refunded", async () => {
    fetchRecentOrders.mockResolvedValue({
      outcome: "ok",
      orders: [
        {
          id: "order-2",
          orderNumber: "ORD-2",
          customerRef: "cust-2",
          status: "awaiting_payment",
          currency: "USD",
          totalMinor: 500,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const result = await getRecentOrders();
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.orders[0]?.status).toBe("processing");
  });

  it("buckets refund-related statuses to 'refunded'", async () => {
    fetchRecentOrders.mockResolvedValue({
      outcome: "ok",
      orders: [
        {
          id: "order-3",
          orderNumber: "ORD-3",
          customerRef: "cust-3",
          status: "returned",
          currency: "USD",
          totalMinor: 500,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const result = await getRecentOrders();
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.orders[0]?.status).toBe("refunded");
  });

  it("returns ok with an empty list when the API has no orders yet", async () => {
    fetchRecentOrders.mockResolvedValue({ outcome: "ok", orders: [] });
    const result = await getRecentOrders();
    expect(result).toEqual({ status: "ok", orders: [] });
  });

  it("surfaces unauthorized without ever falling back to demo data", async () => {
    fetchRecentOrders.mockResolvedValue({ outcome: "unauthorized" });
    const result = await getRecentOrders();
    expect(result).toEqual({ status: "unauthorized" });
  });

  it("surfaces an error without ever falling back to demo data", async () => {
    fetchRecentOrders.mockResolvedValue({ outcome: "error", message: "boom" });
    const result = await getRecentOrders();
    expect(result).toEqual({ status: "error", message: "boom" });
  });
});
