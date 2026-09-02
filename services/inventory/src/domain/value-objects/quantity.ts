import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface QuantityProps {
  readonly value: number;
}

/** A positive integer movement amount (e.g. units received or reserved). */
export class Quantity extends ValueObject<QuantityProps> {
  static create(value: number): Result<Quantity, ValidationError> {
    if (!Number.isInteger(value) || value < 1) {
      return err(
        new ValidationError("Invalid quantity", [
          { field: "quantity", message: "must be a positive integer" },
        ]),
      );
    }
    return ok(new Quantity({ value }));
  }

  get value(): number {
    return this.props.value;
  }
}
