import {
  AggregateRoot,
  BusinessRuleError,
  isValidCurrencyCode,
  Money,
  UniqueEntityId,
} from "@platform/domain";
import { OrderPaid } from "./events/order-paid.event";
import { OrderPlaced } from "./events/order-placed.event";
import { OrderRefunded } from "./events/order-refunded.event";
import { OrderTransitioned } from "./events/order-transitioned.event";
import { canTransition, OrderEvent, type OrderEventType } from "./order-event";
import type { OrderItem } from "./order-item";
import type { RefundPolicy } from "./refund-policy";
import type { AddressSnapshot } from "./value-objects/address-snapshot";
import type { OrderNumber } from "./value-objects/order-number";
import type { OrderTotalsSnapshot } from "./value-objects/order-totals-snapshot";

export type OrderStatus = OrderEventType;

interface OrderProps {
  readonly orderNumber: OrderNumber;
  readonly customerRef: string;
  readonly currency: string;
  readonly items: readonly OrderItem[];
  readonly shippingAddress: AddressSnapshot;
  readonly history: OrderEvent[];
  billingAddress?: AddressSnapshot;
  totals?: OrderTotalsSnapshot;
  checkoutRef?: string;
  paymentRef?: string;
  fulfillmentRef?: string;
}

/**
 * A placed order. Status is **derived** from an append-only history (`placed` → `paid` →
 * `refunded`, or the full Sprint 4.7 lifecycle: `created` → ... → `closed`); each transition
 * appends an `OrderEvent` and raises the matching integration event. Line products are immutable
 * snapshots — no live Catalog/Pricing reference. Orders never captures payment or moves stock
 * itself — `paymentRef`/`fulfillmentRef` are bare references set alongside the corresponding
 * transition, requested via the outbound ports (`application/ports.ts`).
 */
export class Order extends AggregateRoot<OrderProps> {
  static place(
    id: UniqueEntityId,
    orderNumber: OrderNumber,
    customerRef: string,
    currency: string,
    items: readonly OrderItem[],
    shippingAddress: AddressSnapshot,
    eventId: string,
    occurredAt: Date,
  ): Order {
    if (items.length === 0) {
      throw new BusinessRuleError("An order needs at least one item");
    }
    if (!isValidCurrencyCode(currency)) {
      throw new BusinessRuleError(`Invalid order currency "${currency}"`);
    }
    const order = new Order(
      { orderNumber, customerRef, currency, items, shippingAddress, history: [] },
      id,
    );
    order.record("placed", eventId, occurredAt);
    order.addDomainEvent(
      new OrderPlaced(
        { eventId, aggregateId: order.id, occurredAt },
        {
          orderNumber: orderNumber.value,
          customerRef,
          currency,
          totalAmountMinor: order.totalAmount().amountMinor,
          lineCount: items.length,
        },
      ),
    );
    return order;
  }

  /**
   * Creates an order from a Checkout order-draft snapshot (Sprint 4.7) — starts at `created`, the
   * full-lifecycle path's entry point (distinct from the legacy `place()`'s `placed`).
   */
  static createFromCheckout(
    id: UniqueEntityId,
    orderNumber: OrderNumber,
    customerRef: string,
    currency: string,
    items: readonly OrderItem[],
    shippingAddress: AddressSnapshot,
    billingAddress: AddressSnapshot,
    totals: OrderTotalsSnapshot,
    checkoutRef: string,
    eventId: string,
    occurredAt: Date,
  ): Order {
    if (items.length === 0) {
      throw new BusinessRuleError("An order needs at least one item");
    }
    if (!isValidCurrencyCode(currency)) {
      throw new BusinessRuleError(`Invalid order currency "${currency}"`);
    }
    const order = new Order(
      {
        orderNumber,
        customerRef,
        currency,
        items,
        shippingAddress,
        history: [],
        billingAddress,
        totals,
        checkoutRef,
      },
      id,
    );
    order.record("created", eventId, occurredAt);
    order.addDomainEvent(
      new OrderTransitioned(
        { eventId, aggregateId: order.id, occurredAt },
        { orderNumber: orderNumber.value, customerRef, fromStatus: "created", toStatus: "created" },
      ),
    );
    return order;
  }

