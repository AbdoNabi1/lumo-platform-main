import { Entity, type Money, type ProductRef, type UniqueEntityId } from "@platform/domain";
import type { Quantity } from "./value-objects/quantity";

/** Caller-supplied snapshots captured when a line is added — Cart stores them verbatim, computes neither. */
export interface CartItemSnapshots {
  /** Inventory's `available` snapshot at add-time (from `@platform/inventory`, never imported directly). */
  readonly inventoryAvailable?: number;
  /** Free-form caller metadata (e.g. selected variant options), stored verbatim. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface CartItemProps {
  readonly productRef: ProductRef;
  quantity: Quantity;
  /** Unit price snapshot captured when the line was added (caller-supplied; from Pricing). */
  readonly unitPrice: Money;
  readonly inventoryAvailable?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** A single cart line: a product reference, a quantity, a unit-price snapshot, and optional inventory/metadata snapshots (Sprint 4.5). */
export class CartItem extends Entity<CartItemProps> {
  static create(
    id: UniqueEntityId,
    productRef: ProductRef,
    quantity: Quantity,
    unitPrice: Money,
    snapshots: CartItemSnapshots = {},
  ): CartItem {
    return new CartItem(
      {
        productRef,
        quantity,
        unitPrice,
        inventoryAvailable: snapshots.inventoryAvailable,
        metadata: snapshots.metadata,
      },
      id,
    );
  }

  get productRef(): ProductRef {
    return this.props.productRef;
  }

  get quantity(): Quantity {
    return this.props.quantity;
  }

  get unitPrice(): Money {
    return this.props.unitPrice;
  }

  get inventoryAvailable(): number | undefined {
    return this.props.inventoryAvailable;
  }

  get metadata(): Readonly<Record<string, unknown>> | undefined {
    return this.props.metadata;
  }

  get lineTotal(): Money {
    return this.props.unitPrice.times(this.props.quantity.value);
  }

  increaseBy(quantity: Quantity): void {
    this.props.quantity = this.props.quantity.add(quantity);
  }

  changeQuantityTo(quantity: Quantity): void {
    this.props.quantity = quantity;
  }
}
