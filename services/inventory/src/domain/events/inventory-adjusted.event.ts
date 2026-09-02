import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type InventoryAdjustmentReason =
  | "received"
  | "adjusted"
  | "reserved"
  | "released"
  | "committed"
  | "transferred_out"
  | "transferred_in";

export interface InventoryAdjustedData {
  readonly productId: string;
  readonly warehouseId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
  readonly reason: InventoryAdjustmentReason;
}

/** Raised whenever an item's stock level changes (received / adjusted / reserved / released). */
export class InventoryAdjusted extends DomainEvent {
  readonly eventName = "inventory.adjusted";
  readonly data: InventoryAdjustedData;

  constructor(props: DomainEventProps, data: InventoryAdjustedData) {
    super(props);
    this.data = data;
  }
}
