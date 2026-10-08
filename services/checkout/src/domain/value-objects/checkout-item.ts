import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

/**
 * Plan 2A: the exact variant a line sells, snapshotted from Cart. Absent on lines created before
 * variants were tracked.
 */
export interface CheckoutItemMerchandise {
  readonly variantRef: string;
  readonly sku: string;
  readonly title: string;
  readonly variantTitle: string | null;
}

interface CheckoutItemProps {
  readonly productRef: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
  readonly merchandise?: CheckoutItemMerchandise;
}

/** A line-item snapshot copied from Cart at checkout start — Checkout never recomputes it. */
export class CheckoutItem extends ValueObject<CheckoutItemProps> {
  static create(
    productRef: string,
    quantity: number,
    unitPriceAmountMinor: number,
    currency: string,
    merchandise?: CheckoutItemMerchandise,
  ): Result<CheckoutItem, ValidationError> {
    const issues: { readonly field: string; readonly message: string }[] = [];
    if (productRef.trim().length === 0) {
      issues.push({ field: "productRef", message: "must not be empty" });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      issues.push({ field: "quantity", message: "must be a positive integer" });
    }
    if (!Number.isInteger(unitPriceAmountMinor) || unitPriceAmountMinor < 0) {
      issues.push({ field: "unitPriceAmountMinor", message: "must be a non-negative integer" });
    }
    if (issues.length > 0) {
      return err(new ValidationError("Invalid checkout item", issues));
    }
    return ok(
      new CheckoutItem({
        productRef,
        quantity,
        unitPriceAmountMinor,
        currency,
        // Only present when set, so a legacy line's props (and equality) are exactly as before.
        ...(merchandise === undefined ? {} : { merchandise }),
      }),
    );
  }

  get productRef(): string {
    return this.props.productRef;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get unitPriceAmountMinor(): number {
    return this.props.unitPriceAmountMinor;
  }

  get currency(): string {
    return this.props.currency;
  }

  get variantRef(): string | undefined {
    return this.props.merchandise?.variantRef;
  }

  get sku(): string | undefined {
    return this.props.merchandise?.sku;
  }

  get title(): string | undefined {
    return this.props.merchandise?.title;
  }

  get variantTitle(): string | null | undefined {
    return this.props.merchandise?.variantTitle;
  }

  get lineTotalMinor(): number {
    return this.props.unitPriceAmountMinor * this.props.quantity;
  }
}
