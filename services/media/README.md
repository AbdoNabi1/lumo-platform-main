# @platform/media

## Purpose

The **Media** bounded context (Phase 1 Commerce Core, thin slice): asset **metadata** only (the
binary lives in object storage). Catalog references assets by bare id (`MediaRef`) — no shared DB.

## Architecture (clean-architecture slice)

- **domain/** — `Asset` (raises `media.asset_ready`); value objects `StorageKey`, `ContentType`;
  `AssetRepository` port. Pure (`@platform/domain` only).
- **application/** — `RegisterAsset` use-case (`@platform/application` `UseCase`); VO validation
  returns `Result`.
- **infrastructure/** — in-memory `AssetRepository` (writes the outbox on save), `InMemoryUnitOfWork`,
  `MediaEventTranslator` (→ integration event `media.asset.ready`).
- **interfaces/** — framework-agnostic `AssetController` + `present()` (no HTTP server).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## Dependencies

`@platform/{domain, application, contracts, repository, messaging, domain-events, types, utils}`.
Dependency direction enforced by `pnpm arch`.

## Extension points

Replace in-memory persistence with Prisma + S3/MinIO (`@platform/storage`) for real assets and
signed URLs; add derivative generation and a transport adapter. All deferred (Phase 1+, needs infra).
