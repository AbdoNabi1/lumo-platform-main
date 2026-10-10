import { Money, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { Order } from "../domain/order";
import { OrderEvent, type OrderEventType } from "../domain/order-event";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { OrderTotalsSnapshot } from "../domain/value-objects/order-totals-snapshot";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";

/** Row shapes (structural — matches the Prisma payloads without importing Prisma types). */
export interface OrderRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerRef: string;
  readonly currency: string;
  readonly checkoutRef: string | null;
  readonly paymentRef: string | null;
  readonly fulfillmentRef: string | null;
  readonly billingAddress: OrderAddressRow | null;
  readonly totals: OrderTotalsJson | null;
  readonly version: number;
}
export interface OrderItemRow {
  readonly id: string;
  readonly productRef: string;
  readonly name: string;
  readonly unitPriceAmountMinor: number;
  readonly quantity: number;
  /** Plan 2A: nullable columns; null/absent on orders placed before variants were tracked. */
  readonly variantRef?: string | null;
  readonly sku?: string | null;
  readonly variantTitle?: string | null;
}
export interface OrderEventRow {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
}
export interface OrderAddressRow {
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
  /** Plan 3A: nullable; null/absent on orders placed before the recipient was captured. */
  readonly recipientName?: string | null;
  readonly phone?: string | null;
  readonly line2?: string | null;
}

function toExtra(address: OrderAddressRow) {
  return {
    recipientName: address.recipientName ?? undefined,
    phone: address.phone ?? undefined,
    line2: address.line2 ?? undefined,
  };
}
export interface OrderTotalsJson {
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
  /** Plan 3B: a JSON key, so no migration; absent (or null) on orders placed before it was captured. */
  readonly shippingMethod?: string | null;
}

/** Unwraps a VO `Result`; a failure here means the row violates a domain invariant (corrupt data). */
function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt orders row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

/**
 * Persistence ↔ aggregate mapping for {@link Order}. Mapping only — no I/O, no transactions
 * (repository owns load/save). Status is never mapped: it derives from the history rows.
 */
export class OrderMapper {
  static toDomain(
    row: OrderRow,
    items: readonly OrderItemRow[],
    events: readonly OrderEventRow[],
    address: OrderAddressRow,
  ): Order {
    const orderItems = items.map((item) =>
      OrderItem.create(
        UniqueEntityId.from(item.id),
        must(
          ProductSnapshot.create(
            item.productRef,
            item.name,
            must(Money.create(item.unitPriceAmountMinor, row.currency), "item unit price"),
            item.variantRef === undefined || item.variantRef === null
              ? undefined
              : {
                  variantRef: item.variantRef,
                  sku: item.sku ?? "",
                  variantTitle: item.variantTitle ?? null,
                },
          ),
          "product snapshot",
        ),
        item.quantity,
      ),
    );
    const history = events.map((event) =>
      OrderEvent.create(
        UniqueEntityId.from(event.id),
        event.type as OrderEventType,
        event.occurredAt,
      ),
    );
    return Order.reconstitute(
      UniqueEntityId.from(row.id),
      must(OrderNumber.create(row.orderNumber), "order number"),
      row.customerRef,
      row.currency,
      orderItems,
      must(
        AddressSnapshot.create(
          address.line1,
          address.city,
          address.postalCode,
          address.country,
          toExtra(address),
        ),
        "shipping address",
      ),
      history,
      row.version,
      {
        billingAddress:
          row.billingAddress === null
            ? undefined
            : must(
                AddressSnapshot.create(
                  row.billingAddress.line1,
                  row.billingAddress.city,
                  row.billingAddress.postalCode,
                  row.billingAddress.country,
                  toExtra(row.billingAddress),
                ),
                "billing address",
              ),
        totals:
          row.totals === null
            ? undefined
            : OrderTotalsSnapshot.create({
                ...row.totals,
                shippingMethod: row.totals.shippingMethod ?? undefined,
              }),
        checkoutRef: row.checkoutRef ?? undefined,
        paymentRef: row.paymentRef ?? undefined,
        fulfillmentRef: row.fulfillmentRef ?? undefined,
      },
    );
  }

  static toOrderRow(order: Order, tenantId: string) {
    return {
      id: order.id.toString(),
      tenantId,
      orderNumber: order.orderNumber.value,
      customerRef: order.customerRef,
      currency: order.currency,
      checkoutRef: order.checkoutRef ?? null,
      paymentRef: order.paymentRef ?? null,
      fulfillmentRef: order.fulfillmentRef ?? null,
      billingAddress:
        order.billingAddress === undefined
          ? null
          : {
              line1: order.billingAddress.line1,
              city: order.billingAddress.city,
              postalCode: order.billingAddress.postalCode,
              country: order.billingAddress.country,
              recipientName: order.billingAddress.recipientName ?? null,
              phone: order.billingAddress.phone ?? null,
              line2: order.billingAddress.line2 ?? null,
            },
      totals:
        order.totals === undefined
          ? null
          : {
              subtotalMinor: order.totals.subtotalMinor,
              taxMinor: order.totals.taxMinor,
              shippingMinor: order.totals.shippingMinor,
              discountMinor: order.totals.discountMinor,
              totalMinor: order.totals.totalMinor,
              currency: order.totals.currency,
              ...(order.totals.shippingMethod === undefined
                ? {}
                : { shippingMethod: order.totals.shippingMethod }),
            },
      version: 1, // first persisted version; reconstitution reads it back
    };
  }

  static toItemRows(order: Order, tenantId: string) {
    return order.items.map((item) => ({
      id: item.id.toString(),
      tenantId,
      orderId: order.id.toString(),
      productRef: item.snapshot.productId,
      name: item.snapshot.name,
      unitPriceAmountMinor: item.snapshot.unitPrice.amountMinor,
      quantity: item.quantity,
      variantRef: item.snapshot.variantRef ?? null,
      sku: item.snapshot.sku ?? null,
      variantTitle: item.snapshot.variantTitle ?? null,
    }));
  }

  /** All history rows; insertion uses `skipDuplicates`, so already-persisted entries are no-ops. */
  static toEventRows(order: Order, tenantId: string) {
    return order.history.map((event) => ({
      id: event.id.toString(),
      tenantId,
      orderId: order.id.toString(),
      type: event.type,
      occurredAt: event.occurredAt,
    }));
  }

  static toAddressRow(order: Order, tenantId: string) {
    return {
      orderId: order.id.toString(),
      tenantId,
      line1: order.shippingAddress.line1,
      city: order.shippingAddress.city,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country,
      recipientName: order.shippingAddress.recipientName ?? null,
      phone: order.shippingAddress.phone ?? null,
      line2: order.shippingAddress.line2 ?? null,
    };
  }
}
