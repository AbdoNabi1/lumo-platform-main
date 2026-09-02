import {
  AggregateRoot,
  BusinessRuleError,
  type ProductRef,
  type UniqueEntityId,
} from "@platform/domain";
import {
  InventoryAdjusted,
  type InventoryAdjustmentReason,
} from "./events/inventory-adjusted.event";
import { Reservation } from "./reservation";
import type { Quantity } from "./value-objects/quantity";
import { StockLevel } from "./value-objects/stock-level";
import type { WarehouseId } from "./value-objects/warehouse-id";

interface InventoryItemProps {
  readonly product: ProductRef;
  readonly warehouseId: WarehouseId;
  stockLevel: StockLevel;
  readonly reservations: Reservation[];
}

/**
 * Tracks stock for a product at a warehouse. Every quantity change emits `inventory.adjusted`
 * (carrying the reason + resulting levels). Invariant violations throw `BusinessRuleError`.
 */
export class InventoryItem extends AggregateRoot<InventoryItemProps> {
  static create(id: UniqueEntityId, product: ProductRef, warehouseId: WarehouseId): InventoryItem {
    return new InventoryItem(
      { product, warehouseId, stockLevel: StockLevel.zero(), reservations: [] },
      id,
    );
  }

  /**
   * Rebuilds a persisted item exactly as stored — no domain events raised, persisted `version`
   * carried for optimistic locking (ADR-0003, G-12). Reservations must be the live set.
   */
  static reconstitute(
    id: UniqueEntityId,
    product: ProductRef,
    warehouseId: WarehouseId,
    stockLevel: StockLevel,
    reservations: readonly Reservation[],
    version: number,
  ): InventoryItem {
    return new InventoryItem(
      { product, warehouseId, stockLevel, reservations: [...reservations] },
      id,
      version,
    );
  }

  receive(quantity: Quantity, eventId: string, occurredAt: Date): void {
    this.props.stockLevel = this.props.stockLevel.receive(quantity.value);
    this.recordAdjustment("received", eventId, occurredAt);
  }

  adjust(onHand: number, eventId: string, occurredAt: Date): void {
    this.props.stockLevel = this.props.stockLevel.adjustTo(onHand);
    this.recordAdjustment("adjusted", eventId, occurredAt);
  }

  reserve(
    reservationId: UniqueEntityId,
    quantity: Quantity,
    reference: string,
    eventId: string,
    occurredAt: Date,
  ): void {
    this.props.stockLevel = this.props.stockLevel.reserve(quantity.value);
    this.props.reservations.push(Reservation.create(reservationId, quantity, reference));
    this.recordAdjustment("reserved", eventId, occurredAt);
  }

  releaseReservation(reservationId: string, eventId: string, occurredAt: Date): void {
    const reservation = this.props.reservations.find((r) => r.id.toString() === reservationId);
    if (reservation === undefined) {
      throw new BusinessRuleError("Reservation not found");
    }
    this.props.reservations.splice(this.props.reservations.indexOf(reservation), 1);
    this.props.stockLevel = this.props.stockLevel.release(reservation.quantity.value);
    this.recordAdjustment("released", eventId, occurredAt);
  }

  /** Fulfills a reservation (ADR-0013 commit step) — removes it from the ledger and drops on-hand+reserved together. */
  commitReservation(reservationId: string, eventId: string, occurredAt: Date): void {
    const reservation = this.props.reservations.find((r) => r.id.toString() === reservationId);
    if (reservation === undefined) {
      throw new BusinessRuleError("Reservation not found");
    }
    this.props.reservations.splice(this.props.reservations.indexOf(reservation), 1);
    this.props.stockLevel = this.props.stockLevel.commit(reservation.quantity.value);
    this.recordAdjustment("committed", eventId, occurredAt);
  }

  /** The out-leg of a warehouse-to-warehouse transfer — removes unreserved on-hand stock from this item. */
  transferOut(quantity: Quantity, eventId: string, occurredAt: Date): void {
    this.props.stockLevel = this.props.stockLevel.remove(quantity.value);
    this.recordAdjustment("transferred_out", eventId, occurredAt);
  }

  /** The in-leg of a warehouse-to-warehouse transfer — receives stock transferred from another item. */
  transferIn(quantity: Quantity, eventId: string, occurredAt: Date): void {
    this.props.stockLevel = this.props.stockLevel.receive(quantity.value);
    this.recordAdjustment("transferred_in", eventId, occurredAt);
  }

  get product(): ProductRef {
    return this.props.product;
  }

  get warehouseId(): WarehouseId {
    return this.props.warehouseId;
  }

  get stockLevel(): StockLevel {
    return this.props.stockLevel;
  }

  /** The live reservation set (persisted verbatim; releases remove entries). */
  get reservations(): readonly Reservation[] {
    return this.props.reservations;
  }

  private recordAdjustment(
    reason: InventoryAdjustmentReason,
    eventId: string,
    occurredAt: Date,
  ): void {
    this.addDomainEvent(
      new InventoryAdjusted(
        { eventId, aggregateId: this.id, occurredAt },
        {
          productId: this.props.product.value,
          warehouseId: this.props.warehouseId.value,
          onHand: this.props.stockLevel.onHand,
          reserved: this.props.stockLevel.reserved,
          available: this.props.stockLevel.available,
          reason,
        },
      ),
    );
  }
}
