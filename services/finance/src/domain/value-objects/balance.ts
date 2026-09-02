import { BusinessRuleError, ValueObject } from "@platform/domain";

interface BalanceProps {
  readonly amountMinor: number;
  readonly currency: string;
}

/**
 * Signed money — the counterpart to the shared-kernel {@link Money} (which is non-negative,
 * D-030). Every computed figure in Finance that can legitimately be negative (account balances,
 * profit, budget variance, cash-flow net) is a `Balance`, never a `Money`.
 */
export class Balance extends ValueObject<BalanceProps> {
  static zero(currency: string): Balance {
    return new Balance({ amountMinor: 0, currency });
  }

  static of(amountMinor: number, currency: string): Balance {
    if (!Number.isInteger(amountMinor)) {
      throw new BusinessRuleError("Balance amountMinor must be an integer (minor units)");
    }
    return new Balance({ amountMinor, currency });
  }

  get amountMinor(): number {
    return this.props.amountMinor;
  }

  get currency(): string {
    return this.props.currency;
  }

  get isNegative(): boolean {
    return this.props.amountMinor < 0;
  }

  get isZero(): boolean {
    return this.props.amountMinor === 0;
  }

  plus(other: Balance): Balance {
    this.assertSameCurrency(other);
    return new Balance({
      amountMinor: this.props.amountMinor + other.amountMinor,
      currency: this.props.currency,
    });
  }

  minus(other: Balance): Balance {
    this.assertSameCurrency(other);
    return new Balance({
      amountMinor: this.props.amountMinor - other.amountMinor,
      currency: this.props.currency,
    });
  }

  negate(): Balance {
    return new Balance({ amountMinor: -this.props.amountMinor, currency: this.props.currency });
  }

  private assertSameCurrency(other: Balance): void {
    if (other.currency !== this.props.currency) {
      throw new BusinessRuleError("Cannot operate on balances of different currencies");
    }
  }
}
