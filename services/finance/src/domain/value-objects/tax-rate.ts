import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface TaxRateProps {
  readonly basisPoints: number;
}

/** A tax rate in basis points (1 bp = 0.01%). Applied with round-half-up on the taxed amount. */
export class TaxRate extends ValueObject<TaxRateProps> {
  static create(basisPoints: number): Result<TaxRate, ValidationError> {
    if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
      return err(
        new ValidationError("Invalid tax rate", [
          { field: "basisPoints", message: "must be an integer between 0 and 10000" },
        ]),
      );
    }
    return ok(new TaxRate({ basisPoints }));
  }

  get basisPoints(): number {
    return this.props.basisPoints;
  }

  /** Applies this rate to a minor-unit amount, rounding half up. */
  apply(amountMinor: number): number {
    return Math.round((amountMinor * this.props.basisPoints) / 10_000);
  }
}
