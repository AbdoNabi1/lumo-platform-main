# Sprint 0.3 — Application-Layer Foundation — Implementation Report

> **Date:** 2026-06-28 · **Status:** ✅ COMPLETE (all validation green) · **Phase 0 — Foundations.**

## 1. Executive summary

Sprint 0.3 delivers the reusable **application-layer foundation** every future microservice will
build on: a dependency-injection container, CQRS command/query buses, base Command/Query/Handler
and UseCase contracts, application middleware contracts + pipeline, enriched repository ports, a
Prisma repository adapter foundation, a domain error hierarchy, and Result/Either helpers. It is
**framework-free** and **infrastructure-free** by design, preserving Clean Architecture boundaries.
No business domain, authentication, or messaging was implemented (explicitly out of scope). All
four gates pass: **lint, typecheck, test, build**. No database changes or migrations were required.

## 2. Sprint objective

Implement only the application foundation: DI container · CQRS command bus · CQRS query bus · base
Command/Query contracts · handler abstractions · base UseCase abstraction · repository interfaces ·
Prisma repository adapter foundation · domain error hierarchy · shared Result/Either types ·
application middleware contracts · proper folder structure · full tests · documentation updates.
Forbidden and excluded: business domain, authentication, Kafka/messaging.

## 3. Packages modified

| Package                | Change (additive, backward-compatible)                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@platform/types`      | Added `Result`/`Either` helpers (`ok`,`err`,`isOk`,`isErr`,`map`,`mapError`,`match`,`unwrapOr`) + `Either` alias; built on the existing `Result` type (not duplicated). Added Vitest + tests.                                                                                |
| `@platform/utils`      | Added the domain error hierarchy (`DomainError`→`ValidationError`/`NotFoundError`/`ConflictError`/`ConcurrencyError`/`BusinessRuleError`/`UnexpectedError`) extending the existing `AppError`, plus `toErrorEnvelope` (docs/architecture/04 envelope). Added Vitest + tests. |
| `@platform/repository` | Extended additively with `ReadRepository`, `WriteRepository`, `CursorPage`, `TransactionalUnitOfWork<TContext>`. Existing `Repository`/`UnitOfWork` unchanged. Added `@platform/types` dependency.                                                                           |
| `@platform/db`         | Added the Prisma repository adapter foundation (`PrismaRepository` abstract base, `PrismaUnitOfWork`) implementing the `@platform/repository` ports. Added `@platform/repository` dependency. **No schema/model changes.**                                                   |

## 4. Packages created

| Package                 | Responsibility                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@platform/application` | Application-layer kernel: DI container, CQRS buses, command/query/handler/use-case contracts, middleware pipeline. Depends only on `@platform/types` + `@platform/utils` — **no infrastructure**. |

## 5. Files added

**`@platform/application`** (15): `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`,
`src/index.ts`; `src/di/{token.ts, container.ts, index.ts, container.test.ts}`;
`src/cqrs/{command.ts, query.ts, errors.ts, message-bus.ts, command-bus.ts, query-bus.ts, index.ts, command-bus.test.ts, query-bus.test.ts}`;
`src/use-case/{use-case.ts, index.ts}`; `src/middleware/{middleware.ts, pipeline.ts, index.ts, pipeline.test.ts}`.

**`@platform/types`**: `src/result.ts`, `src/result.test.ts`, `vitest.config.ts`.
**`@platform/utils`**: `src/domain-errors.ts`, `src/error-envelope.ts`, `src/domain-errors.test.ts`, `vitest.config.ts`.
**`@platform/db`**: `src/prisma-repository.ts`.

## 6. Files modified

- `@platform/types`: `src/index.ts` (export `result`, add `Either` alias), `package.json` (test → `vitest run`, add `vitest`).
- `@platform/utils`: `src/index.ts` (export `domain-errors`, `error-envelope`), `package.json` (test → `vitest run`, add `vitest`).
- `@platform/repository`: `src/index.ts` (new ports), `package.json` (+`@platform/types`).
- `@platform/db`: `src/index.ts` (export adapter), `package.json` (+`@platform/repository`).
- `docs/development/WORKSPACE_GUIDE.md` (package index regrouped by layer; application↛infra rule).

## 7. Database changes

**None.** No models added, no schema modified, no `OutboxMessage` or any table created. The Prisma
repository adapter is code only (an abstract base + a unit-of-work over the existing transaction
helper). The infrastructure-only Prisma schema from Sprint 0.2 is unchanged.

## 8. Migrations

**None.** No migration was created or run.

## 9. Architectural decisions

