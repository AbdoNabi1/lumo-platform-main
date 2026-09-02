import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, ValidationError } from "../errors";
import { ValueObject } from "../value-object";

interface MoneyProps {
  readonly amountMinor: number;
  readonly currency: string;
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Whether `value` is a syntactically valid ISO-4217 currency code (3 upper-case letters).
 * Exported so aggregates that carry a currency (Cart, Order) can enforce it at creation
 * without duplicating the pattern.
 */
export function isValidCurrencyCode(value: string): boolean {
  return CURRENCY_PATTERN.test(value);
}

/**
 * Canonical shared-kernel money: a **non-negative** amount in integer minor units (e.g. cents) plus
 * an ISO-4217 currency code. Promoted from Catalog/Pricing/Cart at the rule of three (DECISIONS
 * D-029); the reconciled API uses a `string` currency (Pricing keeps its own `Currency` VO for code
 * validation and passes the code in) and carries the arithmetic the consumers need.
 *
 * Arithmetic preserves the non-negative invariant: `plus`/`minus`/`times` and the comparisons throw
 * a `BusinessRuleError` on a currency mismatch (or a negative/invalid result), so callers handle it
 * through the usual domain-error channel.
 */
export class Money extends ValueObject<MoneyProps> {
  static create(amountMinor: number, currency: string): Result<Money, ValidationError> {
    const issues: { readonly field: string; readonly message: string }[] = [];
    if (!Number.isInteger(amountMinor) || amountMinor < 0) {
      issues.push({
        field: "amountMinor",
        message: "must be a non-negative integer (minor units)",
      });
    }
    if (!CURRENCY_PATTERN.test(currency)) {
      issues.push({ field: "currency", message: "must be a 3-letter ISO-4217 code" });
    }
    if (issues.length > 0) {
      return err(new ValidationError("Invalid money", issues));
    }
    return ok(new Money({ amountMinor, currency }));
  }

  static zero(currency: string): Money {
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new BusinessRuleError(`Invalid currency code "${currency}" for Money.zero`);
    }
    return new Money({ amountMinor: 0, currency });
  }

  get amountMinor(): number {
    return this.props.amountMinor;
  }

  get currency(): string {
    return this.props.currency;
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money({
      amountMinor: this.props.amountMinor + other.amountMinor,
      currency: this.props.currency,
    });
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.props.amountMinor - other.amountMinor;
    if (result < 0) {
      throw new BusinessRuleError("Money cannot be negative");
    }
    return new Money({ amountMinor: result, currency: this.props.currency });
  }

  times(factor: number): Money {
    if (!Number.isInteger(factor) || factor < 0) {
      throw new BusinessRuleError("Money can only be multiplied by a non-negative integer");
    }
    return new Money({
      amountMinor: this.props.amountMinor * factor,
      currency: this.props.currency,
    });
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.props.amountMinor > other.amountMinor;
  }

  isZero(): boolean {
    return this.props.amountMinor === 0;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.props.currency) {
      throw new BusinessRuleError("Cannot operate on money of different currencies");
    }
  }
}
