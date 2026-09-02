# Sprint 0.5 — Phase 1 (Commerce Core) Business-Layer Design

> **Status: APPROVED DESIGN — 2026-06-29 · Phase 1 (Commerce Core) only.**
> Implementation-oriented; Sprint 0.6 begins from this document. **No code, no packages, no ADRs**
> were produced by this sprint. This design **conforms to the architecture contract**
> ([arch 02](../architecture/02-monorepo-packages-and-feature-first.md),
> [03](../architecture/03-domain-and-database-boundaries.md),
> [04](../architecture/04-api-and-service-communication.md),
> [05](../architecture/05-events-queues-workers-and-jobs.md)); it scopes _what we build now_, it does
> not change any frozen invariant — so **no ADR is required**.

## 0. Principles (binding for Phase 1)

1. **YAGNI** — design only what the end-to-end purchase path needs. Anything else is a one-line
   pointer in §9, not a design.
2. **No abstraction before its first consumer.** New shared packages/ports are introduced **just-in-time**
   in the sprint that uses them (§10), never speculatively.
3. **Clean Architecture + DDD boundaries preserved** — dependencies point inward; the domain stays pure.
4. **Conform to the contract.** Backend modules live under `services/<context>/` (the contract's axis);
   the doc-03 context list is unchanged; nothing here needs an ADR.
5. **Evolutionary over speculative** — prefer the simple, maintainable solution; extend when a real
   requirement arrives.

### Deliberately deferred (built later, not now)

- Catalog: Collections, Bundles, upsell/cross-sell, search index. Attributes = JSONB, not an entity.
- Identity: Households, Child Profiles (keep only the encrypted-field seam), fine-grained ReBAC.
- Orders: Shipment/Return aggregates (refund path is in scope).
- Pricing: dynamic/AI pricing, complex promo stacking.
- All data-plane / growth / platform contexts (Tracking, Attribution, Analytics, Search,
  Recommendations, Marketing, Feed, Reviews, Loyalty, full Notifications) — see §9.

---

## 1. Phase 1 Bounded Contexts (9)

Each context owns its data exclusively (one PostgreSQL schema; no cross-context FK/join). Reads of
another context go through its API or via snapshots — never its tables.

| Context       | Phase-1 responsibility                                        | Store                          | Explicitly OUT (YAGNI)                         |
| ------------- | ------------------------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| **Catalog**   | Products, variants, categories; publish state                 | PG `catalog`                   | bundles, collections, cross-sell, search index |
| **Media**     | Asset metadata + signed URL (thin slice)                      | PG `media` + S3/R2             | derivative pipeline, CDN tuning                |
| **Pricing**   | List price, tax category/rate, coupons/discounts, price quote | PG `pricing`                   | dynamic/AI pricing, promo stacking             |
| **Inventory** | Stock per variant×warehouse, reservations, movement ledger    | PG `inventory` + Redis counter | multi-warehouse routing, 3PL sync              |
| **Cart**      | Live cart + items; recalculation                              | Redis (live) + PG event log    | saved carts, B2B quotes                        |
| **Checkout**  | Checkout session; orchestrates the purchase saga              | PG + Temporal                  | custom multi-step flows, A/B checkout          |
| **Orders**    | Order + items + immutable order events + snapshots + refunds  | PG `orders` (partitioned)      | returns, shipment aggregates                   |
| **Payments**  | Payment intent, charge, refund; one PSP                       | PG `orders` + vault            | multi-PSP routing, fraud engine                |
| **Identity**  | Customer, address, consent; staff auth via Ory                | PG `identity`                  | households, child profiles, ReBAC              |

---

## 2. Aggregate Design (Phase-1 scope — built on `@platform/domain`)

| Context       | Aggregate Root             | Entities                                 | Value Objects                                                                         | Domain Service                                    | Domain Events                                            |
| ------------- | -------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| **Catalog**   | `Product`, `Category`      | `Variant`                                | `Sku`, `Slug`, `Money`, `MediaRef`, `PublishState`                                    | —                                                 | `product.published`, `product.updated`                   |
| **Media**     | `Asset`                    | —                                        | `StorageKey`, `ContentType`                                                           | —                                                 | `media.asset_ready`                                      |
| **Pricing**   | `Coupon`, `DiscountRule`   | `Redemption`                             | `Money`, `Percentage`, `TaxRate`, `CouponCode`, `DateRange`                           | `PriceQuoteService`                               | `coupon.redeemed`                                        |
| **Inventory** | `StockItem`, `Reservation` | `MovementEntry` (append-only)            | `Quantity`, `WarehouseId`, `ReservationTtl`                                           | `ReservationPolicy`                               | `stock.reserved`, `stock.released`, `stock.low`          |
| **Cart**      | `Cart`                     | `CartItem`                               | `Quantity`, `Money`, `CartId`                                                         | —                                                 | `cart.checked_out` _(internal)_, `cart.abandoned`        |
| **Checkout**  | `CheckoutSession`          | —                                        | `CheckoutState`                                                                       | (orchestration is Temporal, not a domain service) | `checkout.completed`, `checkout.failed`                  |
| **Orders**    | `Order`                    | `OrderItem`, `OrderEvent` (append-only)  | `OrderNumber`, `Money`, `ProductSnapshot`, `AddressSnapshot`, `OrderStatus` (derived) | `RefundPolicy`                                    | `order.placed`, `order.paid`, `order.refunded`           |
| **Payments**  | `PaymentIntent`            | `Charge`, `Refund`                       | `Money`, `PspToken`, `PaymentStatus`                                                  | —                                                 | `payment.captured`, `payment.failed`, `payment.refunded` |
| **Identity**  | `Customer`                 | `Address`, `ConsentRecord` (append-only) | `Email`, `ConsentScope`                                                               | —                                                 | `customer.registered`, `consent.changed`                 |

**Shared kernel value objects added now** (rule of three already met by Catalog/Cart/Orders/Pricing/Identity):
`Money`, `Email`, `Address`, `Slug` → `@platform/domain` `shared/value-objects/`. Nothing
context-specific (e.g. `Sku`, `OrderNumber`) enters the kernel.

---

## 3. Repository Strategy

- **One repository interface per aggregate root**, declared in the context's `domain/`, extending the
  existing `@platform/repository` ports (`ReadRepository`/`WriteRepository`/`UnitOfWork`/
  `TransactionalUnitOfWork`/`CursorPage`). Implementations (Prisma) live in `infrastructure/`. **No new
  repository abstraction is invented.**
  - `ProductRepository`, `CategoryRepository`, `AssetRepository`, `CouponRepository`,
    `DiscountRuleRepository`, `StockItemRepository`, `ReservationRepository`, `CartRepository`,
    `CheckoutSessionRepository`, `OrderRepository`, `PaymentIntentRepository`, `CustomerRepository`.
- **Transaction boundary = one aggregate per transaction.** The repository `save()` and the **outbox
  insert** run in the _same_ DB transaction (`TransactionalUnitOfWork`). No second aggregate is written
  in the same transaction.
- **Cross-aggregate / cross-context effects** are never a second write — they are events (choreography)
  or the Temporal saga (orchestration, §8).
- **Optimistic concurrency** uses the `version` already on `AggregateRoot`: `save(aggregate,
expectedVersion)` does a conditional update; a mismatch raises the kernel `ConcurrencyError`
  (→ 409 / retry). Append-only aggregates (`OrderEvent`, `MovementEntry`, `ConsentRecord`) are
  insert-only; status is derived, never mutated.

---

## 4. Domain Events Strategy

- **Domain events** (`@platform/domain` `DomainEvent`, in-process) are raised inside aggregates and
  **pulled at the use-case boundary** (`pullDomainEvents()`), mapped to **integration events**, and
  written to the **outbox in the same transaction** as the state change.
- The **outbox → Debezium (CDC) → Redpanda** machinery + `@platform/domain-events` (versioned
  Avro/Protobuf contracts) + `@platform/outbox` arrive in **Sprint 0.6** — Phase-1 contexts simply
  produce events into the outbox table.
- **Topic naming** `<context>.<aggregate>.<event>.v1` (past tense), partitioned by aggregate id,
  additive-only, registry-enforced (Apicurio). Consumers are idempotent (keyed by the `eventId`
  already on `DomainEvent`), with retries + DLQ.
- **Emit only events with a real Phase-1 consumer:**

  | Event                               | Consumed by (Phase 1)                                        |
  | ----------------------------------- | ------------------------------------------------------------ |
  | `order.paid`                        | Inventory (decrement reserved), Notifications (confirmation) |
  | `stock.reserved` / `stock.released` | Checkout saga (compensation)                                 |
  | `payment.failed`                    | Checkout saga (compensation → release stock)                 |
  | `order.placed`                      | Notifications                                                |

  `cart.abandoned`, `consent.changed`, `product.published` are emitted (cheap; avoids a later breaking
  change) but their consumers (marketing, search) are **deferred**.

---

## 5. Service / Module Boundaries

- Each Phase-1 context is one module under **`services/<context>/`** — nine modules, one deployable
  (modular monolith), strict boundaries.
- **No service imports another service's source.** Cross-service coupling is allowed only through
  `@platform/domain-events` (async) and `@platform/api-clients` (sync, generated), each introduced
  **only when its first consumer exists** (§10).

---

## 6. Dependency Rules (enforced in CI; fitness functions land in Sprint 0.8)

1. `domain/` imports only `@platform/{domain,types,utils}` + kernel VOs. `application/ → domain` only.
   `infrastructure//interfaces/ → application + domain`. Never the reverse.
2. **No cross-context FK, join, or direct DB read** — references are bare `*_id`; reads via API;
   history via **snapshots** (Orders snapshots product/price/address).
3. No feature/service deep-imports another's internals — only its public entry /
   `@platform/domain-events` / `@platform/api-clients`.
4. The interfaces layer wires transport → use-cases; it holds no business logic.

---

## 7. Folder Structure (per `services/<context>/`)

```
services/<context>/
├── src/
│   ├── domain/          # aggregates, entities, value objects, domain events,
│   │                    #   repository INTERFACES, domain services  (pure)
│   ├── application/     # use-cases (one folder each) + outbound port interfaces + DTOs
│   ├── infrastructure/  # Prisma repo adapters, outbox writer, ACL translators, PSP/tax clients
│   ├── interfaces/      # GraphQL subgraph / gRPC handlers / event consumers
│   ├── config/
│   └── main.ts
├── prisma/schema.prisma # THIS context's schema only (no cross-context tables/FKs)
├── package.json  tsconfig.json  vitest.config.ts
```

Identical anatomy for all nine; scaffolded by `tooling/generators` once Sprint 0.8 lands.

---

## 8. Cross-Context Communication (Phase 1)

- **Synchronous (gRPC, generated client):** `Cart`/`Checkout` read `Pricing` (price quote, p99 ≤ 100ms),
  `Inventory` (stock check), `Catalog` (product/variant). Rule: ≤ 2 hops, never inside a transaction.
- **Purchase saga (Temporal — the one justified orchestration):** `Checkout` orchestrates → final price
  (`Pricing`) → reserve (`Inventory`) → charge (`Payments`) → create order (`Orders`), with
  **compensation** (release the reservation on `payment.failed`). The only ≥3-context + rollback flow in
  Phase 1; everything else is event choreography.
- **Snapshots over live references:** `Orders` copies product/price/address at purchase time — the
  order's "Product" is its own VO, never a live Catalog reference.
- **Async reactions** (via outbox/events, Sprint 0.6+): inventory decrement on `order.paid`;
  confirmation on `order.placed`.

---

## 9. Future Extension Points (pointers only — NOT designed now)

Each attaches via a port / middleware / event **without modifying Phase-1 modules**. We reserve the
seam; we do not build it. All remain governed by the architecture contract (doc 03); activating any is a
future sprint (and an ADR only if it then changes a frozen invariant).

- **Multi-tenant SaaS** — future `tenant_id` column + Postgres RLS; single implicit tenant today.
- **AI (LLM / Embedding / Vector / Prompt / Agents)** — future outbound ports in `@platform/contracts`
  - infra adapters (pgvector already chosen); hosted in Recommendations/Search later.
    **Child / un-consented data must never reach AI** (constraint reserved, not built).
- **Platform billing / subscription plans** — future `Billing` context with entitlements as feature
  flags/quotas. (Distinct from _customer_ product-subscriptions, a Phase-4 commerce module.)
- **Plugin SDK, Workflow engine, Rule engine, Agent framework** — Phase 4; compose lower layers via
  events/ports.
- **Data-plane / growth contexts** (Tracking, Attribution, Analytics, Search, Recommendations,
  Marketing, Feed, Reviews, Loyalty, full Notifications) — Phases 2–4. Phase-1 contexts only **emit**
  the events these will later consume, so no rework is needed when they arrive.

---

## 10. Just-in-Time Shared Packages (introduced only when first consumed)

| Package                                       | Introduced in              | Reason                                                              |
| --------------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| `@platform/domain-events`                     | Sprint 0.6                 | Versioned integration-event contracts (the async coupling surface). |
| `@platform/outbox`                            | Sprint 0.6                 | Outbox writer + relay for exactly-once DB↔broker.                   |
| `@platform/feature-flags`                     | Sprint 0.7                 | Flag SDK (deploy ≠ release; kill switch).                           |
| `@platform/api-clients`                       | first gRPC call (~1.2/1.3) | Generated typed sync clients (the sync coupling surface).           |
| Kernel VOs (`Money`/`Email`/`Address`/`Slug`) | first context sprint (1.1) | Rule of three already met; added to `@platform/domain`.             |

No other new package, port, or abstraction is planned for Phase 1.

---

## 11. Next sprints (per the roadmap — for orientation only; not started here)

Finish Phase 0 → build Phase 1: **0.6** event backbone → **0.7** auth + cross-cutting seams (audit,
flags, tenancy seam) → **0.8** fitness functions + generators + walking skeleton → **1.1** Catalog+Media
→ **1.2** Pricing+Inventory → **1.3** Cart → **1.4** Checkout+Orders+Payments (saga) → **1.5**
Identity+Consent → **1.6** admin wiring (frozen UI). Detail in
[IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

---

**Sprint 0.5 design is documented. Stopping — awaiting approval before starting Sprint 0.6.**
No code, no packages, no ADRs, no source modified.
