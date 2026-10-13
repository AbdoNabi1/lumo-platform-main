import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { Order } from "../domain/order";
import { OrderEvent, type OrderEventType } from "../domain/order-event";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { OrderTotalsSnapshot } from "../domain/value-objects/order-totals-snapshot";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { InMemorySalesSummaryQuery } from "./in-memory-sales-summary-query";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

interface LineSpec {
  readonly productRef: string;
  readonly name: string;
  readonly unitMinor: number;
  readonly quantity: number;
  readonly variantRef?: string;
  readonly variantTitle?: string | null;
}

interface OrderSpec {
  readonly id: string;
  readonly createdAt: string;
  readonly events?: readonly OrderEventType[];
  readonly currency?: string;
  readonly totalMinor?: number | null;
  readonly lines?: readonly LineSpec[];
}

const PAID_PATH: readonly OrderEventType[] = [
  "created",
  "confirmed",
  "awaiting_payment",
  "payment_requested",
  "payment_received",
];

function order(spec: OrderSpec): Order {
  const currency = spec.currency ?? "EGP";
  const lines = spec.lines ?? [{ productRef: "p-1", name: "Widget", unitMinor: 1000, quantity: 1 }];
  const items = lines.map((line, index) =>
    OrderItem.create(
      UniqueEntityId.from(`${spec.id}-item-${index}`),
      must(
        ProductSnapshot.create(
          line.productRef,
          line.name,
          must(Money.create(line.unitMinor, currency)),
          line.variantRef === undefined
            ? undefined
            : {
                variantRef: line.variantRef,
                sku: `sku-${line.variantRef}`,
                variantTitle: line.variantTitle ?? null,
              },
        ),
      ),
      line.quantity,
    ),
  );
  const at = new Date(spec.createdAt);
  const history = (spec.events ?? PAID_PATH).map((type, index) =>
    OrderEvent.create(UniqueEntityId.from(`${spec.id}-evt-${index}`), type, at),
  );
  const address = must(AddressSnapshot.create("1 Main St", "Cairo", "11511", "EG"));
  const totals =
    spec.totalMinor === null || spec.totalMinor === undefined
      ? undefined
      : OrderTotalsSnapshot.create({
          subtotalMinor: spec.totalMinor,
          taxMinor: 0,
          shippingMinor: 0,
          discountMinor: 0,
          totalMinor: spec.totalMinor,
          currency,
        });
  return Order.reconstitute(
    UniqueEntityId.from(spec.id),
    must(OrderNumber.create(`${spec.id}`)),
    "customer-1",
    currency,
    items,
    address,
    history,
    1,
    totals === undefined ? {} : { totals },
  );
}

function queryOver(byTenant: Record<string, readonly Order[]>): InMemorySalesSummaryQuery {
  return new InMemorySalesSummaryQuery({ ordersOf: (tenantId) => byTenant[tenantId] ?? [] });
}

const RANGE = {
  tenantId: "tenant-a",
  from: "2026-10-09",
  to: "2026-10-12",
  timezone: "Africa/Cairo",
  currency: "EGP",
} as const;

