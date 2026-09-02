import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface WarehouseRegisteredData {
  readonly code: string;
  readonly name: string;
}

/** Raised when a new warehouse is registered into the registry. */
export class WarehouseRegistered extends DomainEvent {
  readonly eventName = "inventory.warehouse.registered";
  readonly data: WarehouseRegisteredData;

  constructor(props: DomainEventProps, data: WarehouseRegisteredData) {
    super(props);
    this.data = data;
  }
}
