import { ValueObject } from "@platform/domain";

export type ReturnStatusValue =
  | "requested"
  | "approved"
  | "rejected"
  | "rma_generated"
  | "package_received"
  | "inspection_completed"
  | "items_accepted"
  | "items_rejected"
  | "refund_requested"
  | "replacement_requested"
  | "repair_requested"
  | "closed";

/** The validated lifecycle transition table (Sprint 4.11). */
const TRANSITIONS: Readonly<Record<ReturnStatusValue, readonly ReturnStatusValue[]>> = {
  requested: ["approved", "rejected"],
  approved: ["rma_generated"],
  rejected: ["closed"],
  rma_generated: ["package_received"],
  package_received: ["inspection_completed"],
  inspection_completed: ["items_accepted", "items_rejected"],
  items_accepted: ["refund_requested", "replacement_requested", "repair_requested"],
  items_rejected: ["closed"],
  refund_requested: ["closed"],
  replacement_requested: ["closed"],
  repair_requested: ["closed"],
  closed: [],
};

/** Whether a transition from `from` to `to` is allowed by the return lifecycle's transition table. */
export function canTransitionReturn(from: ReturnStatusValue, to: ReturnStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface ReturnStatusProps {
  readonly value: ReturnStatusValue;
}

/** The lifecycle state of a return request (a closed set of internal states; not external input). */
export class ReturnStatus extends ValueObject<ReturnStatusProps> {
  static requested(): ReturnStatus {
    return new ReturnStatus({ value: "requested" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: ReturnStatusValue): ReturnStatus {
    return new ReturnStatus({ value });
  }

  get value(): ReturnStatusValue {
    return this.props.value;
  }
}
