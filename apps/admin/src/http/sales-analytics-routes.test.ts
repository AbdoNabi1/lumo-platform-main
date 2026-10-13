import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WiredAdmin } from "../composition";
import type * as ProductImages from "./product-images";
import { lineKey, resolveLineImages } from "./product-images";
import { salesAnalyticsRoutes } from "./sales-analytics-routes";

vi.mock("./product-images", async (importOriginal) => ({
  ...(await importOriginal<typeof ProductImages>()),
  resolveLineImages: vi.fn(),
}));

const day = (date: string, salesMinor: number, orders: number) => ({ date, salesMinor, orders });

function summary(overrides: Record<string, unknown> = {}) {
  return {
    totalSalesMinor: 0,
    ordersCount: 0,
    averageOrderValueMinor: 0,
    daily: [],
    topProducts: [],
    otherCurrencyOrders: 0,
    openOrderIds: [],
    ...overrides,
  };
}

function report(current: Record<string, unknown>, previous: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: {
      current: summary(current),
      previous: summary(previous),
      currency: "EGP",
      timezone: "Africa/Cairo",
    },
  };
}

function fulfillmentOrder(orderRef: string, status: string) {
  return { orderRef, status: { value: status } };
}

const SHOP = { currency: "EGP", timezone: "Africa/Cairo" };

function adminWith(parts: {
  getStoreRegion?: ReturnType<typeof vi.fn>;
  salesReport?: ReturnType<typeof vi.fn>;
  fulfillmentsOfOrders?: ReturnType<typeof vi.fn>;
}) {
  return {
    orders: {
      salesReport: parts.salesReport ?? vi.fn().mockResolvedValue(report({})),
      fulfillmentsOfOrders:
        parts.fulfillmentsOfOrders ?? vi.fn().mockResolvedValue({ status: 200, body: [] }),
    },
    tenancy: {
      getStoreRegion:
        parts.getStoreRegion ?? vi.fn().mockResolvedValue({ status: 200, body: SHOP }),
    },
    mediaImages: {},
    publicReads: {},
  } as unknown as WiredAdmin;
}

interface SalesBody {
  readonly currency: string;
  readonly timezone: string;
  readonly range: unknown;
  readonly previousRange: unknown;
  readonly current: {
    readonly ordersToFulfill: number;
    readonly topProducts: readonly { readonly imageUrl: string | null }[];
  };
  readonly previous: unknown;
  readonly error: { readonly code: string };
}

const principal = { id: "staff-1", kind: "staff", roles: ["admin"] };

async function invoke(admin: WiredAdmin, query: Record<string, string | undefined>) {
  const route = salesAnalyticsRoutes(admin).find((r) => r.path === "/analytics/sales");
  if (route === undefined) throw new Error("no /analytics/sales route");
  return (await route.handle({
    body: undefined,
    params: undefined,
    query,
    context: { tenantId: "tenant-a", principal, requestId: "req-1" },
  } as never)) as { status: number; body: SalesBody };
}

beforeEach(() => {
  vi.mocked(resolveLineImages).mockReset();
  vi.mocked(resolveLineImages).mockResolvedValue(new Map());
});

