import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type RefundState = "requested" | "completed" | "failed";

export interface RefundTransitionedData {
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly state: RefundState;
}

/** Raised on every refund-lifecycle step. The translator maps this to `payments.refund.<state>`. */
export class RefundTransitioned extends DomainEvent {
  readonly eventName = "refund.transitioned";
  readonly data: RefundTransitionedData;

  constructor(props: DomainEventProps, data: RefundTransitionedData) {
    super(props);
    this.data = data;
  }
}
