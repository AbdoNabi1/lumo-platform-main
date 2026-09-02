# Sprint 1.2 — Commerce Core: Pricing + Inventory — Implementation Report

> **Date:** 2026-06-30 · **Status:** ✅ COMPLETE (all gates green) · **Phase 1 — Commerce Core.**

## 1. Summary

Two more business bounded contexts: **`@platform/pricing`** (price lists + prices) and
**`@platform/inventory`** (stock levels + reservations). Each is an independent Clean-Architecture
slice (domain → application → infrastructure → interfaces) built on the existing kernel, contracts,
messaging, and repository ports — **extending**, never replacing. Persistence + messaging use the
**in-memory adapters** (Prisma/broker deferred — no Docker); domain events flow through the
transactional outbox to an in-memory publisher, fully tested. No cross-context imports: both
contexts reference Catalog products by bare id (`ProductRef`); reservations reference orders/carts
by bare id.

## 2. Implemented components

### `@platform/pricing`

- **Domain:** `Price` (aggregate; emits `price.changed`), `PriceList` (aggregate; draft → active);
  value objects `Currency`, `Money` (context-local), `ProductRef`; repository ports.
- **Application:** `CreatePriceList`, `ActivatePriceList`, `CreatePrice`, `ChangePrice`.
- **Infrastructure:** in-memory repositories (outbox on save), `InMemoryUnitOfWork`,
  `PricingEventTranslator` (→ `pricing.price.changed.v1`).
- **Interfaces:** `PriceController` / `PriceListController` (framework-agnostic) + `present()`.

### `@platform/inventory`

- **Domain:** `InventoryItem` (aggregate; emits `inventory.adjusted` on every change), `Reservation`
  (entity); value objects `Quantity`, `WarehouseId`, `ProductRef`, `StockLevel` (immutable, with
  `receive`/`reserve`/`release`/`adjustTo`); `InventoryItemRepository` port.
- **Application:** `ReceiveStock`, `ReserveStock`, `ReleaseReservation`, `AdjustInventory`.
- **Infrastructure:** in-memory repository (outbox on save; natural-key lookup), `InMemoryUnitOfWork`,
  `InventoryEventTranslator` (→ `inventory.inventory_item.adjusted.v1`).
- **Interfaces:** `InventoryController` (receive/reserve/release/adjust) + `present()`.

## 3. Files created

- **`services/pricing`** (28): config (`package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`),
  `src/{index,composition,pricing.e2e.test}.ts`;
  `src/domain/value-objects/{currency,money,product-ref,value-objects.test}.ts`;
  `src/domain/{price,price-list,price-repository,price-list-repository,price.test}.ts`;
  `src/domain/events/price-changed.event.ts`;
  `src/application/{create-price-list,activate-price-list,create-price,change-price}.use-case.ts`;
  `src/infrastructure/{in-memory-unit-of-work,pricing-event-translator,in-memory-price-repository,in-memory-price-list-repository}.ts`;
  `src/interfaces/{presenter,price.controller,price-list.controller}.ts`.
- **`services/inventory`** (26): config (4); `src/{index,composition,inventory.e2e.test}.ts`;
  `src/domain/value-objects/{quantity,warehouse-id,product-ref,stock-level,value-objects.test}.ts`;
  `src/domain/{reservation,inventory-item,inventory-item-repository,inventory-item.test}.ts`;
  `src/domain/events/inventory-adjusted.event.ts`;
  `src/application/{receive-stock,reserve-stock,release-reservation,adjust-inventory}.use-case.ts`;
  `src/infrastructure/{in-memory-unit-of-work,inventory-event-translator,in-memory-inventory-item-repository}.ts`;
  `src/interfaces/{presenter,inventory.controller}.ts`.
- `docs/implementation/SPRINT_1_2_REPORT.md`.

## 4. Files modified

- Docs only: `PROJECT_STATE.md`, `AI_CONTEXT.md`, `DECISIONS.md` (append D-027),
  `docs/development/WORKSPACE_GUIDE.md`; `pnpm-lock.yaml` (workspace link). **No existing source
  package or service modified.**

## 5. Validation results

| Gate             | Result                                                                          |
| ---------------- | ------------------------------------------------------------------------------- |
| `pnpm lint`      | ✅ PASS                                                                         |
| `pnpm typecheck` | ✅ PASS                                                                         |
| `pnpm test`      | ✅ PASS (serialized, 28 task) — `@platform/pricing` 8, `@platform/inventory` 13 |
| `pnpm build`     | ✅ PASS                                                                         |
| `pnpm arch`      | ✅ PASS — 273 modules, 0 violations                                             |

One lint fix during validation: `Currency` was type-only in Pricing's `Money` → switched to `type`
import. `arch` confirms domain purity, no cross-context imports, and the dependency direction across
both new contexts.

## 6. Design decisions (see DECISIONS D-027)

- **Single inventory event** — `inventory.adjusted` carries a `reason`
  (`received`/`adjusted`/`reserved`/`released`) + resulting levels, covering all stock mutations
  (per the 1.2 scope; separate `stock.reserved`/`released` events deferred).
- **`Money` stays context-local** — now duplicated in two contexts (Catalog, Pricing); promote to
  the shared kernel only at the third consumer (rule of three). `Currency` is a new Pricing-local VO.
- **`StockLevel` is a rich immutable VO** — its `receive`/`reserve`/`release`/`adjustTo` return new
  levels and throw `BusinessRuleError` on invariant violations; the use-case catches into `Result`.
- **Cross-context referencing by id** — both contexts hold a `ProductRef` (bare Catalog id);
  reservations hold a bare order/cart reference. No imports, no FKs.
- Consistent with D-026 (VO factories → `Result`; framework-agnostic controllers; in-memory + outbox).

## 7. Trade-offs

- In-memory repositories: no real ACID/durability yet — the outbox-on-save pattern swaps to Prisma
  without touching domain/application. Inventory's natural-key lookup scans the store (fine
  in-memory; an index/`@@unique` arrives with Prisma).
- `present()` and `InMemoryUnitOfWork` are duplicated per context (interface/infra independence) —
  promote to shared kits when HTTP transport / Prisma land.

## 8. Technical debt

- `present()` + `InMemoryUnitOfWork` duplication across the four Phase-1 contexts (intentional;
  context independence). `ProductRef` now exists in catalog/pricing/inventory — a candidate for a
  shared `ProductRef`/`EntityRef` kernel VO once a stable shape is confirmed (still deferred).

## 9. Deferred items

Prisma persistence + per-context Postgres schemas (+ Redis stock counters); the price-quote and
reserve/release gRPC read APIs consumed by Cart/Checkout; reservation-TTL/abandonment job; tax
rates + discounts/coupons (Pricing); separate `stock.reserved`/`released`/`stock.low` events;
Redpanda/Debezium broker wiring; HTTP transport; `Money` kernel promotion.

## 10. Remaining work

None for Sprint 1.2. Next (per the roadmap): **Sprint 1.3 — Cart**.

**Sprint 1.2 is complete. Stopping — not beginning Sprint 1.3.**