1. **Application kernel is infrastructure-free.** `@platform/application` depends only on the kernel (`@platform/types`, `@platform/utils`). This enforces the rule "application packages must never depend on infrastructure" (docs/architecture/02; your PACKAGE RULES).
2. **Ports vs. adapters (Dependency Inversion).** Repository **interfaces** live in `@platform/repository`; the **Prisma adapter** lives in the infrastructure package `@platform/db` and implements those ports. Services wire concrete adapters to ports via the DI container, so the application layer never sees Prisma.
3. **No duplication of the shared kernel.** `Result`/`Either` extends the existing `@platform/types.Result`; the domain error hierarchy extends the existing `@platform/utils.AppError`. Errors live in the kernel (not in `@platform/application`) so a future **domain** layer can use them without depending on the application layer.
4. **CQRS buses share one internal dispatcher.** `MessageDispatcher` implements register/dispatch + middleware once; the command and query buses are thin typed facades over it (no duplicated logic).
5. **Type-safe mediator via a phantom result type.** `Command<TResult>`/`Query<TResult>` carry the result type as a phantom field, so `bus.execute(command)` is correctly typed at the call site. Type-erasure at the registry boundary is handled by a few **localized, sound `as` casts** (container resolve, bus register, pipeline result) — **no `any`, no `@ts-ignore`, no disabled rules.**
6. **DI without decorators.** Token-based container (composition over inheritance); no `reflect-metadata` dependency. Supports values, singleton + transient factories, and scoped child containers with parent fallback.
7. **Non-generic middleware contract.** `Middleware.handle(context, next)` operates over `unknown` so middlewares compose as plain objects; the `Pipeline` threads the typed result. Errors are explicit (`HandlerNotFoundError`, `DuplicateHandlerError`, `DependencyResolutionError`, all extending `AppError`).

## 10. Validation results

| Gate      | Command          | Result                                                                                                                       |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Lint      | `pnpm lint`      | ✅ PASS — 16/16 tasks (exit 0)                                                                                               |
| Typecheck | `pnpm typecheck` | ✅ PASS — 16/16 tasks, strict mode (exit 0)                                                                                  |
| Tests     | `pnpm test`      | ✅ PASS — 16/16 tasks, **36 unit tests** (types 5, utils 4, application 12, secrets 5, config 5, health 3, redis 2) (exit 0) |
| Build     | `pnpm build`     | ✅ PASS — storefront `next build` compiled, 4 static routes (exit 0)                                                         |

Install + `prisma generate` (db postinstall) succeeded on pnpm 11.9.0 / Node 24.15.0. No new
external dependencies were introduced (Vitest already in the lockfile), so the supply-chain policy
was not triggered.

## 11. Risks

| Risk                                                                                                     | Severity | Mitigation / note                                                                                        |
| -------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Phantom-type inference needs a typed command/query value (a bare object literal infers `unknown` result) | Low      | Documented in the package README; tests demonstrate the typed pattern; `execute<T>()` is also available. |
| Localized `as` casts at type-erasure boundaries (container/bus/pipeline)                                 | Low      | Sound by construction (type tied at registration); commented; no `any`/`@ts-ignore`.                     |
| `package.json#prisma` deprecation warning (Prisma 7)                                                     | Low      | Pre-existing from Sprint 0.2; migrate to `prisma.config.ts` before a Prisma 7 upgrade.                   |
| Next.js ESLint-plugin "not detected" warning during build                                                | Low      | Pre-existing/benign; build passes.                                                                       |
| Boundary (application↛infra) enforced by convention only                                                 | Medium   | Recommend adding dependency-cruiser fitness functions (see §13).                                         |

## 12. Remaining work

Out of scope for Sprint 0.3 (do **not** implement now):

- **Concrete domain logic** — entities, value objects, real use-cases/handlers, real repositories (Phase 1 commerce core).
- **Event/messaging backbone** — Redpanda/Kafka, transactional outbox, schema registry (deferred per your instruction).
- **Authentication / RBAC** (deferred).
- **dependency-cruiser fitness functions** + a "hello-domain" service wiring the foundation end-to-end (remaining Phase-0 items).

## 13. Recommendations

1. **Add dependency-cruiser** rules in CI to enforce "application packages never import `@platform/{db,redis,clickhouse,storage,observability}`" — turning decision (3)/(2) into an automated gate (docs/architecture/02).
2. **Next foundation sprint:** event/messaging backbone _or_ the first hello-domain service that composes DI + repository adapter + health + observability (satisfies the Phase-0 exit criteria).
3. **Plan the Prisma config migration** (`prisma.config.ts`) before any Prisma 7 upgrade.
4. When the first service lands, add **integration tests** (testcontainers) that exercise `PrismaUnitOfWork`/`PrismaRepository` against a real PostgreSQL (the abstract base has no standalone runtime to unit-test).

## 14. Sprint completion checklist

- [x] Relevant architecture docs read (02 boundaries, 03 data, 04 API/comms, 13 errors/Result)
- [x] Built only what was specified; no business domain, auth, or messaging
- [x] Clean Architecture boundaries preserved (application has zero infra dependencies)
- [x] Dependency Injection container implemented and tested
- [x] CQRS command + query buses implemented and tested
- [x] Base Command/Query/Handler + UseCase contracts implemented
- [x] Repository interfaces (ports) extended; Prisma adapter foundation added in infrastructure
- [x] Domain error hierarchy + Result/Either helpers (extending the kernel, not duplicated)
- [x] Application middleware contracts + pipeline implemented and tested
- [x] Full unit tests added (36 passing)
- [x] No `any`, `@ts-ignore`, `TODO`, `FIXME`, placeholders, mocks, or disabled rules
- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes
- [x] `pnpm test` passes
- [x] Documentation updated (WORKSPACE_GUIDE) + this report generated
- [x] No previous-sprint behavior changed; no database changes; no migrations

**Sprint 0.3 is complete. Stopping here — not continuing to Sprint 0.4.**
