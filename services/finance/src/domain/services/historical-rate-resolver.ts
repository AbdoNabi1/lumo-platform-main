import type { ExchangeRate } from "../exchange-rate";

/** Picks the {@link ExchangeRate} effective at a given date (the latest one not after `at`). */
export class HistoricalRateResolver {
  static resolve(
    rates: readonly ExchangeRate[],
    baseCurrency: string,
    quoteCurrency: string,
    at: Date,
  ): ExchangeRate | undefined {
    return rates
      .filter(
        (rate) =>
          rate.baseCurrency === baseCurrency &&
          rate.quoteCurrency === quoteCurrency &&
          rate.effectiveAt.getTime() <= at.getTime(),
      )
      .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())[0];
  }
}
