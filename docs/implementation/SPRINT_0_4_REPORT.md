# Sprint 0.4 — Domain Foundation — Implementation Report

> **Date:** 2026-06-29 · **Status:** ✅ COMPLETE (all validation green) · **Phase 0 — Foundations.**

## 1. Executive summary

Sprint 0.4 delivers the **domain foundation** — the innermost Clean Architecture layer — as the new
`@platform/domain` package, plus the **ID-generation abstraction** (Dependency Inversion). The domain
is **pure and deterministic**: it depends only on the kernel (`@platform/types`, `@platform/utils`),
generates no ids, reads no clock, and contains no infrastructure, framework, messaging, or business
logic. New aggregate ids come from an `IdGenerator` **port** (in `@platform/application`) implemented
by a `CryptoIdGenerator` **adapter** (new infra package `@platform/id`). All four gates pass.

## 2. Implemented features

- **Shared kernel building blocks** (`@platform/domain`): `Entity<TProps>` (identity equality, read-only props), `AggregateRoot<TProps>` (collects domain events via a composed `DomainEventCollection`, `version` for optimistic concurrency), `ValueObject<T>` (immutable, structural deep-equality), `UniqueEntityId` (+ `UniqueEntityId.from(value)`), `DomainEvent` (supplied `eventId`/`aggregateId`/`occurredAt`) + `DomainEventCollection`, `Guard` (validation helpers → `Result<T, ValidationError>`), `Specification<T>` (+ `and`/`or`/`not`), `DomainService` marker, and a curated re-export of the kernel `DomainError` hierarchy.
- **ID abstraction:** `IdGenerator` port + `ID_GENERATOR` DI token (`@platform/application`); `CryptoIdGenerator` adapter (`@platform/id`).

## 3. Architecture decisions

1. **Domain is pure & deterministic** — depends only on the kernel; no id generation, clock reads, infra, frameworks, messaging, or business logic. (DECISIONS D-008.)
2. **ID generation via Dependency Inversion** — domain exposes only `UniqueEntityId.from(value)`; the `IdGenerator` port lives in the application layer; the `CryptoIdGenerator` adapter (Node `crypto.randomUUID`) lives in infra `@platform/id`. The application generates ids and passes them in; repositories rehydrate via `from()`. (DECISIONS D-009.)
3. **Domain events are infrastructure-free** — metadata supplied (no bus/outbox/clock); `AggregateRoot` only collects events. (DECISIONS D-010.)
4. **Errors reuse the kernel** — `errors/` re-exports the `@platform/utils` `DomainError` hierarchy (single source; no duplication). (DECISIONS D-005.)
5. **Layering preserved** — `kernel → domain → application → infrastructure`; the adapter (`@platform/id`) depends on the application port, never the reverse. (DECISIONS D-003.)

## 4. Packages

- **Created:** `@platform/domain` (domain layer), `@platform/id` (infrastructure adapter).
- **Modified:** `@platform/application` — added the `IdGenerator` port (`src/ports/`) and exported it from the barrel. No other completed-sprint package changed.

## 5. Files created

**`@platform/domain`** (31): `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`,
`src/index.ts`, `src/shared/index.ts`;
`src/shared/value-object/{value-object.ts, unique-entity-id.ts, index.ts, value-object.test.ts, unique-entity-id.test.ts}`;
`src/shared/entity/{entity.ts, index.ts, entity.test.ts}`;
`src/shared/aggregate/{aggregate-root.ts, index.ts, aggregate-root.test.ts}`;
`src/shared/events/{domain-event.ts, domain-event-collection.ts, index.ts, domain-events.test.ts}`;
`src/shared/guards/{guard.ts, index.ts, guard.test.ts}`;
`src/shared/services/{domain-service.ts, index.ts}`;
`src/shared/specification/{specification.ts, index.ts, specification.test.ts}`;
`src/shared/errors/{index.ts, errors.test.ts}`.

**`@platform/application`** (2): `src/ports/id-generator.ts`, `src/ports/index.ts`.

**`@platform/id`** (6): `package.json`, `tsconfig.json`, `vitest.config.ts`,
`src/crypto-id-generator.ts`, `src/index.ts`, `src/crypto-id-generator.test.ts`.

Plus this report.

## 6. Files modified

- `@platform/application`: `src/index.ts` — added `export * from "./ports"` (additive; required to expose the new port).
- Docs: `docs/PROJECT_STATE.md`, `docs/AI_CONTEXT.md`, `docs/development/WORKSPACE_GUIDE.md` (sprint status + package index).

Two in-sprint files were corrected during validation (see §7): `unique-entity-id.ts` (added `override` on `toString`) and `entity.ts` (`import type`). No frozen/previous-sprint code was changed.

## 7. Validation results

| Gate             | Result                                                                        |
| ---------------- | ----------------------------------------------------------------------------- |
| `pnpm lint`      | ✅ PASS (exit 0)                                                              |
| `pnpm typecheck` | ✅ PASS (exit 0)                                                              |
| `pnpm test`      | ✅ PASS (exit 0) — **26 new tests** (`@platform/domain` 24, `@platform/id` 2) |
| `pnpm build`     | ✅ PASS (exit 0)                                                              |

