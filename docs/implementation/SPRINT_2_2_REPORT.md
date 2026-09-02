# Sprint 2.2 Report — Production Prisma Infrastructure

> 2026-07-05. Scope: Prisma repositories + mappers + rehydration + optimistic locking +
> ADR-0003 transactions + same-transaction outbox, for all 9 bounded contexts. Nothing else
> (no Redis/broker/transport/Temporal; no controller or use-case changes).

## Delivered

### 1. Platform messaging adapters (`@platform/db`)

- `PrismaOutboxStore` — appends inside the caller's transaction (fails loudly without one,
  ADR-0003); `fetchPending` in insertion order; `markPublished` guarded by `status = pending`.
- `PrismaProcessedEventStore` — consumer-group-scoped; `recordIfNew` is an INSERT racing on the
  composite PK (unique-violation loser returns `false`) — the ADR-0005 contract made structural.
- `PrismaDeadLetterStore` — verbatim bytes/headers per consumer group for byte-identical replay.

### 2. Rehydration (Gap G-12 eliminated)

Every aggregate gained `static reconstitute(...)` — rebuilds exactly from persistence, raises
**no** domain events, carries the persisted `version`. Closed-set VOs gained `from(value)`
(CheckoutState, PaymentStatus, PublishState). New read surface where mapping required it:
`Order.history`, `InventoryItem.reservations`, `PaymentIntent.charges/refunds`.
**Order status / consent state / payment remaining are still derived, never stored.**

### 3. Mappers + repositories (one per context, `services/*/src/infrastructure/`)

| Context   | Mapper                    | Repository                                            | Notes                                                                                          |
| --------- | ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Orders    | `order.mapper`            | `PrismaOrderRepository`                               | history append-only via `skipDuplicates`; address row separate (PII isolation)                 |
| Inventory | `inventory-item.mapper`   | `PrismaInventoryItemRepository`                       | live reservation set replaced in-tx; G-7 ledger redesign stays adapter-local                   |
| Cart      | `cart.mapper`             | `PrismaCartRepository`                                | mutable line set replaced in-tx                                                                |
| Identity  | `customer.mapper`         | `PrismaCustomerRepository`                            | `(tenant_id,email)` unique index is the arbiter (D-032 repaid); consent log append-only        |
| Checkout  | `checkout-session.mapper` | `PrismaCheckoutSessionRepository`                     |                                                                                                |
| Payments  | `payment-intent.mapper`   | `PrismaPaymentIntentRepository`                       | charges/refunds append-only; `psp_token` only (G-27)                                           |
| Media     | `asset.mapper`            | `PrismaAssetRepository`                               |                                                                                                |
| Pricing   | `pricing.mappers`         | `PrismaPriceRepository`, `PrismaPriceListRepository`  |                                                                                                |
| Catalog   | `catalog.mappers`         | `PrismaProductRepository`, `PrismaCategoryRepository` | schema gained `products.media_refs text[]` (init migration regenerated — never deployed, safe) |

Uniform conventions: **writes require the UnitOfWork's transaction client** (fail-loud);
reads use it when supplied; every query is tenant-scoped from injected `tenantId` (ADR-0008);
update = `WHERE id AND tenant_id AND version` → 0 rows ⇒ `ConcurrencyError` (no retry, no
silent overwrite); create persists `version = 1` (fresh aggregates are in-memory version 0);
outbox append shares the transaction; Prisma types never cross the infrastructure boundary
(mappers use structural row interfaces; domain imports nothing new).

### 4. Tests

- All existing unit/e2e suites pass unchanged (in-memory adapters remain the test wiring).
- **Reference integration suite**: `prisma-order-repository.integration.test.ts` — round-trip
  fidelity (derived status, items, address, version), same-transaction outbox, and stale-write
  `ConcurrencyError`. **Gated on `DATABASE_URL_TEST` and honestly skipped without it** — this
  environment has no PostgreSQL host. Remaining contexts replicate the pattern on the first
  Docker session.

## Validation

`prisma validate` ✅ · `prisma generate` ✅ · lint/typecheck/test 102/102 ✅ · build ✅ ·
dependency-cruiser 0 violations (392 modules) ✅.

## Honestly blocked (first Docker-capable session, in order)

1. `prisma migrate deploy` against fresh Postgres 16 — first real execution of the offline-
   bootstrapped `20260704000000_init`.
2. Run the reference integration suite; replicate it across the other 8 contexts.
3. RLS tenant policies as migration #2 (MIGRATIONS.md §3).
4. Production composition roots wiring the Prisma adapters (in-memory stays for tests) —
   lands with the transport sprint, which is what makes a "production wiring" runnable at all.
