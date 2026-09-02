import { type ProductRef, ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface FulfillmentItemProps {
  readonly productRef: ProductRef;
  readonly quantity: number;
}

/**
 * An immutable snapshot of what must be fulfilled for one order line — a bare product reference
 * plus quantity. No price/tax data — Fulfillment never prices, only ships.
 */
export class FulfillmentItem extends ValueObject<FulfillmentItemProps> {
  static create(
    productRef: ProductRef,
    quantity: number,
  ): Result<FulfillmentItem, ValidationError> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return err(
        new ValidationError("Invalid fulfillment item", [
          { field: "quantity", message: "must be a positive integer" },
        ]),
      );
    }
    return ok(new FulfillmentItem({ productRef, quantity }));
  }

  get productRef(): ProductRef {
    return this.props.productRef;
  }

  get quantity(): number {
    return this.props.quantity;
  }
}
