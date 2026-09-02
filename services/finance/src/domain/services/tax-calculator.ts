import { BusinessRuleError, Money } from "@platform/domain";
import type { TaxProfile } from "../tax-profile";

/** Applies a jurisdiction's {@link TaxProfile} rates to a taxable amount. */
export class TaxCalculator {
  static calculate(profile: TaxProfile, taxableAmount: Money): Money {
    const taxMinor = profile.rates.reduce(
      (sum, rate) => sum + rate.apply(taxableAmount.amountMinor),
      0,
    );
    const result = Money.create(taxMinor, taxableAmount.currency);
    if (!result.ok) {
      throw new BusinessRuleError(result.error.message);
    }
    return result.value;
  }
}
