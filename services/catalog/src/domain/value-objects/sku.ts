import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface SkuProps {
  readonly value: string;
}

/** Stock-keeping unit — a non-empty identifier for a product/variant. */
export class Sku extends ValueObject<SkuProps> {
  static create(value: string): Result<Sku, ValidationError> {
    const guarded = Guard.againstEmpty(value, "sku");
    return guarded.ok ? ok(new Sku({ value: value.trim() })) : err(guarded.error);
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
