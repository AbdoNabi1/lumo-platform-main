import { ValidationError, ValueObject, isValidCurrencyCode } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface CurrencyProps {
  readonly code: string;
}

/** ISO-4217 currency code, validated at the Finance boundary (exchange rates, tax profiles). */
export class Currency extends ValueObject<CurrencyProps> {
  static create(code: string): Result<Currency, ValidationError> {
    if (!isValidCurrencyCode(code)) {
      return err(
        new ValidationError("Invalid currency", [
          { field: "code", message: "must be a 3-letter ISO-4217 code" },
        ]),
      );
    }
    return ok(new Currency({ code }));
  }

  get code(): string {
    return this.props.code;
  }
}