  /**
   * Rebuilds a persisted order exactly as stored — raises NO domain events (rehydration is not a
   * state change) and carries the persisted `version` for optimistic locking (ADR-0003, G-12).
   * `history` must be the full append-only event log in occurrence order (status derives from it).
   */
  static reconstitute(
    id: UniqueEntityId,
    orderNumber: OrderNumber,
    customerRef: string,
    currency: string,
    items: readonly OrderItem[],
    shippingAddress: AddressSnapshot,
    history: readonly OrderEvent[],
    version: number,
    extra: {
      readonly billingAddress?: AddressSnapshot;
      readonly totals?: OrderTotalsSnapshot;
      readonly checkoutRef?: string;
      readonly paymentRef?: string;
      readonly fulfillmentRef?: string;
    } = {},
  ): Order {
    if (history.length === 0) {
      throw new BusinessRuleError("A persisted order must have at least one history entry");
    }
    return new Order(
      {
        orderNumber,
        customerRef,
        currency,
        items,
        shippingAddress,
        history: [...history],
        billingAddress: extra.billingAddress,
        totals: extra.totals,
        checkoutRef: extra.checkoutRef,
        paymentRef: extra.paymentRef,
        fulfillmentRef: extra.fulfillmentRef,
      },
      id,
      version,
    );
  }

  markPaid(paymentRef: string, eventId: string, occurredAt: Date): void {
    if (this.status !== "placed") {
      throw new BusinessRuleError(`Order cannot be paid from status "${this.status}"`);
    }
    this.record("paid", eventId, occurredAt);
    this.addDomainEvent(
      new OrderPaid(
        { eventId, aggregateId: this.id, occurredAt },
        {
          orderNumber: this.props.orderNumber.value,
          customerRef: this.props.customerRef,
          paymentRef,
          currency: this.props.currency,
          totalAmountMinor: this.totalAmount().amountMinor,
        },
      ),
    );
  }

  /**
   * The ONE authoritative "payment completed" path (Sprint A1 — Payment Truth Foundation), used by
   * both the admin backoffice mark-paid action and `PaymentCapturedConsumer`. Delegates to
   * `markPaid` for the legacy lifecycle (`placed` → `paid`, emits `order.paid`); for the checkout/
   * saga lifecycle, drives the generic `transition` to `payment_received` (emits
   * `order.transitioned`) and records `paymentRef` the same way `requestPayment` already does for
   * `payment_requested`. Any other status (already paid/payment_received, or too early in the
   * lifecycle) throws the same `Order cannot be paid from status "…"` shape `markPaid` already uses
   * — one error contract for callers to key idempotency off of across both lifecycles.
   */
  completePayment(paymentRef: string, eventId: string, occurredAt: Date): void {
    if (this.status === "placed") {
      this.markPaid(paymentRef, eventId, occurredAt);
      return;
    }
    if (canTransition(this.status, "payment_received")) {
      this.transition("payment_received", eventId, occurredAt);
      this.props.paymentRef = paymentRef;
      return;
    }
    throw new BusinessRuleError(`Order cannot be paid from status "${this.status}"`);
  }

  refund(policy: RefundPolicy, eventId: string, occurredAt: Date): void {
    if (!policy.canRefund(this.status)) {
      throw new BusinessRuleError(`Order is not refundable from status "${this.status}"`);
    }
    this.record("refunded", eventId, occurredAt);
    this.addDomainEvent(
      new OrderRefunded(
        { eventId, aggregateId: this.id, occurredAt },
        {
          orderNumber: this.props.orderNumber.value,
          customerRef: this.props.customerRef,
          currency: this.props.currency,
          totalAmountMinor: this.totalAmount().amountMinor,
        },
      ),
    );
  }

