import type { CustomerContact } from "@platform/identity";
import {
  derivePaymentStatus,
  type Order,
  type OrderAnnotations,
  type OrderFulfillmentStatus,
  type OrderPaymentStatus,
} from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";
import { UnexpectedError } from "@platform/utils";
import { codCollectionState } from "./cod-collection";
import { customerNameOf } from "./order-customer-names";

export interface OrderExportLineDto {
  readonly title: string;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly quantity: number;
}

/** One row per order — what a courier upload needs (spec §1.4, decision 12). */
export interface OrderExportRowDto {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly createdAt: string;
  readonly customerName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  /** ISO 3166-2; admin-web prints the `packages/regions` name. */
  readonly province: string | null;
  readonly country: string;
  readonly items: readonly OrderExportLineDto[];
  readonly itemCount: number;
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  /** The total while a cash-on-delivery payment is pending, else 0 — what the courier collects. */
  readonly codAmountMinor: number;
  readonly currency: string;
  readonly paymentStatus: OrderPaymentStatus;
  readonly paymentProvider: string | null;
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  readonly shippingMethod: string | null;
  /** Order operations Part 2: the order's tags and staff note. */
  readonly tags: readonly string[];
  readonly note: string | null;
}

export interface PackingSlipDto {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly createdAt: string;
  readonly shipTo: {
    readonly name: string | null;
    readonly phone: string | null;
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly province: string | null;
    readonly postalCode: string;
    readonly country: string;
  };
  readonly lines: readonly OrderExportLineDto[];
  /** Order operations Part 2: the staff note, printed on the slip. */
  readonly note: string | null;
  readonly codAmountMinor: number;
  readonly currency: string;
}

export interface OrderExportFacts {
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  readonly contact: CustomerContact | undefined;
  readonly customerLabels: ReadonlyMap<string, string>;
  readonly intent: PaymentIntentSummary | undefined;
  /** Archive time, note and tags. */
  readonly annotations: OrderAnnotations | undefined;
}

export interface PackingSlipFacts {
  readonly customerLabels: ReadonlyMap<string, string>;
  readonly intent: PaymentIntentSummary | undefined;
  readonly annotations: OrderAnnotations | undefined;
}

/** What the courier collects: the order total while THIS order's cash-on-delivery payment is still owed (`codCollectionState`). */
export function codAmountOf(order: Order, intent: PaymentIntentSummary | undefined): number {
  return codCollectionState(order, intent).printAmount ? order.totalAmount().amountMinor : 0;
}

function placedAt(order: Order): string {
  const first = order.history[0];
  if (first === undefined) {
    throw new UnexpectedError(`Corrupt order data: order ${order.id.toString()} has no history`);
  }
  return first.occurredAt.toISOString();
}

function linesOf(order: Order): readonly OrderExportLineDto[] {
  return order.items.map((item) => ({
    title: item.snapshot.name,
    variantTitle: item.snapshot.variantTitle ?? null,
    sku: item.snapshot.sku ?? null,
    quantity: item.quantity,
  }));
}

export function toOrderExportRowDto(order: Order, facts: OrderExportFacts): OrderExportRowDto {
  const address = order.shippingAddress;
  const totals = order.totals;
  return {
    orderId: order.id.toString(),
    orderNumber: order.orderNumber.value,
    createdAt: placedAt(order),
    customerName: customerNameOf(order, facts.customerLabels),
    email: facts.contact?.email ?? null,
    phone: address.phone ?? null,
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city,
    province: address.province ?? null,
    country: address.country,
    items: linesOf(order),
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalMinor:
      totals?.subtotalMinor ??
      order.items.reduce((sum, item) => sum + item.lineTotal.amountMinor, 0),
    shippingMinor: totals?.shippingMinor ?? 0,
    discountMinor: totals?.discountMinor ?? 0,
    totalMinor: order.totalAmount().amountMinor,
    codAmountMinor: codAmountOf(order, facts.intent),
    currency: order.currency,
    paymentStatus: derivePaymentStatus(order.history),
    paymentProvider: facts.intent?.provider ?? null,
    fulfillmentStatus: facts.fulfillmentStatus,
    shippingMethod: totals?.shippingMethod ?? null,
    tags: facts.annotations?.tags ?? [],
    note: facts.annotations?.note ?? null,
  };
}

export function toPackingSlipDto(order: Order, facts: PackingSlipFacts): PackingSlipDto {
  const address = order.shippingAddress;
  return {
    orderId: order.id.toString(),
    orderNumber: order.orderNumber.value,
    createdAt: placedAt(order),
    shipTo: {
      name: customerNameOf(order, facts.customerLabels),
      phone: address.phone ?? null,
      line1: address.line1,
      line2: address.line2 ?? null,
      city: address.city,
      province: address.province ?? null,
      postalCode: address.postalCode,
      country: address.country,
    },
    lines: linesOf(order),
    note: facts.annotations?.note ?? null,
    codAmountMinor: codAmountOf(order, facts.intent),
    currency: order.currency,
  };
}
