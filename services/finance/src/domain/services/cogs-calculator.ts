import { BusinessRuleError, Money } from "@platform/domain";
import type { CogsSnapshot } from "../cogs-snapshot";

/** Computes cost of goods sold for a quantity from a {@link CogsSnapshot}'s landed-cost breakdown. */
export class CogsCalculator {
  static cost(snapshot: CogsSnapshot, quantity: number, currency: string): Money {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new BusinessRuleError("Quantity must be a non-negative integer");
    }
    const perUnitMinor = snapshot.totalMinor;
    const result = Money.create(perUnitMinor * quantity, currency);
    if (!result.ok) {
      throw new BusinessRuleError(result.error.message);
    }
    return result.value;
  }
}
