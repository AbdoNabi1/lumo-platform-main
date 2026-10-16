import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const { fetchSalesAnalytics } = await import("./sales-analytics");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const range = (totalSalesMinor: number, ordersCount: number) => ({
  totalSalesMinor,
  ordersCount,
  averageOrderValueMinor: ordersCount === 0 ? 0 : Math.round(totalSalesMinor / ordersCount),
  daily: [{ date: "2026-10-12", salesMinor: totalSalesMinor, orders: ordersCount }],
  otherCurrencyOrders: 0,
});

const report = {
  current: {
    ...range(4498, 2),
    ordersToFulfill: 3,
    topProducts: [
      {
        productRef: "p-1",
        variantRef: null,
        name: "Toy Wagon",
        variantTitle: null,
        quantity: 2,
        salesMinor: 4498,
        imageUrl: null,
      },
    ],
  },
  previous: range(0, 0),
  currency: "EGP",
  timezone: "Africa/Cairo",
  range: { from: "2026-10-12", to: "2026-10-13" },
  previousRange: { from: "2026-10-11", to: "2026-10-12" },
};

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchSalesAnalytics", () => {
  it("asks the API for the range by name, so the shop's own zone decides what today is", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, report));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSalesAnalytics("30d");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/analytics/sales?range=30d");
  });

  it("returns the report as the API sent it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, report)));

    const result = await fetchSalesAnalytics("today");

    expect(result).toEqual({ outcome: "ok", data: report });
  });

  it("returns zeros as zeros", async () => {
    const empty = {
      ...report,
      current: { ...range(0, 0), ordersToFulfill: 0, topProducts: [] },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, empty)));

    const result = await fetchSalesAnalytics("7d");

    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") {
      expect(result.data.current.totalSalesMinor).toBe(0);
      expect(result.data.current.ordersToFulfill).toBe(0);
    }
  });

  it("is unauthorized for a 401 or a 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, {})));
    expect(await fetchSalesAnalytics("7d")).toEqual({ outcome: "unauthorized" });
  });

  it("is an error for a 500, with no numbers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { message: "boom" })));

    const result = await fetchSalesAnalytics("7d");

    expect(result.outcome).toBe("error");
    expect(result).not.toHaveProperty("data");
  });

  it("is an error when the API cannot be reached, never sample figures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    const result = await fetchSalesAnalytics("7d");

    expect(result.outcome).toBe("error");
    expect(result).not.toHaveProperty("data");
  });

  it.each([
    ["a missing current range", { ...report, current: undefined }],
    ["a non-numeric total", { ...report, current: { ...report.current, totalSalesMinor: "12" } }],
    ["a daily series that is not a list", { ...report, current: { ...report.current, daily: 3 } }],
    [
      "a top product without a name",
      {
        ...report,
        current: { ...report.current, topProducts: [{ productRef: "p-1" }] },
      },
    ],
    ["no currency", { ...report, currency: undefined }],
  ])("is an error for a response with %s", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchSalesAnalytics("7d");

    expect(result.outcome).toBe("error");
  });
});
