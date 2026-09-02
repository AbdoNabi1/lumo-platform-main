import { Entity, type UniqueEntityId } from "@platform/domain";
import type { Quantity } from "./value-objects/quantity";

interface ReservationProps {
  readonly quantity: Quantity;
  /** Bare reference to the reserving order/cart (cross-context id; no import). */
  readonly reference: string;
}

/** A held quantity of stock for an order/cart (identity by id). */
export class Reservation extends Entity<ReservationProps> {
  static create(id: UniqueEntityId, quantity: Quantity, reference: string): Reservation {
    return new Reservation({ quantity, reference }, id);
  }

  get quantity(): Quantity {
    return this.props.quantity;
  }

  get reference(): string {
    return this.props.reference;
  }
}