Issues found and fixed during validation:

1. **TS4114** — `UniqueEntityId.toString()` overrides `Object.toString` (via `ValueObject`); added the `override` modifier (`noImplicitOverride`).
2. **`consistent-type-imports`** — `entity.ts` used `UniqueEntityId` only as a type; switched to `import type`.

Install/link succeeded on pnpm 11.9.0; no new external dependencies (no supply-chain-policy impact).

## 8. Remaining work

- **None for Sprint 0.4.** The domain is reusable but not yet consumed by any bounded context (Phase 1). The `ID_GENERATOR` token is wired to `CryptoIdGenerator` at a service composition root in a later sprint.
- Carried over (out of scope here): Sprint 0.2 live Docker validation; dependency-cruiser fitness functions (recommended to enforce the layer boundaries this sprint relies on).

## 9. Completion checklist

- [x] Resumed from the partial implementation; sprint not restarted
- [x] Finished only the remaining work (IdGenerator port, `@platform/id`, validation)
- [x] No completed-sprint code changed except the required additive port export
- [x] Clean Architecture boundaries preserved; domain pure & deterministic
- [x] No business logic, authentication, messaging, or new architecture
- [x] No `any` / `@ts-ignore` / `eslint-disable` / TODO / placeholder / mock
- [x] lint · typecheck · test · build all green
- [x] Report written; AI docs updated

**Sprint 0.4 is complete. Stopping — not continuing to Sprint 0.5.**

---

## 10. Post-review hardening (2026-06-29)

A Principal-Architect review of Sprint 0.4 raised findings M1–M5 + L1. All were approved and
resolved **within Sprint 0.4** (no Sprint 0.5 work). Decisions recorded in DECISIONS D-018–D-022
and [ADR-0002](../architecture/adr/0002-outbound-ports-in-contracts-package.md).

| #      | Finding                                                                                   | Resolution                                                                                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** | `IdGenerator` port buried in `@platform/application`; adapters coupled to the whole layer | New leaf package **`@platform/contracts`** holds the port **interfaces** (`IdGenerator`, `Clock`); DI tokens stay in `@platform/application`; `@platform/id` now depends only on `@platform/contracts`. (D-018, ADR-0002) |
| **M2** | `CryptoIdGenerator` emitted UUIDv4, contradicting the documented UUIDv7 strategy          | **UUIDv7 (RFC 9562)** implemented with `node:crypto` only — no external dependency. (D-022)                                                                                                                               |
| **M3** | No `Clock` abstraction despite the determinism mandate                                    | **`Clock`** interface in `@platform/contracts`, `CLOCK` token in `@platform/application`, **`SystemClock`** adapter in new **`@platform/clock`** — mirrors `IdGenerator` exactly; abstraction only. (D-019)               |
| **M4** | `ValueObject` used a shallow `Object.freeze` (composite VOs mutable)                      | Recursive **`deepFreeze`** (plain objects + arrays) at construction. (D-020)                                                                                                                                              |
| **M5** | `UniqueEntityId.from` accepted empty/whitespace ids                                       | Validates via `Guard.againstEmpty`; **throws `ValidationError`** for empty/blank; public API unchanged. (D-021)                                                                                                           |
| **L1** | `clearEvents()` only — no atomic pull                                                     | Added **`pullDomainEvents()`** (returns + clears atomically); `clearEvents()` retained (non-breaking).                                                                                                                    |

### Files created

- `@platform/contracts` (6): `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, `src/id-generator.ts`, `src/clock.ts`.
- `@platform/clock` (7): `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`, `src/index.ts`, `src/system-clock.ts`, `src/system-clock.test.ts`.
- `docs/architecture/adr/0002-outbound-ports-in-contracts-package.md`.

### Files modified

- `@platform/application`: `package.json` (+`@platform/contracts` dep), `src/ports/id-generator.ts` (interface from contracts; token kept), `src/ports/clock.ts` (new; `CLOCK` token), `src/ports/index.ts`.
- `@platform/id`: `package.json` (dep `@platform/application` → `@platform/contracts`; description), `src/crypto-id-generator.ts` (UUIDv7), `src/crypto-id-generator.test.ts` (v7 format + time-ordering).
- `@platform/domain`: `value-object.ts` (deep freeze) + test, `unique-entity-id.ts` (Guard invariant) + test, `aggregate-root.ts` (`pullDomainEvents`) + test.
- Docs: `DECISIONS.md`, `AI_CONTEXT.md`, `PROJECT_STATE.md`, `development/WORKSPACE_GUIDE.md`.

### Validation (re-run, all green)

`pnpm install --no-frozen-lockfile` (linked 2 new packages; **no new external deps**), then
`pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ · `pnpm build` ✅.
Tests: `@platform/domain` **28**, `@platform/id` **3**, `@platform/clock` **1** (`@platform/contracts` is interface-only).

**Hardening complete. Stopping — not continuing to Sprint 0.5.**
