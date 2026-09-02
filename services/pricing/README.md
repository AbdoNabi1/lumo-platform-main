# @platform/pricing

## Purpose

The **Pricing** bounded context (Phase 1 Commerce Core): price lists and prices. Owns its data;
references Catalog products only by bare id (`ProductRef`) — no cross-context import.

## Architecture (clean-architecture slice)

- **domain/** — `Price` (aggregate; emits `price.changed`), `PriceList` (aggregate; draft → active);
  value objects `Currency`, `Money`, `ProductRef`; repository ports. Pure (`@platform/domain` only).
  `Money` is **context-local** — now present in two contexts (Catalog, Pricing); promote to the
  shared kernel only at the third (rule of three).
- **application/** — `CreatePriceList`, `ActivatePriceList`, `CreatePrice`, `ChangePrice`
  (`@platform/application` `UseCase`). VO validation returns `Result`; aggregate invariants throw
  `DomainError` caught into the `Result` channel.
- **infrastructure/** — in-memory repositories (write the outbox on save), `InMemoryUnitOfWork`,
  `PricingEventTranslator` (→ `pricing.price.changed.v1`).
- **interfaces/** — `PriceController` / `PriceListController` (framework-agnostic) + `present()`
  (no HTTP server).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## Dependencies

`@platform/{domain, application, contracts, repository, messaging, domain-events, types, utils}`.
Dependency direction enforced by `pnpm arch`.

## Extension points

Replace in-memory repositories/unit-of-work with Prisma (outbox inside the DB transaction); add the
price-quote gRPC read API consumed by Cart/Checkout; tax categories/rates and discounts/coupons are
later scope. Promote `Money` to the shared kernel when a third context needs it.
