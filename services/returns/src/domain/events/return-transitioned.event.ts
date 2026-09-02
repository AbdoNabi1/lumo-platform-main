import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { ReturnStatusValue } from "../value-objects/return-status";

export interface ReturnTransitionedData {
  readonly orderRef: string;
  /** The canonical 3-segment integration-event type this occurrence carries (e.g. `returns.package.rma_generated`) — the translator is a pure pass-through of this field, not a deriver of it (Sprint 4.11's event taxonomy spans `request`/`package`/`inspection`/`items`/`refund`/`replacement`/`repair` prefixes, not one uniform `<status>` mapping). */
  readonly type: string;
  readonly fromStatus: ReturnStatusValue;
  readonly toStatus: ReturnStatusValue;
}

/** Raised on every validated lifecycle transition. The translator maps this to the `type` it carries. */
export class ReturnTransitioned extends DomainEvent {
  readonly eventName = "return.transitioned";
  readonly data: ReturnTransitionedData;

  constructor(props: DomainEventProps, data: ReturnTransitionedData) {
    super(props);
    this.data = data;
  }
}
