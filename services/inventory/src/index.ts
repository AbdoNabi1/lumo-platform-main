export { wireInventory } from "./composition";
export type { InventoryWiringDeps, WiredInventory } from "./composition";
export { InventoryController } from "./interfaces/inventory.controller";
export { WarehouseController } from "./interfaces/warehouse.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { InventoryItem } from "./domain/inventory-item";
export type { InventoryItemRepository } from "./domain/inventory-item-repository";
export { Warehouse } from "./domain/warehouse";
export type { WarehouseRepository } from "./domain/warehouse-repository";
export {
  PrismaInventoryItemRepository,
  type PrismaInventoryItemRepositoryDeps,
} from "./infrastructure/prisma-inventory-item-repository";
export {
  PrismaWarehouseRepository,
  type PrismaWarehouseRepositoryDeps,
} from "./infrastructure/prisma-warehouse-repository";
export { INVENTORY_PUBLISHED_EVENTS } from "./infrastructure/inventory-event-translator";
