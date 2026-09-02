import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { FulfillmentStatusValue } from "../value-objects/fulfillment-status";

export interface FulfillmentTransitionedData {
  readonly orderRef: string;
  readonly fromStatus: FulfillmentStatusValue;
  readonly toStatus: FulfillmentStatusValue;
}

/** Raised on every validated lifecycle transition (Sprint 4.9). The translator maps this to `fulfillment.order.<status>`. */
export class FulfillmentTransitioned extends DomainEvent {
  readonly eventName = "fulfillment.transitioned";
  readonly data: FulfillmentTransitionedData;

  constructor(props: DomainEventProps, data: FulfillmentTransitionedData) {
    super(props);
    this.data = data;
  }
}
