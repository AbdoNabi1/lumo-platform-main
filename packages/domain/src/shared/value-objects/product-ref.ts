import { err, ok, type Result } from "@platform/types";
import { type ValidationError } from "../errors";
import { Guard } from "../guards";
import { ValueObject } from "../value-object";

interface ProductRefProps {
  readonly value: string;
}

/**
 * Canonical shared-kernel reference to a Catalog product/variant by **bare id** — no cross-context
 * import or foreign key. Promoted from Pricing/Inventory/Cart at the rule of three (DECISIONS D-029).
 * The owning context (Catalog) is never imported; consumers hold only the id string.
 */
export class ProductRef extends ValueObject<ProductRefProps> {
  static create(value: string): Result<ProductRef, ValidationError> {
    const guarded = Guard.againstEmpty(value, "productId");
    return guarded.ok ? ok(new ProductRef({ value })) : err(guarded.error);
  }

  get value(): string {
    return this.props.value;
  }
}
