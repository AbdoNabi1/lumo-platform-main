import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface WarehouseDeactivatedData {
  readonly code: string;
}

/** Raised when a warehouse is deactivated (no longer eligible for new stock operations). */
export class WarehouseDeactivated extends DomainEvent {
  readonly eventName = "inventory.warehouse.deactivated";
  readonly data: WarehouseDeactivatedData;

  constructor(props: DomainEventProps, data: WarehouseDeactivatedData) {
    super(props);
    this.data = data;
  }
}
