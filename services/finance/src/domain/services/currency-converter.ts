import { BusinessRuleError, Money } from "@platform/domain";
import type { ExchangeRate } from "../exchange-rate";

/** Converts an amount using a supplied historical {@link ExchangeRate} — never looks one up itself. */
export class CurrencyConverter {
  static convert(amount: Money, rate: ExchangeRate): Money {
    if (amount.currency !== rate.baseCurrency) {
      throw new BusinessRuleError(
        `Rate base currency ${rate.baseCurrency} does not match amount currency ${amount.currency}`,
      );
    }
    const converted = Money.create(rate.convert(amount.amountMinor), rate.quoteCurrency);
    if (!converted.ok) {
      throw new BusinessRuleError(converted.error.message);
    }
    return converted.value;
  }
}
