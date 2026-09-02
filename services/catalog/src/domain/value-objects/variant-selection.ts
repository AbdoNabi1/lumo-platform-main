import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface VariantSelectionProps {
  readonly values: Readonly<Record<string, string>>;
}

/** One variant's position in the product's option matrix — option name -> chosen value. */
export class VariantSelection extends ValueObject<VariantSelectionProps> {
  static create(
    values: Readonly<Record<string, string>>,
  ): Result<VariantSelection, ValidationError> {
    if (Object.keys(values).length === 0) {
      return err(
        new ValidationError("Invalid variant selection", [
          { field: "values", message: "must select at least one option" },
        ]),
      );
    }
    return ok(new VariantSelection({ values: { ...values } }));
  }

  get values(): Readonly<Record<string, string>> {
    return this.props.values;
  }

  /** True when both selections choose the same value for every option (order-independent). */
  matches(other: VariantSelection): boolean {
    const keys = Object.keys(this.props.values);
    const otherKeys = Object.keys(other.props.values);
    if (keys.length !== otherKeys.length) return false;
    return keys.every((key) => this.props.values[key] === other.props.values[key]);
  }
}
