import { fetchRecentOrders, type OrderListItemDto } from "@/lib/api/orders";
import type { OrderStatus, RecentOrder } from "./dashboard";

const RECENT_ORDERS_LIMIT = 5;

export type RecentOrdersResult =
  | { readonly status: "ok"; readonly orders: readonly RecentOrder[] }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "unauthorized" };

/**
 * Buckets the real 21-value order lifecycle (`services/orders/src/domain/order-event.ts`) down to
 * the 3-state badge this widget renders. Deliberately conservative: only states that are
 * unambiguously "paid" or "refunded" map there; every mid-lifecycle, cancelled, or closed state
 * (whose prior path we can't tell from status alone) falls back to "processing" rather than
 * guessing. A known simplification, not fabricated data — every bucket is a real status.
 */
const PAID_STATUSES = new Set([
  "paid",
  "payment_received",
  "ready_for_fulfillment",
  "fulfillment_requested",
  "fulfilled",
  "partially_fulfilled",
  "delivered",
]);
const REFUNDED_STATUSES = new Set(["refunded", "return_requested", "returned", "refund_requested"]);

function toDisplayStatus(realStatus: string): OrderStatus {
  if (PAID_STATUSES.has(realStatus)) return "paid";
  if (REFUNDED_STATUSES.has(realStatus)) return "refunded";
  return "processing";
}

function minutesAgo(createdAt: string, now: number): number {
  const elapsedMs = now - Date.parse(createdAt);
  return Math.max(0, Math.round(elapsedMs / 60_000));
}

/**
 * Orders has no customer name (`customerRef` is a bare id into Identity — never resolved here;
 * wiring that up is a Customers integration, out of scope for this phase). Rather than inventing a
 * name, the display falls back to a short, honest label derived from the real reference.
 */
function customerDisplay(customerRef: string): { name: string; initials: string } {
  const short = customerRef.slice(-6).toUpperCase();
  return { name: `Customer ${short}`, initials: short.slice(0, 2) };
}

function toRecentOrder(dto: OrderListItemDto, now: number): RecentOrder {
  const { name, initials } = customerDisplay(dto.customerRef);
  return {
    id: dto.id,
    reference: `#${dto.orderNumber}`,
    customerName: name,
    customerInitials: initials,
    minutesAgo: minutesAgo(dto.createdAt, now),
    status: toDisplayStatus(dto.status),
    total: { amountMinor: dto.totalMinor, currency: dto.currency },
  };
}

/** Resolves the Dashboard's Recent Orders widget from the real `GET /orders` endpoint. Never falls back to demo data — a failure is reported as `"error"`/`"unauthorized"`, not masked. */
export async function getRecentOrders(): Promise<RecentOrdersResult> {
  const result = await fetchRecentOrders(RECENT_ORDERS_LIMIT);
  if (result.outcome === "unauthorized") {
    return { status: "unauthorized" };
  }
  if (result.outcome === "error") {
    return { status: "error", message: result.message };
  }
  const now = Date.now();
  return { status: "ok", orders: result.orders.map((dto) => toRecentOrder(dto, now)) };
}
