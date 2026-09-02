import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { AdjustInventory } from "./application/adjust-inventory.use-case";
import { CheckAvailability } from "./application/check-availability.use-case";
import { CommitReservation } from "./application/commit-reservation.use-case";
import { ListInventoryByProduct } from "./application/list-inventory-by-product.use-case";
import { ListInventoryItems } from "./application/list-inventory-items.use-case";
import { ReceiveStock } from "./application/receive-stock.use-case";
import { ReleaseReservation } from "./application/release-reservation.use-case";
import { ReserveStock } from "./application/reserve-stock.use-case";
import { TransferStock } from "./application/transfer-stock.use-case";
import { DeactivateWarehouse, RegisterWarehouse } from "./application/warehouse.use-cases";
import type { InventoryItemRepository } from "./domain/inventory-item-repository";
import type { WarehouseRepository } from "./domain/warehouse-repository";
import { InMemoryInventoryItemRepository } from "./infrastructure/in-memory-inventory-item-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { InMemoryWarehouseRepository } from "./infrastructure/in-memory-warehouse-repository";
import { InventoryEventTranslator } from "./infrastructure/inventory-event-translator";
import { PrismaInventoryItemRepository } from "./infrastructure/prisma-inventory-item-repository";
import { PrismaWarehouseRepository } from "./infrastructure/prisma-warehouse-repository";
import { InventoryController } from "./interfaces/inventory.controller";
import { WarehouseController } from "./interfaces/warehouse.controller";

export interface InventoryWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaInventoryItemRepository` +
   * `PrismaWarehouseRepository` + `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence
   * convention as `wireOrders`/`wirePayments`); absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Inventory table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredInventory {
  readonly inventory: InventoryController;
  readonly warehouse: WarehouseController;
  /**
   * The same `WarehouseRepository` instance `warehouse` above is built from (Phase 3 Task 10) —
   * exposed so a cross-context read adapter (e.g. Checkout's `InventoryValidationPort`) can list
   * the tenant's warehouses directly (`list`) without a second, state-disconnected repository
   * instance. Same minimal-exposure convention as `WiredPricing.priceRepository`.
   */
  readonly warehouseRepository: WarehouseRepository;
  /**
   * The same `InventoryItemRepository` instance `inventory` above is built from (Phase 3 Task 12) —
   * exposed so a cross-context adapter (Orders' `InventoryPort`) can call
   * `findByProductAndWarehouse`/`findByReservationReference` directly, without a second,
   * state-disconnected repository instance. Same minimal-exposure convention as
   * `warehouseRepository` above.
   */
  readonly inventoryItemRepository: InventoryItemRepository;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds both controllers from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildControllers(
  items: InventoryItemRepository,
  warehouses: WarehouseRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: InventoryWiringDeps,
): { inventory: InventoryController; warehouse: WarehouseController } {
  const controller = new InventoryController({
    receiveStock: new ReceiveStock({
      items,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    reserveStock: new ReserveStock({
      items,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    releaseReservation: new ReleaseReservation({
      items,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    adjustInventory: new AdjustInventory({
      items,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    commitReservation: new CommitReservation({
      items,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    transferStock: new TransferStock({
      items,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    listInventoryItems: new ListInventoryItems({ items }),
    checkAvailability: new CheckAvailability({ items }),
    listInventoryByProduct: new ListInventoryByProduct({ items }),
  });

  const warehouseController = new WarehouseController({
    registerWarehouse: new RegisterWarehouse({
      warehouses,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    deactivateWarehouse: new DeactivateWarehouse({
      warehouses,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
  });

  return { inventory: controller, warehouse: warehouseController };
}

/**
 * Composition root for the Inventory context. Prisma slice (`PrismaInventoryItemRepository` +
 * `PrismaWarehouseRepository` + `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireInventory(deps: InventoryWiringDeps): WiredInventory {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireInventory: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new InventoryEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "inventory",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const items = new PrismaInventoryItemRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const warehouses = new PrismaWarehouseRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);
    const { inventory, warehouse } = buildControllers(items, warehouses, unitOfWork, deps);

    return {
      inventory,
      warehouse,
      warehouseRepository: warehouses,
      inventoryItemRepository: items,
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new InventoryEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "inventory",
  });
  const context = rootEventContext(deps.idGenerator);

  const items = new InMemoryInventoryItemRepository({ outbox: outboxWriter, context });
  const warehouses = new InMemoryWarehouseRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const { inventory, warehouse } = buildControllers(items, warehouses, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  bus.subscribe("inventory.inventory_item.adjusted.v1", sink);
  bus.subscribe("inventory.warehouse.registered.v1", sink);
  bus.subscribe("inventory.warehouse.deactivated.v1", sink);

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    inventory,
    warehouse,
    warehouseRepository: warehouses,
    inventoryItemRepository: items,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
