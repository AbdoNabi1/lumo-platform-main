import type { Order } from "../domain/order";
import { CANCELLED_EVENT_TYPE, REFUNDED_EVENT_TYPES } from "../domain/order-statuses";
import {
  assembleSalesSummary,
  type MeasuredDay,
  type SalesSummary,
  type SalesSummaryInput,
  type SalesSummaryQuery,
  type TopProduct,
} from "../application/sales-summary";

export interface InMemorySalesSummaryQueryDeps {
  /** Every order of ONE shop; the query never sees another shop's orders. */
  readonly ordersOf: (tenantId: string) => readonly Order[];
}

/** The shop-local calendar day (`YYYY-MM-DD`) of an instant. */
function localDay(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function isCancelled(order: Order): boolean {
  return order.history.some((entry) => entry.type === CANCELLED_EVENT_TYPE);
}

function isRefunded(order: Order): boolean {
  return order.history.some((entry) => REFUNDED_EVENT_TYPES.includes(entry.type));
}

function isClosed(order: Order): boolean {
  return order.status === "closed";
}

/** When the order was placed: its first history entry (the record, as the SQL's `created_at` is). */
function placedAt(order: Order): Date {
  const first = order.history[0];
  if (first === undefined) throw new Error("Order has no history");
  return first.occurredAt;
}

/**
 * The offline twin of {@link PrismaSalesSummaryQuery}: the same question over the in-memory
 * repository's orders, with the same semantics (counted orders, refunds, zero days, time zone).
 */
export class InMemorySalesSummaryQuery implements SalesSummaryQuery {
  private readonly deps: InMemorySalesSummaryQueryDeps;

  constructor(deps: InMemorySalesSummaryQueryDeps) {
    this.deps = deps;
  }

  summarize(input: SalesSummaryInput): Promise<SalesSummary> {
    return Promise.resolve(this.measure(input));
  }

  private measure(input: SalesSummaryInput): SalesSummary {
    const orders = this.deps.ordersOf(input.tenantId);
    const inRange = orders.filter((order) => {
      const day = localDay(placedAt(order), input.timezone);
      return day >= input.from && day < input.to && !isCancelled(order);
    });
    const counted = inRange.filter((order) => order.currency === input.currency);

    const days = new Map<string, { salesMinor: number; orders: number }>();
    for (const order of counted) {
      const date = localDay(placedAt(order), input.timezone);
      const day = days.get(date) ?? { salesMinor: 0, orders: 0 };
      day.orders += 1;
      day.salesMinor += isRefunded(order) ? 0 : order.totalAmount().amountMinor;
      days.set(date, day);
    }
    const measuredDays: MeasuredDay[] = [...days].map(([date, day]) => ({ date, ...day }));

    const products = new Map<string, TopProduct>();
    for (const order of counted.filter((candidate) => !isRefunded(candidate))) {
      for (const item of order.items) {
        const variantRef = item.snapshot.variantRef ?? null;
        const key = `${item.snapshot.productId}\u0000${variantRef ?? ""}`;
        const existing = products.get(key);
        products.set(key, {
          productRef: item.snapshot.productId,
          variantRef,
          name: item.snapshot.name,
          variantTitle: item.snapshot.variantTitle ?? null,
          quantity: (existing?.quantity ?? 0) + item.quantity,
          salesMinor: (existing?.salesMinor ?? 0) + item.lineTotal.amountMinor,
        });
      }
    }

    return assembleSalesSummary({
      from: input.from,
      to: input.to,
      measuredDays,
      topProducts: [...products.values()],
      otherCurrencyOrders: inRange.length - counted.length,
      openOrderIds:
        input.includeOpenOrderIds === true
          ? orders
              .filter((order) => !isCancelled(order) && !isClosed(order))
              .map((order) => order.id.toString())
          : [],
    });
  }
}
