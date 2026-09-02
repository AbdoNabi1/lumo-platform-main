import { Entity, type Money, type UniqueEntityId } from "@platform/domain";
import type { ProductSnapshot } from "./value-objects/product-snapshot";

interface OrderItemProps {
  readonly snapshot: ProductSnapshot;
  readonly quantity: number;
}

/** A purchased line: a product snapshot and the quantity ordered (identity by id). */
export class OrderItem extends Entity<OrderItemProps> {
  static create(id: UniqueEntityId, snapshot: ProductSnapshot, quantity: number): OrderItem {
    return new OrderItem({ snapshot, quantity }, id);
  }

  get snapshot(): ProductSnapshot {
    return this.props.snapshot;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get lineTotal(): Money {
    return this.props.snapshot.unitPrice.times(this.props.quantity);
  }
}
