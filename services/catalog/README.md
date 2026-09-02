# @platform/catalog

## Purpose

The **Catalog** bounded context (Phase 1 Commerce Core): products, variants, and categories.
Owns its data; references Media assets only by bare id (`MediaRef`) — no cross-context import.

## Architecture (clean-architecture slice)

- **domain/** — `Product` (raises `product.published` / `product.updated`), `Variant` (entity),
  `Category`; value objects `Sku`, `Slug`, `Money`, `PublishState`, `MediaRef`; repository ports.
  Pure (`@platform/domain` only). `Money`/`Slug` are context-local pending rule-of-three promotion.
- **application/** — `CreateProduct`, `PublishProduct`, `UpdateProduct`, `CreateCategory`
  (`@platform/application` `UseCase`). Depend on domain + ports only; VO validation returns `Result`,
  aggregate invariant violations throw `DomainError`s caught into the `Result` channel.
- **infrastructure/** — in-memory repositories (write the **outbox** on save via `@platform/messaging`),
  `InMemoryUnitOfWork`, `CatalogEventTranslator` (domain → integration events `catalog.product.*`).
- **interfaces/** — framework-agnostic controllers + `present()` (maps `Result` → status + error
  envelope; **no HTTP server**).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## Dependencies

`@platform/{domain, application, contracts, repository, messaging, domain-events, types, utils}`.
Dependency direction enforced by `pnpm arch`.

## Extension points

Replace in-memory repositories/unit-of-work with Prisma (outbox inside the DB transaction); add a
real transport adapter at the controllers; the gRPC read API (price/stock for Cart) arrives with
later contexts. Promote `Money`/`Slug` to the shared kernel when a second context needs them.
