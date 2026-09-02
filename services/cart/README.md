# @platform/cart

## Purpose

The **Cart** bounded context (Phase 1 Commerce Core): a customer's live cart — lines, quantity
merging, totals, and the checkout/abandonment lifecycle. Owns its data; references Catalog products
only by bare id (`ProductRef`) and the customer/session by bare reference — no cross-context import.

## Architecture (clean-architecture slice)

- **domain/** — `Cart` (aggregate; single-currency invariant; raises `cart.checked_out` /
  `cart.abandoned`), `CartItem` (entity; carries a unit-price snapshot, computes `lineTotal`); value
  objects `Money` (with `times`/`plus`), `Quantity`, `ProductRef`; `CartRepository` port. Pure
  (`@platform/domain` only).
- **application/** — `CreateCart`, `AddItem`, `RemoveItem`, `ChangeItemQuantity`, `CheckOutCart`,
  `AbandonCart` (`@platform/application` `UseCase`). VO validation returns `Result`; aggregate
  invariants throw `DomainError` caught into the `Result` channel.
- **infrastructure/** — in-memory repository (writes the outbox on save), `InMemoryUnitOfWork`,
  `CartEventTranslator` (→ `cart.cart.checked_out.v1` / `cart.cart.abandoned.v1`).
- **interfaces/** — `CartController` (framework-agnostic) + `present()` (no HTTP server).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## Cross-context integration

Cart never imports Pricing/Inventory/Catalog. The **unit price is a snapshot** supplied by the
caller when adding a line (sourced from Pricing's quote API once the gRPC read clients are wired).
Stock validation is the **checkout saga's** responsibility (Sprint 1.4), driven by the published
`cart.checked_out` event — Cart does not call Inventory.

## Dependencies

`@platform/{domain, application, contracts, repository, messaging, domain-events, types, utils}`.
Dependency direction enforced by `pnpm arch`.

## Extension points

Replace the in-memory repository with Redis (live cart) + a Postgres event log (outbox inside the
DB transaction); add the reservation-on-checkout call and the price-refresh-on-add via the Pricing
gRPC client; a TTL/abandonment scheduler emits `cart.abandoned`. `Money`/`ProductRef` kernel
promotion is deferred (see DECISIONS D-028).
