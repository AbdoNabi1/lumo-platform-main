/**
 * The order as tracking sees it (Tracking P2 Task 4): one tenant-scoped read that returns the plain
 * `OrderTrackingReadModel` the business-event mappers consume.
 *
 * The order events on the bus are thin (an id and a status, never a line item, an email or an address), so the
 * business consumers read the rest here. Everything comes out of ONE short transaction with `app.tenant_id` set first
 * (`runReadScoped`), and every statement also names the tenant in its `where`, so the application filter and the
 * row-level policies agree and an order of another tenant is simply absent:
 *
 * - `orders.orders` + `orders.order_items` (lines, `totals` JSON, currency, `checkout_ref`, created-at),
 * - `orders.order_shipping_addresses` (recipient, phone, city, province, country),
 * - `identity.customers` by the order's `customer_ref` (email, phone, name; an erased customer contributes nothing),
 * - `tracking.attribution_snapshots` by `('checkout', checkout_ref)` (the visitor's ids, click ids, IP, UA).
 *
 * Reads the tables directly rather than importing `services/orders` internals (the same decoupling the payment
 * verification adapter uses). Never writes. Never logs a customer field.
 */

import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type {
  OrderTrackingCustomer,
  OrderTrackingLine,
  OrderTrackingReadModel,
  OrderTrackingShipping,
  OrderTrackingTotals,
} from "@platform/tracking";

import { toSnapshot } from "./prisma-attribution-snapshot-store";

/** What the business consumers need of the order store; `null` = the order is not (yet) visible to this tenant. */
export interface OrderTrackingReader {
  read(tenantId: string, orderId: string): Promise<OrderTrackingReadModel | null>;
}

/** `orders.orders.id`, `order_items.order_id` and `identity.customers.id` are `uuid`: anything else cannot exist. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function text(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function whole(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

interface TotalsJson {
  readonly subtotalMinor?: unknown;
  readonly discountMinor?: unknown;
  readonly taxMinor?: unknown;
  readonly shippingMinor?: unknown;
  readonly totalMinor?: unknown;
  readonly taxIncluded?: unknown;
  readonly discounts?: unknown;
}

/**
 * `orders.orders.totals` is `null` on the oldest rows. The lines are then the only truth: the subtotal is their sum
 * and nothing else is known (no discount, no tax, no shipping), which is the honest floor for a conversion value.
 */
function totalsOf(raw: unknown, lines: readonly OrderTrackingLine[]): OrderTrackingTotals {
  const linesTotal = lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  const json: TotalsJson =
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
  const totalMinor = whole(json.totalMinor);
  return {
    subtotalMinor: whole(json.subtotalMinor) ?? linesTotal,
    discountMinor: whole(json.discountMinor) ?? 0,
    taxMinor: whole(json.taxMinor) ?? 0,
    shippingMinor: whole(json.shippingMinor) ?? 0,
    ...(totalMinor === undefined ? {} : { totalMinor }),
    // Absent on older orders, where the tax was added on top.
    taxIncluded: json.taxIncluded === true,
  };
}

/** The first discount code the shopper used, when the order kept one. */
function couponOf(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { discounts } = raw as TotalsJson;
  if (!Array.isArray(discounts)) return undefined;
  for (const discount of discounts as unknown[]) {
    if (typeof discount !== "object" || discount === null) continue;
    const code = (discount as { code?: unknown }).code;
    if (typeof code === "string" && code.trim() !== "") return code.trim();
  }
  return undefined;
}

function shippingOf(
  row: {
    recipientName: string | null;
    phone: string | null;
    city: string;
    province: string | null;
    country: string;
  } | null,
): OrderTrackingShipping | undefined {
  if (row === null) return undefined;
  const shipping: OrderTrackingShipping = {
    ...(text(row.recipientName) === undefined ? {} : { recipientName: text(row.recipientName) }),
    ...(text(row.phone) === undefined ? {} : { phone: text(row.phone) }),
    ...(text(row.city) === undefined ? {} : { city: text(row.city) }),
    ...(text(row.province) === undefined ? {} : { province: text(row.province) }),
    ...(text(row.country) === undefined ? {} : { country: text(row.country) }),
  };
  return Object.keys(shipping).length === 0 ? undefined : shipping;
}

/**
 * The read itself, inside a transaction the caller already scoped to `tenantId`. Exported so the integration test can
 * run it under a role that row-level security really applies to.
 */
export async function readOrderTrackingModel(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<OrderTrackingReadModel | null> {
  if (!UUID.test(orderId)) return null;

  const order = await tx.order.findFirst({ where: { id: orderId, tenantId } });
  if (order === null) return null;

  const [items, address, customerRow, snapshotRow] = await Promise.all([
    tx.orderItem.findMany({
      where: { orderId: order.id, tenantId },
      orderBy: { id: "asc" },
    }),
    tx.orderShippingAddress.findFirst({ where: { orderId: order.id, tenantId } }),
    UUID.test(order.customerRef)
      ? tx.customer.findFirst({ where: { id: order.customerRef, tenantId } })
      : Promise.resolve(null),
    order.checkoutRef === null
      ? Promise.resolve(null)
      : tx.trackingAttributionSnapshot.findFirst({
          where: { tenantId, subjectKind: "checkout", subjectRef: order.checkoutRef },
        }),
  ]);

  const lines: OrderTrackingLine[] = items.map((item) => ({
    productRef: item.productRef,
    ...(text(item.variantRef) === undefined ? {} : { variantRef: text(item.variantRef) }),
    ...(text(item.sku) === undefined ? {} : { sku: text(item.sku) }),
    name: item.name,
    unitPriceMinor: item.unitPriceAmountMinor,
    quantity: item.quantity,
  }));

  // An erased customer is anonymised and soft-deleted: it contributes no email, phone or name.
  const customer: OrderTrackingCustomer = {
    customerRef: order.customerRef,
    ...(customerRow === null || customerRow.deletedAt !== null
      ? {}
      : {
          ...(text(customerRow.email) === undefined ? {} : { email: text(customerRow.email) }),
          ...(text(customerRow.phone) === undefined ? {} : { phone: text(customerRow.phone) }),
          ...(text(customerRow.name) === undefined ? {} : { name: text(customerRow.name) }),
        }),
  };

  const shipping = shippingOf(address);
  const coupon = couponOf(order.totals);

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    currency: order.currency,
    totals: totalsOf(order.totals, lines),
    lines,
    customer,
    ...(shipping === undefined ? {} : { shipping }),
    ...(order.checkoutRef === null ? {} : { checkoutRef: order.checkoutRef }),
    placedAt: order.createdAt.toISOString(),
    ...(coupon === undefined ? {} : { couponCode: coupon }),
    ...(snapshotRow === null ? {} : { snapshot: toSnapshot(snapshotRow) }),
  };
}

export class PrismaOrderTrackingReader implements OrderTrackingReader {
  constructor(private readonly db: Database) {}

  read(tenantId: string, orderId: string): Promise<OrderTrackingReadModel | null> {
    return runReadScoped(this.db, tenantId, (tx) => readOrderTrackingModel(tx, tenantId, orderId));
  }
}
