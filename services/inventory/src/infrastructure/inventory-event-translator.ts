import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { InventoryAdjusted } from "../domain/events/inventory-adjusted.event";
import { WarehouseDeactivated } from "../domain/events/warehouse-deactivated.event";
import { WarehouseRegistered } from "../domain/events/warehouse-registered.event";

/** Maps Inventory domain events to integration events (`INVENTORY_PUBLISHED_EVENTS`, 3 types). */
export class InventoryEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof InventoryAdjusted) {
      return {
        type: "inventory.inventory_item.adjusted",
        eventVersion: 1,
        aggregateType: "inventory_item",
        payload: event.data,
      };
    }
    if (event instanceof WarehouseRegistered) {
      return {
        type: "inventory.warehouse.registered",
        eventVersion: 1,
        aggregateType: "warehouse",
        payload: event.data,
      };
    }
    if (event instanceof WarehouseDeactivated) {
      return {
        type: "inventory.warehouse.deactivated",
        eventVersion: 1,
        aggregateType: "warehouse",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Inventory context (validated fail-closed by `inventoryModule()`). */
export const INVENTORY_PUBLISHED_EVENTS: readonly string[] = [
  "inventory.inventory_item.adjusted",
  "inventory.warehouse.registered",
  "inventory.warehouse.deactivated",
];
