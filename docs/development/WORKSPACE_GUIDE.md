# Workspace guide

A Turborepo + pnpm monorepo. Workspaces are globbed in `pnpm-workspace.yaml`: `apps/*`,
`packages/*`, `services/*`.

## Apps

| App          | Stack                                     | Notes                                                                                                                                                                       |
| ------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storefront` | Next.js 15 + React 19 + Tailwind v4       | Foundation shell (no business pages yet)                                                                                                                                    |
| `admin`      | Framework-agnostic TS (`@platform/admin`) | Sprint 1.6 admin **wiring**: facade controllers binding the admin screens to Catalog/Inventory/Orders/Identity/Pricing (pure delegation, no HTTP). Backend only — no React. |
| `admin-web`  | Next.js + React                           | The admin's visual surface: the **Lumo Dashboard**, built entirely from `@platform/ui` on Lumo Design System tokens.                                                        |

> `apps/` is the **composition seam**: unlike `services/` (a context may not import another context —
> `no-cross-service-internals`), an app may import several contexts' public `@platform/*` APIs. That is
> why the admin cross-context wiring lives in `apps/admin`, not in a service.
>
> The admin React + Vite front-end (per `docs/architecture/01`) that consumes this wiring over a
> transport adapter is a later-phase concern; the UI follows the Lumo Design System (`docs/ui/`).

## Services

Backend bounded-context services live under `services/<context>/` as a Clean-Architecture slice
(`domain/ application/ infrastructure/ interfaces/`). `services/example` is the **non-business
walking-skeleton reference** (proving domain → application → repository → outbox → messaging end to
end). **Phase 1 contexts:** `services/catalog` (products/variants/categories), `services/media`
(asset metadata), `services/pricing` (price lists/prices), `services/inventory` (stock levels/
reservations), `services/cart` (live carts/items), `services/orders` (placed orders + refunds),
`services/payments` (payment intents + charges/refunds), `services/checkout` (checkout session), and
`services/identity` (customers/addresses/consent) — **all 9 Phase-1 contexts**, currently with
in-memory persistence + outbox (Prisma, real object storage, and transport adapters are deferred). Contexts never import each other's source; they reference each other by bare id (e.g.
Catalog's `MediaRef`, the shared-kernel `ProductRef`) and carried snapshots (Cart's caller-supplied
unit price, Orders' `ProductSnapshot`/`AddressSnapshot`), and, later, via events/generated clients.
Shared value objects (`Money`, `ProductRef`) live in `@platform/domain` once they reach the rule of
three. Scaffold new services with `pnpm gen service`.

## Shared packages

Grouped by Clean Architecture layer (lower layers never depend on higher ones).

### Kernel (framework-free; usable by any layer)

| Package           | Responsibility                                                             |
| ----------------- | -------------------------------------------------------------------------- |
| `@platform/types` | Generic utility types + `Result`/`Either` helpers.                         |
| `@platform/utils` | Structured logger, `AppError`, domain error hierarchy, API error envelope. |

### Domain (pure; depends only on the kernel)

| Package            | Responsibility                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@platform/domain` | Shared-kernel DDD building blocks: Entity, AggregateRoot, ValueObject, UniqueEntityId, DomainEvent, Guard, Specification, DomainService. No id/clock generation. |

### Contracts (outbound port interfaces; no runtime dependencies)

| Package                | Responsibility                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@platform/contracts`  | Cross-cutting outbound port interfaces: `IdGenerator`, `Clock`. Interfaces only — no implementations, DI, or deps. |
| `@platform/repository` | Persistence ports (repository + unit-of-work interfaces). Implementations live in infrastructure.                  |

> DI tokens for these ports (`ID_GENERATOR`, `CLOCK`) live in `@platform/application`. Infrastructure
> adapters depend only on the contract package, never on `@platform/application`
> ([ADR-0002](../architecture/adr/0002-outbound-ports-in-contracts-package.md)).

### Application layer (no infrastructure dependencies)

| Package                 | Responsibility                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `@platform/application` | DI container, CQRS command/query buses, use-case + handler contracts, middleware pipeline; owns the `ID_GENERATOR`/`CLOCK` DI tokens. |
| `@platform/config`      | Typed env + server config (environment inheritance) + feature-flag infrastructure.                                                    |
| `@platform/tracking`    | Shared tracking event-envelope **types** — no events/logic.                                                                           |

### Infrastructure (adapters; depend on ports/kernel)

| Package                   | Responsibility                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@platform/db`            | PostgreSQL + Prisma: client, transactions, health, seed, backup config, Prisma repository adapter foundation.          |
| `@platform/redis`         | ioredis connection, cache abstraction, serialization, health.                                                          |
| `@platform/clickhouse`    | ClickHouse client, connection, health.                                                                                 |
| `@platform/storage`       | S3/MinIO signed-URL storage abstraction, bucket config, health.                                                        |
| `@platform/secrets`       | Secret loader (env + Docker file; Vault-ready).                                                                        |
| `@platform/observability` | OpenTelemetry tracing/metrics + logging + error reporting.                                                             |
| `@platform/health`        | Health-check contract + aggregator.                                                                                    |
| `@platform/id`            | `CryptoIdGenerator` — implements the `IdGenerator` port (`@platform/contracts`) with UUIDv7 (RFC 9562, `node:crypto`). |
| `@platform/clock`         | `SystemClock` — implements the `Clock` port (`@platform/contracts`).                                                   |

### UI + build config

| Package                                                                        | Responsibility                                                                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `@platform/ui`                                                                 | shadcn/ui base primitives, theme provider, `cn`. No business components.                                       |
| `@platform/design`                                                             | **Lumo Design System** tokens — primitives, semantic layer, Tailwind bridge (`docs/ui/LUMO_DESIGN_SYSTEM.md`). |
| `@platform/eslint-config` · `@platform/tsconfig` · `@platform/prettier-config` | Shared ESLint / TypeScript / Prettier configs.                                                                 |

## Dependency rules (enforced in CI via `pnpm arch` — dependency-cruiser)

- Packages never import from `apps/` or `services/`.
- Apps/services import packages; never each other's internals (a service may not import another service's `src`).
- **Domain (`@platform/domain` and `services/*/src/domain`) depends only on the kernel** (`@platform/types`, `@platform/utils`) + `@platform/domain` — no infrastructure, frameworks, messaging, or id/clock generation.
- **Application never imports `@platform/messaging` or infrastructure** — it depends on domain + ports only; **messaging never imports application or infrastructure**. Dependencies point inward (docs/architecture/02; ADR-0002).
- **Import packages via their public entry** — `@platform/<pkg>` (or a declared subpath like `/testing`), **never a deep `@platform/<pkg>/src/*` path**.
- Cross-package types resolve via workspace symlinks (`exports` → `src/index.ts`); apps compile
  package source via Next `transpilePackages`.
- **`pnpm arch`** (`.dependency-cruiser.cjs`) enforces all of the above + **no circular dependencies** (runtime cycles), and is gated in CI.

## Generators (`pnpm gen`)

Scaffold consistently (never hand-roll); generated code passes lint/typecheck/test/arch on creation:

```bash
pnpm gen package     # a shared @platform/* package (README + vitest + sample test)
pnpm gen service     # a bounded-context service under services/ (clean-architecture slice)
pnpm gen aggregate   # a domain aggregate + repository port (+ test) inside a service
pnpm gen use-case    # an application use-case (+ test) inside a service
pnpm install         # link any new workspace package
```

`services/example` is the canonical reference output. Templates live in `turbo/generators/`.

## Versioning

Shared packages use [changesets](https://github.com/changesets/changesets) (`pnpm changeset`).
Apps (e.g. `storefront`) are private and excluded.

## Turborepo tasks

Defined in `turbo.json`: `build`, `lint`, `typecheck`, `test`, `dev`, `clean`. Builds are cached
and parallelized; `dev` is persistent and uncached. Architecture fitness runs via the root
`pnpm arch` script (dependency-cruiser), gated in CI alongside lint/typecheck/build/test.

## Prisma workflow (Sprint 2.2)

- Schemas: packages/db/prisma/schema/ (one file per context; conventions in main.prisma; strategy in packages/db/prisma/MIGRATIONS.md).
- After schema edits: pnpm --filter @platform/db db:generate; regenerate the init migration ONLY while it is undeployed.
- New repository? Copy the Orders reference (services/orders/src/infrastructure/) and keep the D-042 shape; integration tests gate on DATABASE_URL_TEST.

## Infrastructure workflow (Sprint 2.2.5)

- Stack: `docker compose -f infrastructure/docker/docker-compose.yml up -d`; endpoints + first-boot sequence in infrastructure/docker/README.md.
- Topics: bootstrap is idempotent (`redpanda-topics` service); new events add their topic + `.retry`/`.dlq` to `infrastructure/docker/redpanda/bootstrap-topics.sh` in the same change as the doc-20 row (ADR-0004).
- Telemetry: apps will send OTLP to `localhost:4318` — never to a vendor directly.

## Redis workflow (Sprint 2.3)

- Need caching in a context? Decorate its repository like `services/cart/src/infrastructure/cached-cart-repository.ts` (read-through, delete-on-write, tx-bypass, mapper-DTO values, tenant-prefixed keys).
- Redis integration tests gate on `REDIS_URL_TEST` (see first-boot runbook).

## Storage workflow (Sprint 2.4)

- Never hand-build object keys — use `StorageKeyFactory` (packages/storage). New object kinds add a `StorageNamespace` in contracts + a row in `resolveBucket`.
- Storage integration tests gate on `STORAGE_TEST_BUCKET`/`S3_ENDPOINT`/AWS creds (first-boot runbook).

## Broker workflow (Sprint 2.5)

- New consumer: EventHandler in the consuming context''s `interfaces/` calling a use case; wire a `KafkaConsumerRuntime` + register with the `ConsumerSupervisor` (worker entrypoint, transport sprint). Pin idempotent/retry/anomaly semantics with unit tests like `payment-captured.consumer.test.ts`.
- Kafka integration tests gate on `KAFKA_BROKERS_TEST` (first-boot runbook).

## Transport workflow (Sprint 2.6)

- New endpoint: add a `defineRoute` in the app's `http/` module (zod schema + `"<module>:<action>"` permission + version) delegating to an existing controller; test with `app.inject` (no Docker needed).
- New gRPC surface: add a versioned proto under `packages/grpc/protos/lumo/<ctx>/v<n>/`.

## Auth workflow (Sprint 2.7)

- Production composition: inject `JwtVerifier` (API tokens) or `KratosSessionAuthenticator` (sessions) as the transport authenticator, and `new CachedAccessControl(new KetoAccessControl(...), cache)` where `AllowAllAccessControl` sits today.
- Contract tests use injectable fetch — no Docker needed; live Ory checks join the first-boot runbook (Kratos/Keto containers added to compose in the first live session).

## Saga workflow (Sprint 2.8)

- Changing the purchase flow = ADR-0012 change first, then the deterministic core + its tests (the step-log tests pin compensation order), then the thin workflow adapter (version with `patched()`).

## Runtime workflow (Sprint 2.9)

- Run locally (after first-boot runbook): `pnpm --filter @platform/runtime start:api|start:worker|start:scheduler`. New consumers register in worker.ts via the supervisor; new jobs implement `ScheduledJob` (idempotent!) in scheduler.ts; new config keys go ONLY in config.ts.
