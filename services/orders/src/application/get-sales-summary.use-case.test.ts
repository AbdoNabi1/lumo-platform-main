import { describe, expect, it } from "vitest";
import { GetSalesSummary } from "./get-sales-summary.use-case";
import type { SalesSummary, SalesSummaryInput, SalesSummaryQuery } from "./sales-summary";

const EMPTY: SalesSummary = {
  totalSalesMinor: 0,
  ordersCount: 0,
  averageOrderValueMinor: 0,
  daily: [],
  topProducts: [],
  otherCurrencyOrders: 0,
  openOrderIds: [],
};

function recordingQuery(): { query: SalesSummaryQuery; received: SalesSummaryInput[] } {
  const received: SalesSummaryInput[] = [];
  return {
    received,
    query: {
      summarize: async (input) => {
        received.push(input);
        return EMPTY;
      },
    },
  };
}

const INPUT = {
  tenantId: "tenant-a",
  from: "2026-10-06",
  to: "2026-10-13",
  timezone: "Africa/Cairo",
  currency: "EGP",
} as const;

describe("GetSalesSummary", () => {
  it("hands a valid range to the query unchanged", async () => {
    const { query, received } = recordingQuery();

    const result = await new GetSalesSummary({ sales: query }).execute({
      ...INPUT,
      includeOpenOrderIds: true,
    });

    expect(result.ok).toBe(true);
    expect(received).toEqual([{ ...INPUT, includeOpenOrderIds: true }]);
  });

  it("refuses a bad range without reading anything", async () => {
    const { query, received } = recordingQuery();

    const result = await new GetSalesSummary({ sales: query }).execute({
      ...INPUT,
      from: "2026-10-13",
      to: "2026-10-06",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    expect(received).toEqual([]);
  });

  it("refuses a time zone it does not know", async () => {
    const { query, received } = recordingQuery();

    const result = await new GetSalesSummary({ sales: query }).execute({
      ...INPUT,
      timezone: "Mars/Olympus",
    });

    expect(result.ok).toBe(false);
    expect(received).toEqual([]);
  });
});
