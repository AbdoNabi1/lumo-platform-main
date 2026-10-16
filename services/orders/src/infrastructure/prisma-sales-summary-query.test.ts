import { describe, expect, it } from "vitest";
import type { Database } from "@platform/db";
import { PrismaSalesSummaryQuery } from "./prisma-sales-summary-query";

interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

type Answer = readonly Record<string, unknown>[];

/**
 * A database whose interactive transaction hands the query a client with only the tagged-template
 * `$queryRaw`/`$executeRaw` the read model uses. Each `$queryRaw` answers the next canned result.
 */
function fakeDatabase(answers: readonly Answer[]) {
  const calls: RawCall[] = [];
  let next = 0;
  const client = {
    $executeRaw: async () => 0,
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?").replace(/\s+/g, " "), values });
      const answer = answers[next] ?? [];
      next += 1;
      return answer;
    },
  };
  const database = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  } as unknown as Database;
  return { database, calls };
}

const RANGE = {
  tenantId: "tenant-a",
  from: "2026-10-09",
  to: "2026-10-12",
  timezone: "Africa/Cairo",
  currency: "EGP",
} as const;

/** The one table reference in each FROM/JOIN/subquery must be tenant-filtered; count them. */
function tenantFilterCount(sql: string): number {
  return (sql.match(/"?tenant_id"? = \?/g) ?? []).length;
}

describe("PrismaSalesSummaryQuery", () => {
  it("scopes every statement to the tenant, as a bound parameter", async () => {
    const { database, calls } = fakeDatabase([[], [], []]);

    await new PrismaSalesSummaryQuery({ prisma: database }).summarize(RANGE);

    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      expect(call.values).toContain("tenant-a");
      expect(call.sql).not.toContain("tenant-a");
      expect(tenantFilterCount(call.sql)).toBeGreaterThan(0);
    }
  });

  it("filters the tenant on every orders, order_items and order_events reference", async () => {
    const { database, calls } = fakeDatabase([[], [], []]);

    await new PrismaSalesSummaryQuery({ prisma: database }).summarize(RANGE);

    for (const call of calls) {
      const tables = (call.sql.match(/"orders"\."(orders|order_items|order_events)"/g) ?? [])
        .length;
      expect(tenantFilterCount(call.sql)).toBeGreaterThanOrEqual(tables);
    }
  });

  it("buckets days in the store time zone and binds the zone, the currency and the range", async () => {
    const { database, calls } = fakeDatabase([[], [], []]);

    await new PrismaSalesSummaryQuery({ prisma: database }).summarize(RANGE);

    const daily = calls[0];
    expect(daily?.sql).toContain("AT TIME ZONE 'UTC') AT TIME ZONE ?");
    expect(daily?.sql).toContain("GROUP BY");
    expect(daily?.values).toEqual(expect.arrayContaining(["Africa/Cairo", "EGP", "2026-10-09"]));
    expect(daily?.values).toEqual(expect.arrayContaining(["2026-10-12"]));
  });

  it("leaves out cancelled orders and zeroes refunded ones using the shared event-type lists", async () => {
    const { database, calls } = fakeDatabase([[], [], []]);

    await new PrismaSalesSummaryQuery({ prisma: database }).summarize(RANGE);

    const daily = calls[0];
    const flattened = JSON.stringify(daily?.values);
    expect(flattened).toContain("cancelled");
    expect(flattened).toContain("refunded");
    expect(flattened).toContain("refund_requested");
    expect(daily?.sql).toContain("NOT EXISTS");
    expect(daily?.sql).toContain('"order_events"');
  });

  it("fills every day of the range and turns bigint aggregates into numbers", async () => {
    const { database } = fakeDatabase([
      [{ day: "2026-10-10", orders: 2n, sales_minor: 10001n }],
      [
        {
          product_ref: "p-1",
          variant_ref: "v-1",
          name: "Widget",
          variant_title: "L",
          quantity: 4n,
          sales_minor: 4000n,
        },
      ],
      [{ count: 3n }],
    ]);

    const summary = await new PrismaSalesSummaryQuery({ prisma: database }).summarize(RANGE);

    expect(summary).toEqual({
      totalSalesMinor: 10001,
      ordersCount: 2,
      averageOrderValueMinor: 5001,
      daily: [
        { date: "2026-10-09", salesMinor: 0, orders: 0 },
        { date: "2026-10-10", salesMinor: 10001, orders: 2 },
        { date: "2026-10-11", salesMinor: 0, orders: 0 },
      ],
      topProducts: [
        {
          productRef: "p-1",
          variantRef: "v-1",
          name: "Widget",
          variantTitle: "L",
          quantity: 4,
          salesMinor: 4000,
        },
      ],
      otherCurrencyOrders: 3,
      openOrderIds: [],
    });
  });

  it("reads the open orders only when asked, with no date bound", async () => {
    const withOpen = fakeDatabase([[], [], [], [{ id: "o-1" }, { id: "o-2" }]]);
    const without = fakeDatabase([[], [], []]);

    const asked = await new PrismaSalesSummaryQuery({ prisma: withOpen.database }).summarize({
      ...RANGE,
      includeOpenOrderIds: true,
    });
    await new PrismaSalesSummaryQuery({ prisma: without.database }).summarize(RANGE);

    expect(asked.openOrderIds).toEqual(["o-1", "o-2"]);
    expect(withOpen.calls).toHaveLength(4);
    expect(without.calls).toHaveLength(3);
    const open = withOpen.calls[3];
    expect(open?.values).toContain("tenant-a");
    expect(open?.sql).not.toContain("created_at");
  });
});
