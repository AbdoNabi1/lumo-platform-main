# Sprint 1.5 — Commerce Core: Identity — Implementation Report

> **Date:** 2026-06-30 · **Status:** ✅ COMPLETE (all gates green) · **Phase 1 — Commerce Core.**
> Not committed/pushed (per instructions).

## 1. Summary

The final Phase-1 bounded context: **`@platform/identity`** — customers, their postal addresses,
and an append-only consent log. An independent Clean-Architecture slice (domain → application →
infrastructure → interfaces) on the existing kernel/contracts/messaging — **extending**, never
replacing. In-memory persistence + transactional outbox; framework-agnostic controllers; **no
cross-context imports** (other contexts reference a customer only by bare id). This completes the
**9 of 9** Phase-1 business contexts. **No existing source was modified** (purely additive).

## 2. Implemented components

- **Domain:** `Customer` (aggregate; raises `customer.registered` + `consent.changed`; consent for a
  scope is **derived** from the latest record), `Address` + `ConsentRecord` (append-only) entities;
  value objects `Email` (normalized, the natural key) + `ConsentScope` (closed set
  `marketing`/`analytics`/`data_sharing`); `CustomerRepository` port (incl. `findByEmail`).
- **Application:** `RegisterCustomer` (enforces email uniqueness → `ConflictError`), `AddAddress`,
  `ChangeConsent` (`@platform/application` `UseCase`). VO validation returns `Result`;
  conflict/not-found are `DomainError`s mapped by the presenter.
- **Infrastructure:** in-memory repository (writes the outbox on save; email lookup),
  `InMemoryUnitOfWork`, `IdentityEventTranslator`
  (→ `identity.customer.{registered,consent_changed}.v1`).
- **Interfaces:** `CustomerController` (register/addAddress/changeConsent) + `present()` (no HTTP).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## 3. Files created (25 + report)

- **Config (4):** `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`.
- **`src` (3):** `index.ts`, `composition.ts`, `identity.e2e.test.ts`.
- **`src/domain/value-objects` (3):** `email.ts`, `consent-scope.ts`, `value-objects.test.ts`.
- **`src/domain` (5):** `address.ts`, `consent-record.ts`, `customer.ts`, `customer-repository.ts`,
  `customer.test.ts`.
- **`src/domain/events` (2):** `customer-registered.event.ts`, `consent-changed.event.ts`.
- **`src/application` (3):** `register-customer`, `add-address`, `change-consent` (`.use-case.ts`).
- **`src/infrastructure` (3):** `in-memory-unit-of-work.ts`, `identity-event-translator.ts`,
  `in-memory-customer-repository.ts`.
- **`src/interfaces` (2):** `presenter.ts`, `customer.controller.ts`.
- Plus `docs/implementation/SPRINT_1_5_REPORT.md`.

## 4. Files modified

- Docs only: `PROJECT_STATE.md`, `AI_CONTEXT.md`, `DECISIONS.md` (append D-032),
  `docs/development/WORKSPACE_GUIDE.md`; `pnpm-lock.yaml` (1 new workspace package). **No existing
  source package or service modified.**

## 5. Validation results

| Gate                             | Result                                      |
| -------------------------------- | ------------------------------------------- |
| `pnpm install --frozen-lockfile` | ✅ PASS                                     |
| `pnpm lint`                      | ✅ PASS (33 packages)                       |
| `pnpm typecheck`                 | ✅ PASS (33 packages)                       |
| `pnpm test` (serialized)         | ✅ PASS (33 task) — `@platform/identity` 10 |
| `pnpm build`                     | ✅ PASS                                     |
| `pnpm arch`                      | ✅ PASS — 370 modules, 0 violations         |

The baseline was green before implementation. One self-inflicted import typo in `customer.ts`
(`Email` imported from the wrong module) was caught and fixed before the first gate run.

## 6. Design decisions (see DECISIONS D-032)

- **Consent derived** from an append-only `ConsentRecord` log (insert-only; never mutated) — mirrors
  Orders' append-only `OrderEvent`.
- **Email is the natural key** — `RegisterCustomer` enforces uniqueness via `findByEmail` and returns
  `ConflictError` (409). A correctness rule, not a speculative abstraction.
- **`Email`/`ConsentScope` stay context-local** — Identity is their only consumer (not at rule of
  three). Identity's `Address` is an owned **entity**, distinct from Orders' `AddressSnapshot` VO.
- **Auth not implemented** — the `Authenticator`/`AccessControl` ports already exist in
  `@platform/contracts` (0.7); an Ory adapter + encrypted PII are deferred.
- Consistent with D-026/D-031: VO factories → `Result`; aggregate invariants/domain errors → `Result`
  channel; framework-agnostic controllers + `present()`; in-memory + outbox-on-save.

## 7. Trade-offs

- In-memory persistence (no ACID/durability); email uniqueness via a store scan (a Postgres unique
  index replaces it).
- Consent values are not yet encrypted (the encrypted-field seam is a later concern).
- `present()` + `InMemoryUnitOfWork` duplicated per context (interface/infra independence) — now
  across **nine** Phase-1 contexts (intentional).

## 8. Technical debt

- `present()`/`InMemoryUnitOfWork` duplication across the nine contexts (intentional; revisit when
  HTTP transport / Prisma land).
- No live consumer yet for `customer.registered`/`consent.changed` (broker deferred).

## 9. Deferred work

Prisma persistence (`identity` schema + unique email index; outbox in the DB transaction); an Ory
adapter behind the existing auth ports + encrypted PII fields; households/child-profiles/ReBAC
(explicitly out of Phase 1); Redpanda/Debezium broker wiring + live consumers; HTTP transport. The
cross-context **purchase-saga orchestration** (from Sprint 1.4) also remains deferred.

## 10. Git

Not committed/pushed (per instructions). Working tree adds `services/identity` + the doc updates (on
top of the still-uncommitted Sprint 1.3/1.4 work). **Recommended Conventional Commit message:**

```
feat(identity): phase 1 identity context (Sprint 1.5)
```

## 11. Ready for Sprint 1.6?

**Yes.** All nine Phase-1 business contexts are implemented and green. Next per the roadmap is
**Sprint 1.6 — admin wiring behind the frozen admin UI**.

**Sprint 1.5 is complete. Stopping — not beginning Sprint 1.6.**
