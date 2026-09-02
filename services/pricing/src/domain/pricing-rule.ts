import {
  AggregateRoot,
  BusinessRuleError,
  ValidationError,
  type UniqueEntityId,
} from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { PricingRuleCreated, type PricingRuleType } from "./events/pricing-rule-created.event";

export type { PricingRuleType } from "./events/pricing-rule-created.event";

interface PricingRuleProps {
  readonly type: PricingRuleType;
  readonly value: number;
  readonly priority: number;
  active: boolean;
}

/** A list-price adjustment rule (percentage/fixed_amount, priority-ordered). Determination only — never applies at checkout (Pricing ≠ Checkout/Promotions). */
export class PricingRule extends AggregateRoot<PricingRuleProps> {
  static create(
    id: UniqueEntityId,
    type: PricingRuleType,
    value: number,
    priority: number,
    eventId: string,
    occurredAt: Date,
  ): Result<PricingRule, ValidationError> {
    if (type === "percentage" && (value < 0 || value > 100)) {
      return err(
        new ValidationError("Invalid pricing rule", [
          { field: "value", message: "a percentage rule must be between 0 and 100" },
        ]),
      );
    }
    if (type === "fixed_amount" && value < 0) {
      return err(
        new ValidationError("Invalid pricing rule", [
          { field: "value", message: "a fixed_amount rule must be non-negative" },
        ]),
      );
    }
    const rule = new PricingRule({ type, value, priority, active: true }, id);
    rule.addDomainEvent(
      new PricingRuleCreated(
        { eventId, aggregateId: rule.id, occurredAt },
        { type, value, priority },
      ),
    );
    return ok(rule);
  }

  static reconstitute(
    id: UniqueEntityId,
    type: PricingRuleType,
    value: number,
    priority: number,
    active: boolean,
    version: number,
  ): PricingRule {
    return new PricingRule({ type, value, priority, active }, id, version);
  }

  /** No dedicated integration event — no report names one; `delete` is superseded by this (matrix's own note). */
  deactivate(): void {
    if (!this.props.active) {
      throw new BusinessRuleError("Pricing rule is already inactive");
    }
    this.props.active = false;
  }

  get type(): PricingRuleType {
    return this.props.type;
  }

  get value(): number {
    return this.props.value;
  }

  get priority(): number {
    return this.props.priority;
  }

  get active(): boolean {
    return this.props.active;
  }
}
