import { ValueObject } from "@platform/domain";

export type PaymentStatusValue =
  // Legacy path (Sprint 1.4, kept intact)
  | "requires_payment"
  | "captured"
  | "failed"
  | "refunded"
  // Full lifecycle (Sprint 4.8)
  | "created"
  | "processing"
  | "authorized"
  | "capture_requested"
  | "cancelled"
  | "expired"
  | "partially_refunded"
  | "closed";

/** The validated lifecycle transition table (Sprint 4.8). Legacy `requires_payment`/`captured`/`failed`/`refunded` kept alongside the full lifecycle. */
const TRANSITIONS: Readonly<Record<PaymentStatusValue, readonly PaymentStatusValue[]>> = {
  requires_payment: ["captured", "failed"],
  captured: ["refunded", "partially_refunded", "closed"],
  failed: ["processing"],
  refunded: ["closed"],
  created: ["processing", "cancelled"],
  processing: ["authorized", "failed"],
  authorized: ["capture_requested", "cancelled", "expired"],
  capture_requested: ["captured", "failed"],
  cancelled: ["closed"],
  expired: ["closed"],
  partially_refunded: ["refunded", "closed"],
  closed: [],
};

/** Whether a transition from `from` to `to` is allowed by the payment lifecycle's transition table. */
export function canTransitionPayment(from: PaymentStatusValue, to: PaymentStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface PaymentStatusProps {
  readonly value: PaymentStatusValue;
}

/** The lifecycle state of a payment intent (a closed set of internal states; not external input). */
export class PaymentStatus extends ValueObject<PaymentStatusProps> {
  static requiresPayment(): PaymentStatus {
    return new PaymentStatus({ value: "requires_payment" });
  }

  static captured(): PaymentStatus {
    return new PaymentStatus({ value: "captured" });
  }

  static failed(): PaymentStatus {
    return new PaymentStatus({ value: "failed" });
  }

  static refunded(): PaymentStatus {
    return new PaymentStatus({ value: "refunded" });
  }

  static created(): PaymentStatus {
    return new PaymentStatus({ value: "created" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: PaymentStatusValue): PaymentStatus {
    return new PaymentStatus({ value });
  }

  get value(): PaymentStatusValue {
    return this.props.value;
  }

  get isRequiresPayment(): boolean {
    return this.props.value === "requires_payment";
  }

  get isCaptured(): boolean {
    return this.props.value === "captured";
  }
}
