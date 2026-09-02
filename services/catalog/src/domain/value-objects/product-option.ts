import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface ProductOptionProps {
  readonly name: string;
  readonly values: readonly string[];
}

/** A configurable option a product's variants are matrixed over (e.g. `Color: [Red, Blue]`). */
export class ProductOption extends ValueObject<ProductOptionProps> {
  static create(name: string, values: readonly string[]): Result<ProductOption, ValidationError> {
    if (name.trim().length === 0) {
      return err(
        new ValidationError("Invalid product option", [
          { field: "name", message: "must not be empty" },
        ]),
      );
    }
    if (values.length === 0 || values.some((v) => v.trim().length === 0)) {
      return err(
        new ValidationError("Invalid product option", [
          { field: "values", message: "must have at least one non-empty value" },
        ]),
      );
    }
    if (new Set(values).size !== values.length) {
      return err(
        new ValidationError("Invalid product option", [
          { field: "values", message: "must not contain duplicates" },
        ]),
      );
    }
    return ok(new ProductOption({ name, values: [...values] }));
  }

  get name(): string {
    return this.props.name;
  }

  get values(): readonly string[] {
    return this.props.values;
  }
}
