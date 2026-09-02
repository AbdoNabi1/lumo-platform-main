import { type Money, ValueObject } from "@platform/domain";

export type CostComponentType = "unit_cost" | "freight" | "duty" | "handling" | "other";

interface CostComponentProps {
  readonly type: CostComponentType;
  readonly amount: Money;
}

/** One line of a landed-cost breakdown inside a {@link CogsSnapshot} (e.g. unit cost + freight). */
export class CostComponent extends ValueObject<CostComponentProps> {
  static create(type: CostComponentType, amount: Money): CostComponent {
    return new CostComponent({ type, amount });
  }

  get type(): CostComponentType {
    return this.props.type;
  }

  get amount(): Money {
    return this.props.amount;
  }
}
