# Sprint 1.3 — Commerce Core: Cart — Implementation Report

> **Date:** 2026-06-30 · **Status:** ✅ COMPLETE (all gates green) · **Phase 1 — Commerce Core.**

## 1. Summary

One business bounded context: **`@platform/cart`** — a customer's live cart with line management,
quantity merging, single-currency totals, and the checkout/abandonment lifecycle. An independent
Clean-Architecture slice (domain → application → infrastructure → interfaces) built on the existing
kernel, contracts, messaging, and repository ports — **extending**, never replacing. Persistence +
messaging use the **in-memory adapters** (Redis/Prisma deferred — no Docker); domain events flow
through the transactional outbox to an in-memory publisher, fully tested. No cross-context imports:
Cart references Catalog products by bare id (`ProductRef`) and the customer/session by bare
reference, and carries a **caller-supplied unit-price snapshot** rather than calling Pricing.

## 2. Implemented components

### `@platform/cart`

- **Domain:** `Cart` (aggregate; single-currency invariant; raises `cart.checked_out` /
  `cart.abandoned`; computes totals), `CartItem` (entity; unit-price snapshot, `lineTotal`,
  quantity merge/replace); value objects `Money` (non-negative, with `times`/`plus`), `Quantity`
  (positive, with `add`), `ProductRef`; `CartRepository` port.
- **Application:** `CreateCart`, `AddItem`, `RemoveItem`, `ChangeItemQuantity`, `CheckOutCart`,
  `AbandonCart` (`@platform/application` `UseCase`). VO validation returns `Result`; aggregate
  invariants throw `DomainError` caught into the `Result` channel.
- **Infrastructure:** in-memory repository (writes the outbox on save), `InMemoryUnitOfWork`,
  `CartEventTranslator` (→ `cart.cart.checked_out.v1` / `cart.cart.abandoned.v1`).
- **Interfaces:** `CartController` (create/add/remove/changeQuantity/checkOut/abandon) + `present()`
  (framework-agnostic; no HTTP server).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## 3. Files created (28)

- **Config (4):** `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`.
- **`src` (3):** `index.ts`, `composition.ts`, `cart.e2e.test.ts`.
- **`src/domain/value-objects` (4):** `money.ts`, `quantity.ts`, `product-ref.ts`,
  `value-objects.test.ts`.
- **`src/domain` (4):** `cart-item.ts`, `cart.ts`, `cart-repository.ts`, `cart.test.ts`.
- **`src/domain/events` (2):** `cart-checked-out.event.ts`, `cart-abandoned.event.ts`.
- **`src/application` (6):** `create-cart`, `add-item`, `remove-item`, `change-item-quantity`,
  `check-out-cart`, `abandon-cart` (`.use-case.ts`).
- **`src/infrastructure` (3):** `in-memory-unit-of-work.ts`, `cart-event-translator.ts`,
  `in-memory-cart-repository.ts`.
- **`src/interfaces` (2):** `presenter.ts`, `cart.controller.ts`.
- Plus `docs/implementation/SPRINT_1_3_REPORT.md`.

## 4. Files modified

- Docs only: `PROJECT_STATE.md`, `AI_CONTEXT.md`, `DECISIONS.md` (append D-028),
  `docs/development/WORKSPACE_GUIDE.md`; `pnpm-lock.yaml` (workspace link). **No existing source
  package or service modified.**

## 5. Validation results

| Gate                             | Result                              |
| -------------------------------- | ----------------------------------- |
| `pnpm install --frozen-lockfile` | ✅ PASS                             |
| `pnpm lint`                      | ✅ PASS                             |
| `pnpm typecheck`                 | ✅ PASS                             |
| `pnpm test` (serialized)         | ✅ PASS — 29 task                   |
| `pnpm build`                     | ✅ PASS                             |
| `pnpm arch`                      | ✅ PASS — 295 modules, 0 violations |

