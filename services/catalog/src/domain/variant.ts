import { Entity, type Money, type UniqueEntityId, ValidationError } from "@platform/domain";
import type { Sku } from "./value-objects/sku";
import type { VariantSelection } from "./value-objects/variant-selection";

/** Plan 2C-1: Shopify's variant fields beyond price (price card, inventory card, shipping card). */
export interface VariantAttributes {
  /** Shown struck through on the storefront; must be HIGHER than the price, same currency. */
  readonly compareAtPrice: Money | null;
  /** Cost per item — staff-only (margin); never in a public DTO. */
  readonly cost: Money | null;
  readonly barcode: string | null;
  readonly weightGrams: number | null;
  /** Shopify "physical product": false for a service or digital good (no shipping). */
  readonly requiresShipping: boolean;
  readonly taxable: boolean;
}

export const DEFAULT_VARIANT_ATTRIBUTES: VariantAttributes = Object.freeze({
  compareAtPrice: null,
  cost: null,
  barcode: null,
  weightGrams: null,
  requiresShipping: true,
  taxable: true,
});

export const MAX_BARCODE_LENGTH = 64;
export const MAX_WEIGHT_GRAMS = 1_000_000;

/** Throws one `ValidationError` naming every invalid attribute, judged against `price`. */
export function assertValidAttributes(price: Money, attributes: VariantAttributes): void {
  const issues: { field: string; message: string }[] = [];
  const { compareAtPrice, cost, barcode, weightGrams } = attributes;
  if (compareAtPrice !== null) {
    if (compareAtPrice.currency !== price.currency) {
      issues.push({ field: "compareAtAmountMinor", message: "must use the variant's currency" });
    } else if (compareAtPrice.amountMinor <= price.amountMinor) {
      issues.push({ field: "compareAtAmountMinor", message: "must be higher than the price" });
    }
  }
  if (cost !== null && cost.currency !== price.currency) {
    issues.push({ field: "costAmountMinor", message: "must use the variant's currency" });
  }
  if (barcode !== null && (barcode.trim().length === 0 || barcode.length > MAX_BARCODE_LENGTH)) {
    issues.push({ field: "barcode", message: `must be 1-${MAX_BARCODE_LENGTH} characters` });
  }
  if (
    weightGrams !== null &&
    (!Number.isInteger(weightGrams) || weightGrams < 0 || weightGrams > MAX_WEIGHT_GRAMS)
  ) {
    issues.push({ field: "weightGrams", message: `must be a whole number 0-${MAX_WEIGHT_GRAMS}` });
  }
  if (issues.length > 0) throw new ValidationError("Invalid variant", issues);
}

/** Everything `Product.updateVariant` may change at once. The aggregate checks the selection rules. */
export interface VariantChanges {
  readonly sku: Sku;
  readonly price: Money;
  readonly selection: VariantSelection | null;
  readonly attributes: VariantAttributes;
}

interface VariantProps {
  sku: Sku;
  price: Money;
  selection: VariantSelection | null;
  attributes: VariantAttributes;
}

/**
 * A purchasable variant of a product (identity by id). `selection` places it in the product's
 * option matrix. Plan 2C-1 made `selection` editable (through `Product.updateVariant`, which
 * re-checks uniqueness and the declared options) and added Shopify's variant attributes.
 */
export class Variant extends Entity<VariantProps> {
  static create(
    id: UniqueEntityId,
    sku: Sku,
    price: Money,
    selection: VariantSelection | null = null,
    attributes: VariantAttributes = DEFAULT_VARIANT_ATTRIBUTES,
  ): Variant {
    assertValidAttributes(price, attributes);
    return new Variant({ sku, price, selection, attributes }, id);
  }

  /** Applies a full change set. Selection rules are the aggregate's job; attributes are checked here. */
  apply(changes: VariantChanges): void {
    assertValidAttributes(changes.price, changes.attributes);
    this.props.sku = changes.sku;
    this.props.price = changes.price;
    this.props.selection = changes.selection;
    this.props.attributes = changes.attributes;
  }

  get sku(): Sku {
    return this.props.sku;
  }

  get price(): Money {
    return this.props.price;
  }

  get selection(): VariantSelection | null {
    return this.props.selection;
  }

  get attributes(): VariantAttributes {
    return this.props.attributes;
  }
}
