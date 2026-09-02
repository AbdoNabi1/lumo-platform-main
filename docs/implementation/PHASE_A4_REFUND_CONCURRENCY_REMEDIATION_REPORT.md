# Phase A.4 — Refund Concurrency Remediation & Final Backend Security Closure

**Date:** 2026-08-11 (session continued from A.1–A.3, same day)
**Scope:** the A3-02 concurrency/TOCTOU defect in `RefundPaymentLifecycle` — the last open item from
[`PHASE_A3_REFUND_EXECUTION_PRODUCTION_AUDIT.md`](./PHASE_A3_REFUND_EXECUTION_PRODUCTION_AUDIT.md).
**Status:** Audited, minimally remediated, uncommitted (per
[[lumo-sprint-isolation-discipline]] / the project's sprint-isolation rule — no commit made).
**Prior context:** [`PHASE_A1_...`](./PHASE_A1_FINANCIAL_SECURITY_REMEDIATION_REPORT.md) (F-01/F-02/F-03),
[`PHASE_A2_REFUND_SECURITY_CLOSURE_AUDIT.md`](./PHASE_A2_REFUND_SECURITY_CLOSURE_AUDIT.md) (F-04),
[`PHASE_A3_REFUND_EXECUTION_PRODUCTION_AUDIT.md`](./PHASE_A3_REFUND_EXECUTION_PRODUCTION_AUDIT.md) (A3-01
closed, A3-02 discovered and left open — this phase's starting point, re-verified against current code, not
trusted from memory).

---

## 1. Executive Summary

Phase A.3 closed the refund-execution no-op (A3-01) but, while proving that fix's correctness under
concurrency, discovered and explicitly left open a more severe **pre-existing** defect: `RefundPaymentLifecycle`
(`services/payments/src/application/payment-lifecycle.use-cases.ts`, pre-existing since Sprint 4.8) checked its
`totalRefunded <= totalCaptured` invariant, then awaited the real PSP (Stripe) call, and only _afterward_
persisted — a genuine time-of-check-to-time-of-use gap spanning an external network call. Under this codebase's
actual deployment (multi-replica k8s), two application replicas could each read the same pre-refund state, each
pass their own invariant check, and each call the PSP for real, before either write was checked against the
other — a real double-refund risk at the PSP, even though only one replica's database write would ultimately
win.

This phase:

1. **Reconstructed the exact race** from the current code (not from memory) — traced the read, the PSP call,
   and the write, and confirmed they were not ordered to prevent it (§2–§4).
2. **Proved the invariant is enforced at the database layer only for the FINAL write**, not for the PSP call
   that preceded it — optimistic locking (`version`) on `PrismaPaymentIntentRepository.save()` guarantees at
   most one replica's persisted state wins, but says nothing about how many times the PSP was already called
   by the time that's decided (§3–§4).
3. **Re-sequenced `RefundPaymentLifecycle`** into two separately-committed steps around the PSP call —
   `reserve` (durably records a `pending` refund, validated + optimistic-lock-protected, BEFORE any PSP call)
   and `settle` (marks it `completed`/`failed` after the PSP responds) — with bounded retry on optimistic-lock
   conflicts only. This reuses the EXISTING `version` column, the EXISTING `PrismaUnitOfWork`/`$transaction`
   mechanism, and the EXISTING `PaymentProvider` idempotency-key parameter. No new bounded context, no new
   infrastructure, no distributed lock, no outbox, no public API change (§5, §9).
4. **Extended `Refund` with a `status` field** (`pending`/`completed`/`failed`, default `completed` for every
   pre-existing call site) so a reservation durably shrinks `remaining()` for every subsequent reader BEFORE
   the PSP is ever called — this is the actual mechanism that closes the race (§5).
5. **Built a realistic concurrency proof** (`services/payments/src/refund-concurrency.test.ts`) using a fake
   repository that reproduces Postgres's exact `UPDATE ... WHERE version = ?` contract with independent
   per-read snapshots — not a shared in-memory object — and proved all four required cases plus PSP-failure
   recovery and idempotency-key derivation (§C below, §9).
6. **Re-audited the whole refund surface** for a second unprotected path (§10) — found none reachable in
   production composition, but found and documented (not fixed — out of this phase's mandate) that Returns'
   own caller-supplied idempotency key is still discarded by the runtime bridge (§8, §11).

**What is NOT closed:** end-to-end PSP exactly-once semantics across a full request retry (client/Returns
retries the _entire_ `execute()` call after a crash) — that requires a caller-supplied idempotency key threaded
through the public API, which this phase's mandate explicitly excludes (no public API change unless
unavoidable; it is avoidable here). Documented as residual risk, not invented (§7, §11).

**Verdict: CONDITIONALLY PRODUCTION READY** — see §13.

---

## 2. Original Race Condition (as found)

Trace (Returns → Payments → PSP → Postgres), file:line evidence from before this phase's changes:

```
Returns DecideResolution         services/returns/src/application/return-lifecycle.use-cases.ts
        v
PaymentsPort.requestRefund       services/returns/src/application/ports.ts
        v
PrismaPaymentsPortAdapter        apps/runtime/src/composition.ts (Phase A.3)
        v
PaymentController.refundLifecycle   services/payments/src/interfaces/payment.controller.ts:83-85
        v
RefundPaymentLifecycle.execute()    services/payments/src/application/payment-lifecycle.use-cases.ts (pre-fix: 255-309)
        v
  1. unitOfWork.run(tx => {
  2.   intent = intents.findById(id, tx)                 // SELECT, no lock
  3.   intent.requestRefund(amount, ...)                 // in-memory check: amount <= remaining()
  4.   await paymentProvider.refund(pspRef, amount, freshIdempotencyKey)   // REAL STRIPE CALL, inside the open tx
  5.   intent.completeRefund(amount, ...)                // in-memory mutation
  6.   await intents.save(intent, tx)                    // UPDATE ... WHERE version = intent.version
  7. })
```

The invariant check (step 3) and the durable write (step 6) were correctly protected against each other by
`version` — but step 4 (the PSP call) sat BETWEEN them, unprotected. Two replicas could each execute steps
2–4 independently (each with their own DB connection/transaction, each reading the pre-refund `version`),
each pass step 3's check, and each execute step 4 for real, before either reached step 6.

---

## 3. Exact Database Boundary

- `remaining()` (`services/payments/src/domain/payment-intent.ts`, private) was evaluated ENTIRELY in
  application memory, from an aggregate reconstituted by a plain `SELECT` (`PrismaPaymentIntentRepository.
findById` — no `SELECT ... FOR UPDATE`, no explicit isolation level, so Postgres's default READ COMMITTED
  applies).
- The refund record was persisted by `PrismaPaymentIntentRepository.save()`
  (`services/payments/src/infrastructure/prisma-payment-intent-repository.ts:30-71`), inside a Prisma
  interactive transaction (`prisma.$transaction`, `packages/db/src/transaction.ts`).
- **These were NOT in the same critical section as the PSP call.** The PSP call (step 4 above) happened
  between the read (step 2) and the write (step 6), inside the SAME open `$transaction`, meaning the
  transaction held a DB connection open for the duration of a real network round-trip to Stripe — a
  pre-existing anti-pattern, independent of the race itself.

## 4. Concurrency Proof (pre-fix reasoning, confirmed by the new regression suite)

**Can two independent application replicas both read the same refundable balance before either refund is
committed?** Yes. Nothing in the pre-fix code took a row lock at read time, and the version check only ran at
the FINAL write (step 6), by which point the PSP had already been called (step 4) by both replicas in the
worst case. Postgres's `UPDATE ... WHERE version = ?` (via `updateMany`) does correctly serialize the two
writes — the second writer's `UPDATE` blocks on the row lock the first writer's `UPDATE` holds, and on
unblocking, Postgres re-evaluates the `WHERE` clause against the now-committed row, so the loser's `updateMany`
affects 0 rows and `PrismaPaymentIntentRepository.save()` throws `ConcurrencyError`. **This protects the
domain ledger** (never more than one logical refund is persisted for a given slice of `remaining()`) but
**does not protect the PSP call**, which already happened for both replicas by the time this is decided. This
is the precise reasoning documented (not runtime-proven against a live Postgres — Docker/WSL2 confirmed broken
in this sandbox again, consistent with every prior session in this project) in
[[lumo-phase-a3-refund-execution-audit]] and re-verified against the current code in this phase, unchanged
until the fix below.

---

## 5. Remediation (smallest viable fix — Option 2 + Option 3, existing mechanisms only)

**Chosen strategy:** a durable reservation, written and optimistic-lock-protected BEFORE any PSP call, using
the EXISTING `version` column and EXISTING `PrismaUnitOfWork`. This is Option 2 ("conditional atomic
update"/reservation) implemented via Option 3 ("existing optimistic versioning") — no new column-based atomic
`UPDATE ... WHERE remaining >= amount` was needed because `remaining()` is computed from the `charges`/`refunds`
relations, not a scalar column, and the EXISTING per-row optimistic lock on `payment_intents.version` already
serializes ANY two concurrent writers to the same intent regardless of amounts, which is sufficient once the
reservation write happens before the PSP call.

### 5.1 Domain (`services/payments/src/domain/`)

- **`refund.ts`**: `Refund` gained a `status: "pending" | "completed" | "failed"` field (default
  `"completed"` — every pre-existing call site, including the legacy `intent.refund()` and row rehydration,
  is unaffected) and `markCompleted()`/`markFailed()` mutators.
- **`payment-intent.ts`**:
  - `remaining()` (line 344) now excludes only `failed` refunds — `pending` counts exactly like `completed`,
    so a reservation immediately and durably shrinks capacity for every subsequent reader, before any PSP call.
  - `requestRefund(amount, eventId, occurredAt)` (line 262) now validates AND pushes a `pending` `Refund`
    (previously: validated and only emitted an event, no data mutation). `eventId` doubles as the refund's own
    id — this is what makes the PSP idempotency key and the later `completeRefund`/`failRefund` lookup
    deterministic per reservation.
  - `completeRefund(refundId, eventId, occurredAt)` (line 289, signature changed from `(amount, ...)`) now
    looks up the SAME reservation by id and settles it.
  - `failRefund(refundId, eventId, occurredAt, reason)` (line 310, NEW) releases a reservation after a PSP
    failure — does not change the intent's own status (only a completed refund does that).

### 5.2 Application (`services/payments/src/application/payment-lifecycle.use-cases.ts`)

`RefundPaymentLifecycle.execute()` (line 306) is now three steps, `reserve` (line 347) → PSP call (outside any
open transaction) → `settle` (line 372), each `reserve`/`settle` wrapped in `withConcurrencyRetry` (bounded at
5 attempts, retries ONLY on `ConcurrencyError` — a genuine domain rejection, e.g. "exceeds captured amount", is
returned immediately, never retried, never mistaken for a transient conflict). This closes A3-02: two
concurrent callers can only ever have ONE reservation-commit win per unit of `remaining()` capacity; the loser
retries against the now-current row and either fails cleanly (business-rule rejection, **no PSP call made**) or
succeeds against genuinely-still-available capacity (see Case 2 below).

### 5.3 Infrastructure

- **`prisma-payment-intent-repository.ts`**: `save()`'s refund-persistence changed from blind
  `createMany({skipDuplicates: true})` (append-only) to a per-row `upsert` — required because a refund row is
  no longer purely append-only; its `status` transitions exactly once post-creation. Identity/amount/
  occurredAt still never change.
- **`payment-intent.mapper.ts`**: `RefundRow`/`toRefundRows`/`toDomain` thread the new `status` column.
- **`packages/db/prisma/schema/payments.prisma`**: `Refund` gained `status String @default("completed")`.
  **Schema-only** — no migration SQL file was generated or applied. This repository has no committed migration
  history at all (`packages/db/prisma/MIGRATIONS.md` confirms the initial migration was generated offline and
  "has not run against a real database yet"; no `.prisma/schema/migrations/` directory exists in this
  checkout) — consistent with every prior schema change in this project's history, and honestly reported
  rather than fabricated. A real migration would additionally add `CHECK (status IN ('pending','completed',
'failed'))` per `MIGRATIONS.md` §3 — deferred alongside every other hand-written-SQL step until a live
  Postgres host is available. The Prisma client was regenerated (`pnpm --filter @platform/db run db:generate`,
  schema-only, no DB connection required) so TypeScript compiles against the new column.

---

## 6. Concurrency Regression Suite (`services/payments/src/refund-concurrency.test.ts`, 8 tests, all passing)

Built a `PostgresLikePaymentIntentRepository` fake — explicitly NOT `InMemoryPaymentIntentRepository`
(`infrastructure/in-memory-payment-intent-repository.ts`), which stores the live aggregate by reference and
never checks `version` at all, so it could never prove anything about the real race. The fake instead
round-trips every read/write through the SAME `PaymentIntentMapper` the real Prisma repository uses, so
`findById` returns an INDEPENDENT snapshot every call (no cross-reader mutation leakage) and `save` reproduces
Postgres's `UPDATE ... WHERE id = ? AND version = ?` contract exactly, throwing `ConcurrencyError` on a stale
write — a faithful model of the real repository's documented contract, not reliant on incidental Node
scheduling the way the Phase A.3 in-memory test was.

| Case | Concurrent                                      | Result                                                                                                                                         | PSP calls                     |
| ---- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1    | 700 + 700 vs captured 1000                      | exactly one succeeds, one clean 409, **never 1400**                                                                                            | **1**                         |
| 2    | 500 + 500 vs captured 1000                      | **both succeed** via retry, total exactly 1000                                                                                                 | 2 (distinct idempotency keys) |
| 3    | 500 + 600 vs captured 1000                      | exactly one succeeds (500), never 1100                                                                                                         | 1                             |
| 4    | 1000 + 1000 vs captured 1000                    | only one succeeds                                                                                                                              | 1                             |
| +    | Case 1 repeated with 50ms simulated PSP latency | same result — proves the invariant is decided entirely during reservation, before any PSP call                                                 | 1                             |
| +    | PSP failure                                     | reservation marked `failed`, capacity released, a subsequent retry for the same amount succeeds                                                | 1 then 1                      |
| +    | idempotency key                                 | `${paymentIntentId}:refund:${refundId}` — `refundId` is the durable reservation id, not fresh per call                                         | —                             |
| +    | regression matrix                               | valid partial, valid full (→ `refunded`), excessive (rejected, **0 extra PSP calls**), already-fully-refunded (rejected), unknown intent (404) | —                             |

Also re-ran the full pre-existing suite: `services/payments` 34/34 (26 pre-existing + 8 new), `services/returns`
16/16, `apps/admin` 111/111, `apps/runtime` 165/165 — zero regressions.

---

## 7. PSP Ordering & Retry Analysis

**Current pattern (post-fix):** `reserve` (durable, DB-only) → PSP call (no open transaction) → `settle`
(durable, DB-only). Neither "validate → PSP → commit" nor "DB reservation → PSP → finalize" in the pure sense —
it is the latter, and that reordering is the entire fix.

- **PSP succeeds, DB fails (the `settle` write itself conflicts/errors):** `settle` retries on
  `ConcurrencyError` up to 5 times against a fresh read each time; if it still cannot commit, the reservation
  is left `pending` forever until manually reconciled — a genuine residual risk (§11), not fabricated as
  solved. Unlike the pre-fix code (where a mid-flight failure rolled back silently, leaving zero trace), a
  stuck `pending` reservation is at least durably visible and excluded from... no — `pending` still counts
  against `remaining()` (by design, to prevent overcommit), so a stuck reservation reduces refundable capacity
  until resolved. This trade-off (durable-but-stuck beats silent-and-invisible) is deliberate and documented,
  not accidental.
- **DB succeeds, PSP fails:** handled explicitly — `execute()` catches the PSP throw, calls `settle(...,
{succeeded:false, reason})` (marks the reservation `failed`, releasing its capacity), THEN re-throws the
  original PSP error (unchanged external behavior — a PSP failure still surfaces as a thrown error to the
  caller, exactly as before this phase).
- **Request times out after PSP succeeds, client retries:** the retry is a brand-new `execute()` call. It
  generates a brand-new `refundId` (via `idGenerator.generate()` inside `reserve()`) and therefore a brand-new
  PSP idempotency key — **the PSP cannot recognize this as a retry of the same logical refund.** This gap
  PRE-EXISTS this phase (Phase A.3 already documented it) and is **not closed here** — see §11.
- **Two replicas call PSP simultaneously:** now structurally impossible for the SAME reservation, because
  `reserve()`'s optimistic lock ensures only one reservation-commit can exist before any PSP call is made for
  that slice of capacity (proven in §6, Cases 1/3/4).
- **Does the PSP itself prevent a duplicate refund?** `StripePaymentProvider.refund()`
  (`packages/psp-stripe/src/stripe-payment-provider.ts:125-134`) sends the idempotency key as Stripe's
  `Idempotency-Key` header — standard Stripe semantics dedupe a retried call with the SAME key within its
  window. Since the key is now stable per reservation (not fresh per call, as it was pre-fix), a retry of just
  the `settle` step (which does not call the PSP again) never re-invokes Stripe at all, and repeated calls
  using the SAME reservation id (were any code path to do that) would be deduped by Stripe. A retry of the
  WHOLE `execute()` call still is not deduped, as above.

## 8. Idempotency Analysis

- **Closed by this phase:** the PSP idempotency key is now `${paymentIntentId}:refund:${refundId}`, where
  `refundId` is the durably-persisted reservation id — proven in §6's idempotency-key test. Pre-fix, the key
  appended a freshly-generated id on every single call (`payment-lifecycle.use-cases.ts`, pre-fix line 289),
  so the PSP could not have deduped even a same-reservation retry.
- **Not closed (pre-existing, out of mandate):** Returns' `PaymentsPort.requestRefund(orderRef, amountMinor,
currency, idempotencyKey)` DOES receive a caller-supplied idempotency key from Returns
  (`services/returns/src/application/ports.ts`), but `apps/runtime/src/composition.ts`'s
  `PrismaPaymentsPortAdapter.requestRefund` discards it (parameter named `_idempotencyKey`, intentionally
  unused) — `RefundPaymentLifecycleInput` has no field to carry it to. Threading it through would let a
  Returns-level retry reuse the SAME reservation instead of creating a new one, closing the "client retries the
  whole request" gap for Returns specifically. **Not implemented this phase**: it requires an additive field
  on `RefundPaymentLifecycleInput` (a public application-layer type) and a "look up existing reservation by
  caller key before creating a new one" branch in `reserve()` — a real, distinct, additive change, not
  required to close the demonstrated concurrent-refund race (A3-02), and therefore out of this phase's
  "smallest possible fix" mandate. Documented as the concrete next step, not invented.

---

## 9. Regression Matrix

| Scenario                                       | Result                                                                  | Where proven                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Valid partial refund                           | 200 succeeds, `partially_refunded`                                      | `refund-concurrency.test.ts`, `payments.e2e.test.ts`                        |
| Valid full refund                              | succeeds, `refunded`                                                    | both                                                                        |
| Excessive refund                               | 409 `BUSINESS_RULE`, **zero PSP calls**                                 | `refund-concurrency.test.ts` regression-matrix test                         |
| Concurrent refunds (4 cases)                   | §6 table                                                                | `refund-concurrency.test.ts`                                                |
| Duplicate/retried refund (PSP-level)           | idempotency key is stable per reservation (§8)                          | `refund-concurrency.test.ts`                                                |
| PSP failure                                    | reservation marked `failed`, capacity released, original error rethrown | `refund-concurrency.test.ts`                                                |
| Persistence failure (optimistic-lock conflict) | bounded retry (5 attempts), then clean propagation                      | `withConcurrencyRetry`, exercised implicitly by every concurrent case in §6 |
| Retry after timeout (whole-request)            | NOT deduped — documented residual risk                                  | §7, §8, §11                                                                 |
| Invalid payment intent                         | 404 `NOT_FOUND`                                                         | `refund-concurrency.test.ts`                                                |
| Already fully refunded payment                 | rejected (remaining = 0)                                                | `refund-concurrency.test.ts`                                                |

Every assertion checks the authoritative durable state (`repo.findById(...)` after the call) and the PSP mock's
call log — never only the use case's return value / mock-invocation count in isolation.

---

## 10. Production Composition

Verified against the real composition, not just unit tests:

- `apps/runtime/src/api.ts` / `apps/runtime/src/composition.ts`: `PrismaPaymentsPortAdapter.requestRefund`
  (unchanged this phase, comment corrected §5.3/§8) still delegates to `payments.refundLifecycle` →
  `RefundPaymentLifecycle` — the exact class fixed in this phase. No wiring change was needed; the fix lives
  entirely inside the use case + domain + repository Returns already calls through.
- `services/payments/src/composition.ts`: `wirePayments()`'s `refundLifecycle` wiring unchanged (same
  `PaymentLifecycleDeps` shape).
- `services/returns/src/composition.ts`: unchanged — Returns' own `DecideResolution` →
  `RefundVerificationPort` (F-04 ceiling check, Phase A.2) → `PaymentsPort.requestRefund` (Phase A.3) path was
  not touched; it already funnels into the now-fixed `RefundPaymentLifecycle`.
- Full monorepo gates re-run post-fix (§12) confirm the fix compiles and passes in the actual runtime module
  graph (`apps/runtime`'s 165 tests, including `composition.test.ts`'s `PrismaPaymentsPortAdapter` suite,
  unchanged and still green).

## 11. Repository-Wide Security Sweep (Phase J)

Searched for `requestRefund`, `RefundPaymentLifecycle`, `refundAmount`, `amountMinor`, `remaining()`,
`PaymentsPort`, `RefundVerificationPort` across the repo. Findings:

- **`POST /payment-intents/:id/refund`** (`apps/admin/src/http/payments-routes.ts:84-94`) →
  `PaymentsAdminController.refund` (`apps/admin/src/interfaces/payments.admin-controller.ts:55-62`) →
  `PaymentController.refundLifecycle` → the fixed `RefundPaymentLifecycle`. **Enforces the fixed invariant.**
- **Returns resolution/refund path** (`POST /returns/:returnId/resolution` → `DecideResolution` →
  `PrismaPaymentsPortAdapter` → same `PaymentController.refundLifecycle`). **Enforces the same fixed
  invariant** — both admin-HTTP and Returns converge on the identical, now-fixed use case; there is exactly
  ONE refund-execution code path in production, not two.
- **A second, legacy use case exists but is NOT a live second path**: `RefundPayment`
  (`services/payments/src/application/refund-payment.use-case.ts`, exposed as `PaymentController.refund()`,
  wired in `services/payments/src/composition.ts`) calls the legacy `PaymentIntent.refund()` domain method,
  which never calls the PSP at all and has none of this phase's protections. Confirmed via repo-wide grep
  (`admin.payments.refund` / `refundPayment.execute` / `deps.refundPayment`) that this is reachable ONLY from
  `services/payments`'s own composition/tests — no HTTP route, no Returns bridge, and no other app calls
  `PaymentController.refund()` anywhere in production composition. **Not modified** (rule 3: value-driven
  change only; it is dead code from every real entry point, so fixing its concurrency behavior would be
  speculative engineering against a path nothing reaches). Flagged here for visibility, not fixed.
- **Returns' discarded idempotency key** — see §8. Documented, not fixed (out of mandate).

---

## 12. Quality Gates

All run for real, from this checkout, after the fix:

| Gate                                                     | Scope                            | Result                                                                                                              |
| -------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (root, all 78 packages)                 | monorepo                         | **78/78 successful**                                                                                                |
| `pnpm test` (root, all 78 packages)                      | monorepo                         | **78/78 successful**, zero failures                                                                                 |
| `pnpm --filter @platform/payments test`                  | targeted                         | **34/34** (26 pre-existing + 8 new concurrency tests)                                                               |
| `pnpm --filter @platform/returns test`                   | targeted                         | **16/16**                                                                                                           |
| `pnpm --filter @platform/admin test`                     | targeted                         | **111/111**                                                                                                         |
| `pnpm --filter @platform/runtime test`                   | targeted                         | **165/165**                                                                                                         |
| `pnpm --filter {payments,returns,runtime,admin,db} lint` | targeted                         | clean, no errors                                                                                                    |
| `pnpm run arch`                                          | repo-wide (`dependency-cruiser`) | **0 violations**, 1564 modules, 6786 dependencies cruised                                                           |
| `pnpm governance`                                        | —                                | **does not exist in this checkout** (no such script in root `package.json`), reported honestly, same as A.1/A.2/A.3 |
| `pnpm dup`                                               | —                                | **does not exist in this checkout**, same as above                                                                  |

No live Postgres was available (Docker Desktop / WSL2 confirmed broken in this sandbox, consistent with every
prior session in this project's history — not re-attempted, not fabricated as tested). The concurrency proof
in §6 is a faithful, evidence-based simulation of Postgres's documented optimistic-locking contract, not a
live-database test — this limitation is stated plainly, not hidden.

---

## 13. Remaining Risks

1. **Whole-request retry is not PSP-exactly-once** (§7, §8) — a crash between a successful PSP call and the
   `settle` commit, followed by a full `execute()` retry, creates a new reservation and a new PSP idempotency
   key. Closing this needs a caller-supplied idempotency key threaded through `RefundPaymentLifecycleInput` —
   a real, additive, NOT-done-here change (§8).
2. **A stuck `settle` failure leaves a `pending` reservation** that permanently reduces `remaining()` until
   manually reconciled (§7) — no reconciliation job exists or was built (would be speculative infrastructure
   without a demonstrated need).
3. **`RefundPayment`/`PaymentController.refund()` (legacy, PSP-less) remains in the codebase**, unreachable
   from production composition today but not removed — a future wiring change could accidentally expose it
   (§11). Not fixed (dead code, no live path, out of value-driven-change mandate).
4. **Schema change is not yet a real Postgres migration** — no live database has ever validated this project's
   schema, this phase's `Refund.status` column included (§5.3). This is a pre-existing, sandbox-wide
   limitation (Docker/WSL2 broken across the project's entire history), not something this phase could resolve.
5. **The concurrency proof is a faithful simulation, not a live-Postgres test** (§12) — the fake repository
   reproduces the documented `UPDATE ... WHERE version = ?` contract exactly, but has never been cross-checked
   against a real Postgres instance in this project.

## 14. Production Readiness Verdict

**CONDITIONALLY PRODUCTION READY.**

The demonstrated race (A3-02: concurrent refunds could exceed captured amount at the PSP, or double-charge the
PSP for one logical refund) is closed at the database-invariant layer, proven by a faithful, evidence-based
concurrency test suite (§6), and applies to the real runtime composition (§10) — not just to tests. Financial
correctness under concurrency is enforced at the authoritative boundary (the `payment_intents.version`
optimistic lock, now checked BEFORE any PSP call, not after).

This is conditional, not unconditional, for exactly the reasons Phase F requires distinguishing: **database
safety is proven; PSP execution safety for a single race window is proven; end-to-end exactly-once semantics
across a full external request retry is intentionally NOT available** (§13.1) — that gap pre-exists this
phase, is honestly documented, and was not silently declared solved. No concurrent refund can exceed the
captured amount. No two concurrent requests for the same capacity can both reach the PSP. A genuine
whole-request retry after a crash remains a residual, documented risk requiring a distinct, additive follow-up
(caller-supplied idempotency key) — not a defect newly introduced or hidden by this phase.
