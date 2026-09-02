import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type PricingRuleType = "percentage" | "fixed_amount";

export interface PricingRuleCreatedData {
  readonly type: PricingRuleType;
  readonly value: number;
  readonly priority: number;
}

/** Raised when a new price-list adjustment rule is created. */
export class PricingRuleCreated extends DomainEvent {
  readonly eventName = "pricing_rule.created";
  readonly data: PricingRuleCreatedData;

  constructor(props: DomainEventProps, data: PricingRuleCreatedData) {
    super(props);
    this.data = data;
  }
}
