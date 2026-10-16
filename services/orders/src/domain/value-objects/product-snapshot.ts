import { type Money, ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

/** Plan 2A: the variant sold. Absent on orders placed before variants were tracked. */
export interface ProductSnapshotVariant {
  readonly variantRef: string;
  readonly sku: string;
  readonly variantTitle: string | null;
}

interface ProductSnapshotProps {
  readonly productId: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly variant?: ProductSnapshotVariant;
}

/**
 * An immutable copy of a product's identity + price captured at purchase time. Orders never hold a
 * live Catalog/Pricing reference — the order's "product" is its own snapshot (referenced by bare id).
 */
export class ProductSnapshot extends ValueObject<ProductSnapshotProps> {
  static create(
    productId: string,
    name: string,
    unitPrice: Money,
    variant?: ProductSnapshotVariant,
  ): Result<ProductSnapshot, ValidationError> {
    const issues: { readonly field: string; readonly message: string }[] = [];
    if (productId.trim().length === 0) {
      issues.push({ field: "productId", message: "must not be empty" });
    }
    if (name.trim().length === 0) {
      issues.push({ field: "name", message: "must not be empty" });
    }
    if (issues.length > 0) {
      return err(new ValidationError("Invalid product snapshot", issues));
    }
    return ok(
      new ProductSnapshot({
        productId,
        name,
        unitPrice,
        // Only present when set, so a legacy snapshot's props (and equality) are exactly as before.
        ...(variant === undefined ? {} : { variant }),
      }),
    );
  }

  get productId(): string {
    return this.props.productId;
  }

  get name(): string {
    return this.props.name;
  }

  get unitPrice(): Money {
    return this.props.unitPrice;
  }

  get variantRef(): string | undefined {
    return this.props.variant?.variantRef;
  }

  get sku(): string | undefined {
    return this.props.variant?.sku;
  }

  get variantTitle(): string | null | undefined {
    return this.props.variant?.variantTitle;
  }
}
