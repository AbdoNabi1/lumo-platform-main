import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { PromotionStatusValue } from "../value-objects/promotion-status";

export interface PromotionTransitionedData {
  readonly name: string;
  readonly fromStatus: PromotionStatusValue;
  readonly toStatus: PromotionStatusValue;
}

/** Raised on every validated lifecycle transition (Sprint 5.1). The translator maps this to `promotions.promotion.<status>`. */
export class PromotionTransitioned extends DomainEvent {
  readonly eventName = "promotion.transitioned";
  readonly data: PromotionTransitionedData;

  constructor(props: DomainEventProps, data: PromotionTransitionedData) {
    super(props);
    this.data = data;
  }
}