describe("InMemorySalesSummaryQuery", () => {
  it("answers zeros, and lists every day of the range with 0, when there are no orders", async () => {
    const summary = await queryOver({}).summarize(RANGE);

    expect(summary).toEqual({
      totalSalesMinor: 0,
      ordersCount: 0,
      averageOrderValueMinor: 0,
      daily: [
        { date: "2026-10-09", salesMinor: 0, orders: 0 },
        { date: "2026-10-10", salesMinor: 0, orders: 0 },
        { date: "2026-10-11", salesMinor: 0, orders: 0 },
      ],
      topProducts: [],
      otherCurrencyOrders: 0,
      openOrderIds: [],
    });
  });

  it("sums the totals of counted orders and averages them, rounding half up", async () => {
    const summary = await queryOver({
      "tenant-a": [
        order({ id: "o1", createdAt: "2026-10-10T09:00:00Z", totalMinor: 5000 }),
        order({ id: "o2", createdAt: "2026-10-10T10:00:00Z", totalMinor: 5001 }),
        order({ id: "o3", createdAt: "2026-10-11T10:00:00Z", totalMinor: 100 }),
      ],
    }).summarize(RANGE);

    expect(summary.totalSalesMinor).toBe(10101);
    expect(summary.ordersCount).toBe(3);
    expect(summary.averageOrderValueMinor).toBe(3367);
    expect(summary.daily).toEqual([
      { date: "2026-10-09", salesMinor: 0, orders: 0 },
      { date: "2026-10-10", salesMinor: 10001, orders: 2 },
      { date: "2026-10-11", salesMinor: 100, orders: 1 },
    ]);
  });

  it("rounds the average half up (10001 over 2 orders is 5001)", async () => {
    const summary = await queryOver({
      "tenant-a": [
        order({ id: "o1", createdAt: "2026-10-10T09:00:00Z", totalMinor: 5000 }),
        order({ id: "o2", createdAt: "2026-10-10T10:00:00Z", totalMinor: 5001 }),
      ],
    }).summarize(RANGE);

    expect(summary.averageOrderValueMinor).toBe(5001);
  });

  it("falls back to the line total for an order placed before totals were snapshotted", async () => {
    const summary = await queryOver({
      "tenant-a": [
        order({
          id: "legacy",
          createdAt: "2026-10-10T09:00:00Z",
          totalMinor: null,
          lines: [{ productRef: "p-1", name: "Widget", unitMinor: 700, quantity: 3 }],
        }),
      ],
    }).summarize(RANGE);

    expect(summary.totalSalesMinor).toBe(2100);
  });

  it("leaves out every order that was ever cancelled, even one that was closed afterwards", async () => {
    const summary = await queryOver({
      "tenant-a": [
        order({ id: "kept", createdAt: "2026-10-10T09:00:00Z", totalMinor: 5000 }),
        order({
          id: "cancelled",
          createdAt: "2026-10-10T09:00:00Z",
          totalMinor: 7000,
          events: ["created", "confirmed", "cancelled"],
        }),
        order({
          id: "cancelled-closed",
          createdAt: "2026-10-10T09:00:00Z",
          totalMinor: 9000,
          events: ["created", "confirmed", "cancelled", "closed"],
        }),
      ],
    }).summarize(RANGE);

    expect(summary.ordersCount).toBe(1);
    expect(summary.totalSalesMinor).toBe(5000);
  });

  it("counts a refunded order in the orders but adds 0 to the sales", async () => {
    const summary = await queryOver({
      "tenant-a": [
        order({ id: "kept", createdAt: "2026-10-10T09:00:00Z", totalMinor: 5000 }),
        order({
          id: "refunded",
          createdAt: "2026-10-10T09:00:00Z",
          totalMinor: 8000,
          events: ["placed", "paid", "refunded"],
        }),
        order({
          id: "refund-requested",
          createdAt: "2026-10-11T09:00:00Z",
          totalMinor: 3000,
          events: [...PAID_PATH, "ready_for_fulfillment", "refund_requested"],
        }),
      ],
    }).summarize(RANGE);

    expect(summary.ordersCount).toBe(3);
    expect(summary.totalSalesMinor).toBe(5000);
    expect(summary.averageOrderValueMinor).toBe(1667);
    expect(summary.daily).toEqual([
      { date: "2026-10-09", salesMinor: 0, orders: 0 },
      { date: "2026-10-10", salesMinor: 5000, orders: 2 },
      { date: "2026-10-11", salesMinor: 0, orders: 1 },
    ]);
  });

  it("excludes another currency from the sums and counts it in otherCurrencyOrders", async () => {
    const summary = await queryOver({
      "tenant-a": [
        order({ id: "egp", createdAt: "2026-10-10T09:00:00Z", totalMinor: 5000 }),
        order({ id: "usd", createdAt: "2026-10-10T09:00:00Z", currency: "USD", totalMinor: 9900 }),
        order({
          id: "usd-cancelled",
          createdAt: "2026-10-10T09:00:00Z",
          currency: "USD",
          totalMinor: 100,
          events: ["created", "cancelled"],
        }),
      ],
    }).summarize(RANGE);

    expect(summary.ordersCount).toBe(1);
    expect(summary.totalSalesMinor).toBe(5000);
    expect(summary.otherCurrencyOrders).toBe(1);
  });

  it("buckets days in the store time zone: 23:30 UTC on Oct 9 is Oct 10 in Africa/Cairo", async () => {
    const orders = [order({ id: "late", createdAt: "2026-10-09T23:30:00Z", totalMinor: 4000 })];

    const cairo = await queryOver({ "tenant-a": orders }).summarize(RANGE);
    const utc = await queryOver({ "tenant-a": orders }).summarize({ ...RANGE, timezone: "UTC" });

    expect(cairo.daily).toEqual([
      { date: "2026-10-09", salesMinor: 0, orders: 0 },
      { date: "2026-10-10", salesMinor: 4000, orders: 1 },
      { date: "2026-10-11", salesMinor: 0, orders: 0 },
    ]);
    expect(utc.daily[0]).toEqual({ date: "2026-10-09", salesMinor: 4000, orders: 1 });
  });

  it("leaves out an order whose local day is before `from` or on/after `to`", async () => {
    const summary = await queryOver({
      "tenant-a": [
        // 21:30 UTC on Oct 8 is Oct 9 00:30 or 01:30 in Cairo, so it is IN.
        order({ id: "in", createdAt: "2026-10-08T22:30:00Z", totalMinor: 100 }),
        // 20:30 UTC on Oct 8 is still Oct 8 in Cairo.
        order({ id: "before", createdAt: "2026-10-08T20:30:00Z", totalMinor: 200 }),
        // 22:30 UTC on Oct 11 is already Oct 12 in Cairo, and `to` is exclusive.
        order({ id: "after", createdAt: "2026-10-11T22:30:00Z", totalMinor: 400 }),
      ],
    }).summarize(RANGE);

    expect(summary.ordersCount).toBe(1);
    expect(summary.totalSalesMinor).toBe(100);
  });

  it("ranks the top products by quantity, then sales, then name, and keeps only five", async () => {
    const line = (productRef: string, name: string, unitMinor: number, quantity: number) => ({
      productRef,
      name,
      unitMinor,
      quantity,
      variantRef: `${productRef}-v`,
      variantTitle: "Large",
    });
    const summary = await queryOver({
      "tenant-a": [
        order({
          id: "o1",
          createdAt: "2026-10-10T09:00:00Z",
          totalMinor: 1,
          lines: [
            line("pa", "Alpha", 100, 3),
            line("pb", "Bravo", 200, 3),
            line("pc", "Charlie", 100, 3),
            line("pd", "Delta", 50, 9),
            line("pe", "Echo", 10, 1),
            line("pf", "Foxtrot", 10, 1),
            line("pg", "Golf", 10, 1),
          ],
        }),
      ],
    }).summarize(RANGE);

    expect(summary.topProducts.map((row) => row.name)).toEqual([
      "Delta",
      "Bravo",
      "Alpha",
      "Charlie",
      "Echo",
    ]);
    expect(summary.topProducts[0]).toEqual({
      productRef: "pd",
      variantRef: "pd-v",
      name: "Delta",
      variantTitle: "Large",
      quantity: 9,
      salesMinor: 450,
    });
  });

  it("adds up the same variant across orders and leaves out refunded, cancelled and other-currency orders", async () => {
    const widget = { productRef: "p-1", name: "Widget", unitMinor: 1000, quantity: 2 };
    const summary = await queryOver({
      "tenant-a": [
        order({ id: "o1", createdAt: "2026-10-10T09:00:00Z", totalMinor: 1, lines: [widget] }),
        order({ id: "o2", createdAt: "2026-10-11T09:00:00Z", totalMinor: 1, lines: [widget] }),
        order({
          id: "refunded",
          createdAt: "2026-10-10T09:00:00Z",
          totalMinor: 1,
          lines: [{ ...widget, quantity: 50 }],
          events: ["placed", "paid", "refunded"],
        }),
        order({
          id: "cancelled",
          createdAt: "2026-10-10T09:00:00Z",
          totalMinor: 1,
          lines: [{ ...widget, quantity: 50 }],
          events: ["created", "cancelled"],
        }),
        order({
          id: "usd",
          createdAt: "2026-10-10T09:00:00Z",
          currency: "USD",
          totalMinor: 1,
          lines: [{ ...widget, quantity: 50 }],
        }),
      ],
    }).summarize(RANGE);

    expect(summary.topProducts).toEqual([
      {
        productRef: "p-1",
        variantRef: null,
        name: "Widget",
        variantTitle: null,
        quantity: 4,
        salesMinor: 4000,
      },
    ]);
  });

  it("lists the open orders all-time: not range-bound, never cancelled, not closed", async () => {
    const summary = await queryOver({
      "tenant-a": [
        order({ id: "open-in-range", createdAt: "2026-10-10T09:00:00Z", totalMinor: 1 }),
        order({ id: "open-old", createdAt: "2026-01-02T09:00:00Z", totalMinor: 1 }),
        order({
          id: "open-usd",
          createdAt: "2026-10-10T09:00:00Z",
          currency: "USD",
          totalMinor: 1,
        }),
        order({
          id: "cancelled",
          createdAt: "2026-10-10T09:00:00Z",
          totalMinor: 1,
          events: ["created", "cancelled"],
        }),
        order({
          id: "paid-and-ready",
          createdAt: "2026-10-10T09:00:00Z",
          totalMinor: 1,
          events: [...PAID_PATH, "ready_for_fulfillment"],
        }),
        order({
          id: "cancelled-then-closed",
          createdAt: "2026-10-10T09:00:00Z",
          totalMinor: 1,
          events: ["created", "cancelled", "closed"],
        }),
        order({
          id: "delivered-then-closed",
          createdAt: "2026-02-10T09:00:00Z",
          totalMinor: 1,
          events: [...PAID_PATH, "delivered", "closed"],
        }),
      ],
    }).summarize({ ...RANGE, includeOpenOrderIds: true });

    expect([...summary.openOrderIds].sort()).toEqual(
      ["open-in-range", "open-old", "open-usd", "paid-and-ready"].sort(),
    );
  });

  it("does not list open orders unless asked", async () => {
    const summary = await queryOver({
      "tenant-a": [order({ id: "open", createdAt: "2026-10-10T09:00:00Z", totalMinor: 1 })],
    }).summarize(RANGE);

    expect(summary.openOrderIds).toEqual([]);
  });

  it("never counts another shop's orders", async () => {
    const summary = await queryOver({
      "tenant-a": [order({ id: "mine", createdAt: "2026-10-10T09:00:00Z", totalMinor: 5000 })],
      "tenant-b": [
        order({ id: "theirs", createdAt: "2026-10-10T09:00:00Z", totalMinor: 99999 }),
        order({
          id: "theirs-usd",
          createdAt: "2026-10-10T09:00:00Z",
          currency: "USD",
          totalMinor: 1,
        }),
      ],
    }).summarize({ ...RANGE, includeOpenOrderIds: true });

    expect(summary.ordersCount).toBe(1);
    expect(summary.totalSalesMinor).toBe(5000);
    expect(summary.otherCurrencyOrders).toBe(0);
    expect(summary.openOrderIds).toEqual(["mine"]);
    expect(summary.topProducts).toHaveLength(1);
  });
});