describe("GET /analytics/sales", () => {
  it("is a versioned staff route that needs orders:read", () => {
    const route = salesAnalyticsRoutes(adminWith({})).find((r) => r.path === "/analytics/sales");

    expect(route?.method).toBe("GET");
    expect(route?.permission).toBe("orders:read");
  });

  it("asks the controller for the range in the caller's own tenant, in the shop's zone and currency", async () => {
    const salesReport = vi.fn().mockResolvedValue(report({}));
    const getStoreRegion = vi.fn().mockResolvedValue({ status: 200, body: SHOP });

    await invoke(adminWith({ salesReport, getStoreRegion }), {
      from: "2026-10-06",
      to: "2026-10-13",
    });

    expect(getStoreRegion).toHaveBeenCalledWith(principal);
    expect(salesReport).toHaveBeenCalledWith(principal, {
      tenantId: "tenant-a",
      from: "2026-10-06",
      to: "2026-10-13",
      ...SHOP,
    });
  });

  it("answers a failed read of the shop's zone as it is, and reads no orders", async () => {
    const salesReport = vi.fn();

    const response = await invoke(
      adminWith({
        salesReport,
        getStoreRegion: vi.fn().mockResolvedValue({ status: 500, body: { message: "down" } }),
      }),
      { from: "2026-10-06", to: "2026-10-13" },
    );

    expect(response.status).toBe(500);
    expect(salesReport).not.toHaveBeenCalled();
  });

  it("answers both ranges, the shop's currency and zone, and the ranges themselves", async () => {
    const response = await invoke(
      adminWith({
        salesReport: vi.fn().mockResolvedValue(
          report(
            {
              totalSalesMinor: 300,
              ordersCount: 2,
              averageOrderValueMinor: 150,
              daily: [day("2026-10-12", 300, 2)],
            },
            {
              totalSalesMinor: 200,
              ordersCount: 1,
              averageOrderValueMinor: 200,
              daily: [day("2026-10-11", 200, 1)],
            },
          ),
        ),
      }),
      { from: "2026-10-12", to: "2026-10-13" },
    );

    expect(response.status).toBe(200);
    expect(response.body.currency).toBe("EGP");
    expect(response.body.timezone).toBe("Africa/Cairo");
    expect(response.body.range).toEqual({ from: "2026-10-12", to: "2026-10-13" });
    expect(response.body.previousRange).toEqual({ from: "2026-10-11", to: "2026-10-12" });
    expect(response.body.current).toMatchObject({
      totalSalesMinor: 300,
      ordersCount: 2,
      averageOrderValueMinor: 150,
      daily: [day("2026-10-12", 300, 2)],
    });
    expect(response.body.previous).toMatchObject({
      totalSalesMinor: 200,
      ordersCount: 1,
      daily: [day("2026-10-11", 200, 1)],
    });
  });

  it("counts as 'to fulfill' only the open orders the Plan 3B derivation calls unfulfilled", async () => {
    const fulfillmentsOfOrders = vi.fn().mockResolvedValue({
      status: 200,
      body: [
        fulfillmentOrder("o2", "created"), // in progress: no longer waiting to be fulfilled
        fulfillmentOrder("o3", "shipment_dispatched"), // fulfilled
        fulfillmentOrder("o5", "failed"), // the reservation failed, nothing is moving: unfulfilled
      ],
    });

    const response = await invoke(
      adminWith({
        salesReport: vi
          .fn()
          .mockResolvedValue(report({ openOrderIds: ["o1", "o2", "o3", "o4", "o5"] })),
        fulfillmentsOfOrders,
      }),
      { from: "2026-10-12", to: "2026-10-13" },
    );

    // o1 and o4 never got a fulfillment order, o5's failed
    expect(response.body.current.ordersToFulfill).toBe(3);
  });

  it("shows zero to fulfill when there are no open orders, without asking Fulfillment", async () => {
    const fulfillmentsOfOrders = vi.fn();

    const response = await invoke(adminWith({ fulfillmentsOfOrders }), {
      from: "2026-10-12",
      to: "2026-10-13",
    });

    expect(response.body.current.ordersToFulfill).toBe(0);
    expect(fulfillmentsOfOrders).not.toHaveBeenCalled();
  });

  it("reads Fulfillment in batches of 500 however many orders are open", async () => {
    const ids = Array.from({ length: 1200 }, (_, index) => `o${index}`);
    const fulfillmentsOfOrders = vi.fn().mockResolvedValue({ status: 200, body: [] });

    const response = await invoke(
      adminWith({
        salesReport: vi.fn().mockResolvedValue(report({ openOrderIds: ids })),
        fulfillmentsOfOrders,
      }),
      { from: "2026-10-12", to: "2026-10-13" },
    );

    expect(fulfillmentsOfOrders.mock.calls.map((call) => call[1].orderIds.length)).toEqual([
      500, 500, 200,
    ]);
    expect(response.body.current.ordersToFulfill).toBe(1200);
  });

  it("never shows a made-up count when Fulfillment cannot be read: it answers the failure", async () => {
    const response = await invoke(
      adminWith({
        salesReport: vi.fn().mockResolvedValue(report({ openOrderIds: ["o1"] })),
        fulfillmentsOfOrders: vi.fn().mockResolvedValue({ status: 500, body: { message: "down" } }),
      }),
      { from: "2026-10-12", to: "2026-10-13" },
    );

    expect(response.status).toBe(500);
  });

  it("does not hand the open order ids to the browser", async () => {
    const response = await invoke(
      adminWith({
        salesReport: vi
          .fn()
          .mockResolvedValue(report({ openOrderIds: ["o1"] }, { openOrderIds: ["o9"] })),
      }),
      { from: "2026-10-12", to: "2026-10-13" },
    );

    expect(JSON.stringify(response.body)).not.toContain("openOrderIds");
    expect(JSON.stringify(response.body)).not.toContain("o1");
  });

  it("puts the picture on each top product through the batched image lookup", async () => {
    vi.mocked(resolveLineImages).mockResolvedValue(
      new Map([
        [
          lineKey("p-1", "v-1"),
          { id: "img-1", url: "https://cdn.example/1.jpg", alt: null, width: 10, height: 10 },
        ],
      ]) as never,
    );
    const top = (productRef: string, variantRef: string | null) => ({
      productRef,
      variantRef,
      name: productRef,
      variantTitle: null,
      quantity: 1,
      salesMinor: 1,
    });

    const response = await invoke(
      adminWith({
        salesReport: vi
          .fn()
          .mockResolvedValue(report({ topProducts: [top("p-1", "v-1"), top("p-2", null)] })),
      }),
      { from: "2026-10-12", to: "2026-10-13" },
    );

    expect(resolveLineImages).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveLineImages).mock.calls[0]?.[1]).toBe("tenant-a");
    expect(vi.mocked(resolveLineImages).mock.calls[0]?.[2]).toEqual([
      { productId: "p-1", variantId: "v-1" },
      { productId: "p-2", variantId: null },
    ]);
    expect(response.body.current.topProducts.map((product) => product.imageUrl)).toEqual([
      "https://cdn.example/1.jpg",
      null,
    ]);
  });

  it.each([
    ["no range", {}],
    ["a missing end", { from: "2026-10-06" }],
    ["a malformed date", { from: "6/10/2026", to: "2026-10-13" }],
    ["an end before the start", { from: "2026-10-13", to: "2026-10-06" }],
    ["an empty range", { from: "2026-10-13", to: "2026-10-13" }],
    ["more than 366 days", { from: "2025-10-11", to: "2026-10-13" }],
  ])("answers 400 for %s and reads nothing", async (_label, query) => {
    const salesReport = vi.fn();

    const response = await invoke(adminWith({ salesReport }), query);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_RANGE");
    expect(salesReport).not.toHaveBeenCalled();
  });

  it("answers the controller's refusal as it is (a 403 stays a 403)", async () => {
    const response = await invoke(
      adminWith({
        salesReport: vi.fn().mockResolvedValue({ status: 403, body: { code: "FORBIDDEN" } }),
      }),
      { from: "2026-10-12", to: "2026-10-13" },
    );

    expect(response.status).toBe(403);
  });
});
