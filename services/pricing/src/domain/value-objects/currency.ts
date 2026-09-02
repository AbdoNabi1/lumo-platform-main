import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface CurrencyProps {
  readonly code: string;
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** An ISO-4217 currency code (3 uppercase letters). */
export class Currency extends ValueObject<CurrencyProps> {
  static create(code: string): Result<Currency, ValidationError> {
    if (!CURRENCY_PATTERN.test(code)) {
      return err(
        new ValidationError(`Invalid currency "${code}"`, [
          { field: "currency", message: "must be a 3-letter ISO-4217 code" },
        ]),
      );
    }
    return ok(new Currency({ code }));
  }

  get code(): string {
    return this.props.code;
  }

  override toString(): string {
    return this.props.code;
  }
}
