import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface CheckoutItemProps {
  readonly productRef: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
}

/** A line-item snapshot copied from Cart at checkout start — Checkout never recomputes it. */
export class CheckoutItem extends ValueObject<CheckoutItemProps> {
  static create(
    productRef: string,
    quantity: number,
    unitPriceAmountMinor: number,
    currency: string,
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
    return ok(new CheckoutItem({ productRef, quantity, unitPriceAmountMinor, currency }));
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

  get lineTotalMinor(): number {
    return this.props.unitPriceAmountMinor * this.props.quantity;
  }
}
