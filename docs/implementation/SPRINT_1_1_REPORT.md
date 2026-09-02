# Sprint 1.1 — Commerce Core: Catalog + Media — Implementation Report

> **Date:** 2026-06-30 · **Status:** ✅ COMPLETE (all gates green) · **Phase 1 — Commerce Core.**

## 1. Summary

The first two business bounded contexts: **`@platform/catalog`** (products, variants, categories)
and **`@platform/media`** (asset metadata). Each is an independent Clean-Architecture slice
(domain → application → infrastructure → interfaces) built on the existing kernel, contracts,
messaging, and repository ports — **extending**, never replacing. Persistence and messaging use the
**in-memory adapters** (Prisma + broker deferred, consistent with 0.6/0.8 — no Docker host); domain
events flow through the transactional outbox to in-memory publisher/consumer, fully tested. No
cross-context imports: Catalog references Media assets by bare id (`MediaRef`).

## 2. Implemented components

### `@platform/catalog`

- **Domain:** `Product` (aggregate; emits `product.published`, `product.updated`), `Variant`
  (entity), `Category` (aggregate); value objects `Sku`, `Slug`, `Money`, `PublishState`,
  `MediaRef`; `ProductRepository` / `CategoryRepository` ports.
- **Application:** `CreateProduct`, `PublishProduct`, `UpdateProduct`, `CreateCategory`
  (`@platform/application` `UseCase`).
- **Infrastructure:** in-memory repositories (write the outbox on save), `InMemoryUnitOfWork`,
  `CatalogEventTranslator` (→ `catalog.product.published.v1`, `catalog.product.updated.v1`).
- **Interfaces:** `ProductController` / `CategoryController` (framework-agnostic) + `present()`
  (Result → status + uniform error envelope). Composition root wires the slice in-process.

### `@platform/media`

- **Domain:** `Asset` (aggregate; emits `media.asset_ready`); value objects `StorageKey`,
  `ContentType`; `AssetRepository` port.
- **Application:** `RegisterAsset`. **Infrastructure:** in-memory repository + outbox, UoW,
  `MediaEventTranslator` (→ `media.asset.ready.v1`). **Interfaces:** `AssetController` + `present()`.

## 3. Files created

- **`services/catalog`** (32): config (`package.json`, `tsconfig.json`, `vitest.config.ts`,
  `README.md`), `src/{index,composition,catalog.e2e.test}.ts`;
  `src/domain/value-objects/{sku,slug,money,publish-state,media-ref,value-objects.test}.ts`;
  `src/domain/{variant,product,category,product-repository,category-repository,product.test}.ts`;
  `src/domain/events/{product-published.event,product-updated.event}.ts`;
  `src/application/{create-product,publish-product,update-product,create-category}.use-case.ts`;
  `src/infrastructure/{in-memory-unit-of-work,catalog-event-translator,in-memory-product-repository,in-memory-category-repository}.ts`;
  `src/interfaces/{presenter,product.controller,category.controller}.ts`.
- **`services/media`** (19): config (4); `src/{index,composition,media.e2e.test}.ts`;
  `src/domain/value-objects/{storage-key,content-type}.ts`;
  `src/domain/{asset,asset-repository,asset.test}.ts`; `src/domain/events/media-asset-ready.event.ts`;
  `src/application/register-asset.use-case.ts`;
  `src/infrastructure/{in-memory-unit-of-work,media-event-translator,in-memory-asset-repository}.ts`;
  `src/interfaces/{presenter,asset.controller}.ts`.
- `docs/implementation/SPRINT_1_1_REPORT.md`.

## 4. Files modified

- Docs only: `PROJECT_STATE.md`, `AI_CONTEXT.md`, `DECISIONS.md` (append D-026),
  `docs/development/WORKSPACE_GUIDE.md`; `pnpm-lock.yaml` (workspace link). **No existing source
  package or service modified** (extend, don't replace).

## 5. Validation results

| Gate             | Result                                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| `pnpm lint`      | ✅ PASS                                                                     |
| `pnpm typecheck` | ✅ PASS                                                                     |
| `pnpm test`      | ✅ PASS (serialized, 26 task) — `@platform/catalog` 12, `@platform/media` 3 |
| `pnpm build`     | ✅ PASS                                                                     |
| `pnpm arch`      | ✅ PASS — 231 modules, 0 violations                                         |

One lint fix during validation: `ValidationError` was type-only in the Guard-based VOs (`Sku`,
`MediaRef`, `StorageKey`) → switched to `type` import. `arch` confirms domain purity, no
cross-context imports, and the dependency direction across both contexts.

## 6. Design decisions (see DECISIONS D-026)

- **VO factories return `Result`** for expected input validation (reusing `Guard`); aggregate
  **invariant violations throw `DomainError`** (e.g. publish-twice, no-variant), caught by the
  use-case into the `Result` error channel (matching `UseCase` semantics).
- **Context-local value objects** — `Money`/`Slug` live in Catalog (not the shared kernel) until a
  second context needs them (rule of three); avoids speculative kernel coupling.
- **Cross-context referencing by id** — `MediaRef` holds a bare asset id; Catalog never imports
  Media (no FK, no source dependency).
- **Framework-agnostic interfaces** — controllers + `present()` map `Result` → `{ status, body }`
  via the uniform error envelope; no HTTP server (transport adapter is later).
- **In-memory persistence + outbox** — same posture as the walking skeleton; Prisma/broker deferred.

## 7. Trade-offs

- In-memory repositories mean no real ACID / cross-process durability yet — the outbox-on-save
  pattern is proven in-process and swaps to Prisma without touching domain/application.
- `present()` is duplicated per context (interface independence); promote to a shared interfaces-kit
  when real HTTP transport lands.
- Catalog is intentionally shallow (no bundles/collections/cross-sell/search; per the 0.5 scope).

## 8. Technical debt

- Minor `present()` duplication across `services/catalog` and `services/media` (intentional for now).
- The two in-memory `InMemoryUnitOfWork` copies are trivial and context-owned (correct under DDD).

## 9. Deferred items

Prisma persistence + per-context Postgres schemas; real object storage (S3/MinIO) + signed URLs +
derivatives for Media; Redpanda/Debezium broker wiring; HTTP/GraphQL transport; the gRPC read API
(price/stock) consumed by Cart; bundles/collections/cross-sell/search (Catalog); promotion of
`Money`/`Slug` to the shared kernel.

## 10. Remaining work

None for Sprint 1.1. Next (per the roadmap): **Sprint 1.2 — Pricing + Inventory**.

**Sprint 1.1 is complete. Stopping — not beginning Sprint 1.2.**
