# @platform/inventory

## Purpose

The **Inventory** bounded context (Phase 1 Commerce Core): stock levels and reservations per
product × warehouse. Owns its data; references Catalog products only by bare id (`ProductRef`) and
reserving orders/carts by bare reference — no cross-context import.

## Architecture (clean-architecture slice)

- **domain/** — `InventoryItem` (aggregate; emits `inventory.adjusted` on every quantity change),
  `Reservation` (entity); value objects `Quantity`, `WarehouseId`, `ProductRef`, `StockLevel`
  (immutable, with `receive`/`reserve`/`release`/`adjustTo` returning new levels and throwing on
  invariant violations); `InventoryItemRepository` port. Pure (`@platform/domain` only).
- **application/** — `ReceiveStock`, `ReserveStock`, `ReleaseReservation`, `AdjustInventory`
  (`@platform/application` `UseCase`). VO validation returns `Result`; aggregate invariants throw
  `DomainError` caught into the `Result` channel.
- **infrastructure/** — in-memory repository (writes the outbox on save; natural-key lookup),
  `InMemoryUnitOfWork`, `InventoryEventTranslator` (→ `inventory.inventory_item.adjusted.v1`).
- **interfaces/** — `InventoryController` (framework-agnostic) + `present()` (no HTTP server).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## Dependencies

`@platform/{domain, application, contracts, repository, messaging, domain-events, types, utils}`.
Dependency direction enforced by `pnpm arch`.

## Extension points

Replace in-memory persistence with Prisma + Redis stock counters (outbox inside the DB
transaction); add the reservation-TTL/abandonment job and the gRPC reserve/release API consumed by
the checkout saga. All deferred (need infrastructure).
