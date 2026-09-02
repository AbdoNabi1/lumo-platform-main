import { Entity, type UniqueEntityId } from "@platform/domain";

export type OrderEventType =
  // Legacy path (Sprint 1.4, kept intact)
  | "placed"
  | "paid"
  | "refunded"
  // Full lifecycle (Sprint 4.7)
  | "created"
  | "confirmed"
  | "cancelled"
  | "held"
  | "resumed"
  | "awaiting_payment"
  | "payment_requested"
  | "payment_received"
  | "payment_failed"
  | "ready_for_fulfillment"
  | "fulfillment_requested"
  | "fulfilled"
  | "partially_fulfilled"
  | "delivered"
  | "return_requested"
  | "returned"
  | "refund_requested"
  | "closed";

/** The validated lifecycle transition table (Sprint 4.7). Legacy `placed`/`paid`/`refunded` kept alongside the full lifecycle. */
const TRANSITIONS: Readonly<Record<OrderEventType, readonly OrderEventType[]>> = {
  placed: ["paid", "cancelled"],
  paid: ["refunded"],
  refunded: [],
  created: ["confirmed", "cancelled"],
  confirmed: ["awaiting_payment", "held", "cancelled"],
  held: ["resumed", "cancelled"],
  resumed: ["awaiting_payment"],
  awaiting_payment: ["payment_requested", "cancelled"],
  payment_requested: ["payment_received", "payment_failed"],
  payment_failed: ["payment_requested", "cancelled"],
  payment_received: ["ready_for_fulfillment"],
  ready_for_fulfillment: ["fulfillment_requested"],
  fulfillment_requested: ["fulfilled", "partially_fulfilled"],
  partially_fulfilled: ["fulfilled"],
  fulfilled: ["delivered"],
  delivered: ["return_requested", "closed"],
  return_requested: ["returned"],
  returned: ["refund_requested", "closed"],
  refund_requested: ["closed"],
  cancelled: ["closed"],
  closed: [],
};

/** Whether a transition from `from` to `to` is allowed by the lifecycle's transition table. */
export function canTransition(from: OrderEventType, to: OrderEventType): boolean {
  return TRANSITIONS[from].includes(to);
}

interface OrderEventProps {
  readonly type: OrderEventType;
  readonly occurredAt: Date;
}

/**
 * An append-only entry in an order's history. The order's status is **derived** from the latest
 * entry — status is never mutated in place.
 */
export class OrderEvent extends Entity<OrderEventProps> {
  static create(id: UniqueEntityId, type: OrderEventType, occurredAt: Date): OrderEvent {
    return new OrderEvent({ type, occurredAt }, id);
  }

  get type(): OrderEventType {
    return this.props.type;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