  /** The generic, validated Sprint 4.7 transition — every named method below delegates to this. */
  transition(toStatus: OrderEventType, eventId: string, occurredAt: Date): void {
    const fromStatus = this.status;
    if (!canTransition(fromStatus, toStatus)) {
      throw new BusinessRuleError(`Cannot transition order from "${fromStatus}" to "${toStatus}"`);
    }
    this.record(toStatus, eventId, occurredAt);
    this.addDomainEvent(
      new OrderTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          orderNumber: this.props.orderNumber.value,
          customerRef: this.props.customerRef,
          fromStatus,
          toStatus,
        },
      ),
    );
  }

  confirm(eventId: string, occurredAt: Date): void {
    this.transition("confirmed", eventId, occurredAt);
  }

  cancel(eventId: string, occurredAt: Date): void {
    this.transition("cancelled", eventId, occurredAt);
  }

  hold(eventId: string, occurredAt: Date): void {
    this.transition("held", eventId, occurredAt);
  }

  resume(eventId: string, occurredAt: Date): void {
    this.transition("resumed", eventId, occurredAt);
  }

  markAwaitingPayment(eventId: string, occurredAt: Date): void {
    this.transition("awaiting_payment", eventId, occurredAt);
  }

  /** Records the outbound payment request ref (from `PaymentPort`) alongside the transition. */
  requestPayment(paymentRef: string, eventId: string, occurredAt: Date): void {
    this.transition("payment_requested", eventId, occurredAt);
    this.props.paymentRef = paymentRef;
  }

  markPaymentReceived(eventId: string, occurredAt: Date): void {
    this.transition("payment_received", eventId, occurredAt);
  }

  markPaymentFailed(eventId: string, occurredAt: Date): void {
    this.transition("payment_failed", eventId, occurredAt);
  }

  markReadyForFulfillment(eventId: string, occurredAt: Date): void {
    this.transition("ready_for_fulfillment", eventId, occurredAt);
  }

  /** Records the outbound fulfillment request ref (from `InventoryPort`/`ShippingPort`) alongside the transition. */
  requestFulfillment(fulfillmentRef: string, eventId: string, occurredAt: Date): void {
    this.transition("fulfillment_requested", eventId, occurredAt);
    this.props.fulfillmentRef = fulfillmentRef;
  }

  markFulfilled(eventId: string, occurredAt: Date): void {
    this.transition("fulfilled", eventId, occurredAt);
  }

  markPartiallyFulfilled(eventId: string, occurredAt: Date): void {
    this.transition("partially_fulfilled", eventId, occurredAt);
  }

  markDelivered(eventId: string, occurredAt: Date): void {
    this.transition("delivered", eventId, occurredAt);
  }

  requestReturn(eventId: string, occurredAt: Date): void {
    this.transition("return_requested", eventId, occurredAt);
  }

  markReturned(eventId: string, occurredAt: Date): void {
    this.transition("returned", eventId, occurredAt);
  }

  requestRefund(eventId: string, occurredAt: Date): void {
    this.transition("refund_requested", eventId, occurredAt);
  }

  close(eventId: string, occurredAt: Date): void {
    this.transition("closed", eventId, occurredAt);
  }

  totalAmount(): Money {
    if (this.props.totals !== undefined) {
      return must(Money.create(this.props.totals.totalMinor, this.props.totals.currency));
    }
    return this.props.items.reduce(
      (acc, item) => acc.plus(item.lineTotal),
      Money.zero(this.props.currency),
    );
  }

  get status(): OrderStatus {
    const latest = this.props.history[this.props.history.length - 1];
    if (latest === undefined) {
      throw new BusinessRuleError("Order has no history");
    }
    return latest.type;
  }

  get orderNumber(): OrderNumber {
    return this.props.orderNumber;
  }

  get customerRef(): string {
    return this.props.customerRef;
  }

  get currency(): string {
    return this.props.currency;
  }

  get items(): readonly OrderItem[] {
    return this.props.items;
  }

  get shippingAddress(): AddressSnapshot {
    return this.props.shippingAddress;
  }

  get billingAddress(): AddressSnapshot | undefined {
    return this.props.billingAddress;
  }

  get totals(): OrderTotalsSnapshot | undefined {
    return this.props.totals;
  }

  get checkoutRef(): string | undefined {
    return this.props.checkoutRef;
  }

  get paymentRef(): string | undefined {
    return this.props.paymentRef;
  }

  get fulfillmentRef(): string | undefined {
    return this.props.fulfillmentRef;
  }

  /** The full append-only lifecycle history (persisted verbatim; status derives from its tail). */
  get history(): readonly OrderEvent[] {
    return this.props.history;
  }

  private record(type: OrderEventType, eventId: string, occurredAt: Date): void {
    this.props.history.push(OrderEvent.create(UniqueEntityId.from(eventId), type, occurredAt));
  }
}

function must(result: { ok: boolean; value?: Money }): Money {
  if (!result.ok || result.value === undefined) {
    throw new BusinessRuleError("Corrupt order totals snapshot");
  }
  return result.value;
}