One fix during validation: two e2e assertions referenced the **domain** event name; corrected to the
**integration** type the outbox delivers (`cart.cart.checked_out` / `cart.cart.abandoned`). No source
change.

## 6. Test counts

- `@platform/cart`: **16** — value objects 4, `Cart` aggregate 6, end-to-end 6.
- Repo total unchanged elsewhere; the Cart suite is additive.

## 7. Architecture notes / decisions (see DECISIONS D-028)

- **Caller-supplied price snapshot** — `AddItem` takes `unitPriceAmountMinor` + `currency`; Cart
  stores the snapshot on the line and never imports/calls Pricing. The live Pricing-quote lookup
  arrives with the gRPC read clients (deferred).
- **`cart.checked_out` is the checkout signal** — published via the outbox; the Sprint 1.4 checkout
  saga consumes it (and is responsible for stock reservation against Inventory). Cart does not call
  Inventory; stock is not validated at add/checkout in 1.3.
- **`cart.abandoned`** is emitted now (consumer — marketing/recovery — deferred), consistent with the
  prior contexts emitting events ahead of consumers.
- **Single-currency cart invariant** — adding a line whose currency differs from the cart's throws
  `BusinessRuleError`; `Money.plus` enforces the same at the VO level.
- **No `CartId` VO** — the aggregate id is `UniqueEntityId` (matching catalog/pricing/inventory); a
  branded `CartId` would duplicate it (YAGNI). The 0.5 design's "CartId" is satisfied by the id.
- **Consistent with D-026/D-027** — VO factories → `Result`; aggregate invariants throw → `Result`;
  framework-agnostic controllers + `present()`; in-memory persistence + outbox-on-save.

## 8. Trade-offs

- In-memory repository: no real ACID/durability — the outbox-on-save pattern swaps to Redis +
  Postgres without touching domain/application.
- The price snapshot can go stale (price changes after add); refreshing it on read/checkout is a
  deferred Pricing-client concern, deliberately out of scope for 1.3.
- `present()` / `InMemoryUnitOfWork` duplicated per context (interface/infra independence).

## 9. Technical debt

- **Rule of Three reached but not yet actioned:** `Money` now lives in **3** contexts
  (Catalog, Pricing, Cart) and `ProductRef` in **3** (Pricing, Inventory, Cart). Promotion to the
  shared kernel is the correct next move **but requires migrating the committed Catalog/Pricing/
  Inventory contexts** — out of scope here (the prompt forbids refactoring previous sprints unless
  required to complete Cart, and it is not required). The three `Money` copies also differ (Cart's
  has arithmetic), so promotion is a deliberate reconciliation, not a mechanical move. **Recommended
  as a dedicated refactor (see "Deferred work").**
- `present()` / `InMemoryUnitOfWork` duplication across the five Phase-1 contexts (intentional).

## 10. Deferred work

- **`MoneyKernelPromotion` refactor** (recommended next housekeeping task): introduce a kernel
  `Money` (+ `ProductRef`/`EntityRef`) in `@platform/domain`, reconcile semantics, and migrate
  Catalog/Pricing/Inventory/Cart in one focused PR with arch + tests green.
- Redis live-cart store + Postgres event log (outbox in the DB transaction).
- Pricing gRPC quote client (price refresh on add/checkout); reservation call in the checkout saga.
- Cart TTL/abandonment scheduler; `cart.abandoned` marketing consumer.
- Redpanda/Debezium broker wiring; HTTP transport.

## 11. Ready for Sprint 1.4?

**Yes.** Cart publishes `cart.checked_out` — the trigger the **Sprint 1.4 — Checkout + Orders +
Payments (saga)** work consumes. No blockers introduced; baseline remains green.

## 12. Git

Not committed/pushed (per instructions). Working tree contains only the Cart slice + the doc
updates. Recommended Conventional Commit message:

```
feat(cart): phase 1 cart context (Sprint 1.3)
```

**Sprint 1.3 is complete. Stopping — not beginning Sprint 1.4.**
