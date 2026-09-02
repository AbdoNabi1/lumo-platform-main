import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";

interface ExchangeRateProps {
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rate: number;
  readonly effectiveAt: Date;
}

/**
 * An immutable, historical exchange rate (base → quote) effective at a point in time. Never
 * updated — a new rate is a new record, so historical reports always convert at the rate that
 * was actually in effect (ADR-0024 immutability).
 */
export class ExchangeRate extends AggregateRoot<ExchangeRateProps> {
  static record(
    id: UniqueEntityId,
    baseCurrency: string,
    quoteCurrency: string,
    rate: number,
    effectiveAt: Date,
  ): ExchangeRate {
    if (rate <= 0) {
      throw new BusinessRuleError("Exchange rate must be positive");
    }
    return new ExchangeRate({ baseCurrency, quoteCurrency, rate, effectiveAt }, id);
  }

  static reconstitute(
    id: UniqueEntityId,
    baseCurrency: string,
    quoteCurrency: string,
    rate: number,
    effectiveAt: Date,
    version: number,
  ): ExchangeRate {
    return new ExchangeRate({ baseCurrency, quoteCurrency, rate, effectiveAt }, id, version);
  }

  convert(amountMinor: number): number {
    return Math.round(amountMinor * this.props.rate);
  }

  get baseCurrency(): string {
    return this.props.baseCurrency;
  }

  get quoteCurrency(): string {
    return this.props.quoteCurrency;
  }

  get rate(): number {
    return this.props.rate;
  }

  get effectiveAt(): Date {
    return this.props.effectiveAt;
  }
}
