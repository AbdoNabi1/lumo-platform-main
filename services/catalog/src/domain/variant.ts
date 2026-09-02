import { Entity, type Money, type UniqueEntityId } from "@platform/domain";
import type { Sku } from "./value-objects/sku";
import type { VariantSelection } from "./value-objects/variant-selection";

interface VariantProps {
  sku: Sku;
  price: Money;
  readonly selection: VariantSelection | null;
}

/**
 * A purchasable variant of a product (identity by id). `selection` (Commerce Sprint 1) places the
 * variant in the product's option matrix; immutable after creation in Phase 1 — `UpdateVariant`
 * (Sprint 7.0) only edits `sku`/`price` in place, never `selection`.
 */
export class Variant extends Entity<VariantProps> {
  static create(
    id: UniqueEntityId,
    sku: Sku,
    price: Money,
    selection: VariantSelection | null = null,
  ): Variant {
    return new Variant({ sku, price, selection }, id);
  }

  /** In-place edit of price/SKU only (Sprint 7.0 `UpdateVariant`) — `selection` never changes. */
  update(sku: Sku, price: Money): void {
    this.props.sku = sku;
    this.props.price = price;
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
}
