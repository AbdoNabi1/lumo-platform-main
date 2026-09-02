# Phase A.5 — Refund Idempotency & Crash-Retry Security Closure Report

## 1. Executive Summary

Phase A.4 closed the refund **concurrency** race (two simultaneous refund requests could no longer
double-spend a payment intent's captured amount). This phase asked a different question: can a
**single** refund request, retried after a crash or timeout, safely reach the PSP exactly once?

The answer, confirmed by reading the actual implementation (not assumed): **no, not before this
phase.** `RefundPaymentLifecycle` minted a fresh reservation id — and therefore a fresh PSP
idempotency key — on every call to `execute()`, with no concept of a caller-supplied idempotency
key at all. Returns _did_ already generate a stable key (`<returnId>:refund`) and pass it to
`PaymentsPort.requestRefund(...)`, but the production runtime bridge
(`PrismaPaymentsPortAdapter.requestRefund` in `apps/runtime/src/composition.ts`) received it as
`_idempotencyKey` and discarded it — this was already self-documented in a Phase A.4 code comment
as a known, deferred gap.

This phase:

- **Proved the gap** with a failing/red-then-green regression test (Task 2, §4).
- **Threaded the existing key through** the smallest possible interface path: Returns →
  `PaymentsPort` → `PrismaPaymentsPortAdapter` → `RefundPaymentLifecycleInput.idempotencyKey` →
  `PaymentIntent.requestRefund` (§7). No new bounded context, no outbox, no distributed lock, no
  new event contract, no public API breakage.
- **Verified production composition** end-to-end: `apps/runtime/src/api.ts` really does wire
  Returns' `DecideResolution` to the fixed adapter today (§12).
- **Found one additional, real, un-fixed exposure** outside this phase's explicit mandate: the
  admin HTTP route `POST /payment-intents/:id/refund` calls the same `RefundPaymentLifecycle` but
  has no idempotency-key field in its request body at all, so a direct HTTP retry of that route is
  still vulnerable to the same double-refund class this phase fixes for Returns (§13, §16).

**Verdict: CONDITIONALLY PRODUCTION READY** (§17).

## 2. Previous A4 Finding (context)

Phase A.4 split `RefundPaymentLifecycle` into `reserve` → PSP call → `settle`, so the PSP is only
ever called after a durable, optimistic-lock-protected `pending` reservation exists. That closed
A3-02 (concurrent over-refund). Its own report explicitly flagged the gap this phase closes:

> "This does NOT make the PSP call itself exactly-once: a crash between step 2 succeeding and step
> 3 committing, followed by a caller retry of the whole `execute()`, generates a fresh `refundId`
> (and thus a fresh PSP idempotency key) — the PSP cannot dedupe a full request retry."

That sentence, found verbatim in `payment-lifecycle.use-cases.ts` before this phase's changes, is
the exact defect Task 2 below reproduces with a test.

## 3. Idempotency Key Trace

Read end-to-end in the actual code, not assumed:

| Stage                   | File                                                                                    | Before A.5                                                                                                                                                           | After A.5                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Created**             | `services/returns/.../return-lifecycle.use-cases.ts` `DecideResolution.execute`         | `` `${returnRequest.id.toString()}:refund` `` passed to `paymentsPort.requestRefund(...)`                                                                            | unchanged — already stable                                                                                                                                           |
| **Transformed**         | —                                                                                       | not transformed, passed as 4th positional arg                                                                                                                        | unchanged                                                                                                                                                            |
| **Discarded**           | `apps/runtime/src/composition.ts` `PrismaPaymentsPortAdapter.requestRefund`             | parameter named `_idempotencyKey`, **never used**; `payments.refundLifecycle({paymentIntentId, amountMinor, currency})` — no key                                     | renamed to `idempotencyKey`, forwarded: `refundLifecycle({..., idempotencyKey})`                                                                                     |
| **Regenerated (bug)**   | `services/payments/.../payment-lifecycle.use-cases.ts` `RefundPaymentLifecycle.reserve` | `refundId = idGenerator.generate()` — **fresh every call**, no lookup                                                                                                | `intent.requestRefund(amount, freshEventId, now, idempotencyKey)` — looks up an existing reservation by `idempotencyKey` first; only mints a fresh id if none exists |
| **Preserved (PSP key)** | same file, `execute`                                                                    | `` `${paymentIntentId}:refund:${refundId}` `` — stable **within** one `execute()` call's own optimistic-lock retries, unstable **across** separate `execute()` calls | same formula, now stable across separate `execute()` calls too, because `refundId` itself is now stable when `idempotencyKey` matches                                |
| **PSP parameter**       | `packages/psp-stripe/src/stripe-payment-provider.ts` `refund()`                         | forwards `idempotencyKey` verbatim as the real `Idempotency-Key` HTTP header to Stripe's `/v1/refunds`                                                               | unchanged — already correct, this leg was never the problem                                                                                                          |

No step was assumed; each row was read from the source file named.

## 4. Exploit Proof (Task 2)

`services/payments/src/refund-idempotency.test.ts`, describe block _"Task 2 — exploit proof"_:

```
two retries of the SAME logical refund (no idempotencyKey — pre-A.5 caller shape)
get TWO different PSP idempotency keys and TWO PSP calls
```

This test calls `RefundPaymentLifecycle.execute()` twice with identical `{paymentIntentId,
amountMinor: 300, currency}` and **no** `idempotencyKey` — exactly the shape every call had in
production before this phase's fix (since the runtime bridge discarded the key before it ever
reached this input). Result, both before and after the fix (this specific call shape was never
protected — see why below):

- 2 PSP calls, 2 distinct idempotency keys (`Set` size 2)
- Total refunded: **600**, not 300 — a real double refund of what the caller intended as one
  request

This test intentionally still passes after the fix — it documents the vulnerability _class_
inherent to omitting the key, which is what production actually did pre-fix. The fix (§7) does not
change behavior for callers that don't supply a key (additive, non-breaking); it changes behavior
for the one production caller that now does (Returns, via the runtime bridge).

**Additional verification — genuine red/green, not just static reasoning:** the four files
implementing the fix (`refund.ts`, `payment-intent.ts`, `payment-lifecycle.use-cases.ts`,
`payment-intent.mapper.ts`) were scoped-stashed back to their pre-A.5 state (`git stash push --
<4 files>`) with the new test file left in place, and the suite was re-run:

- 7 of the 11 new Phase-A.5-specific tests **failed red** against the pre-fix code (2 with wrong
  PSP-call counts, 1 with a `TypeError` because `requestRefund` didn't return a value yet, 1 with a
  wrong refund status, 3 with unrelated `ConcurrencyError` timing noise from the shared
  `PostgresLikePaymentIntentRepository` fake at that revert point).
- The stash was popped, restoring the fix; all 11 tests passed again, confirmed stable across 3
  repeated runs (§10).

This is real evidence the new tests exercise genuinely new behavior, not tautologies.

## 5. Crash Window Analysis

**Scenario A — reservation succeeds, PSP succeeds, crash before `completed` persists, then retry.**
Modeled in `refund-idempotency.test.ts` ("Scenario A: crash between PSP success and
settle-commit..."), explicitly labeled as an in-process state simulation (Task 13 — no real process
kill is possible in this test harness). Result: the retry's `reserve()` finds the existing
`pending` reservation by `idempotencyKey` (does not create a second one), calls the PSP again with
the **same** derived key (`pi-crash-a:refund:<same-refund-id>`), then settles to `completed`. Final
state: exactly one `Refund` row, `completed`. **Pass.**

**Scenario B — PSP request sent, response lost, caller retries.** Covered by "same idempotencyKey
on retry → same PSP idempotency key" and the concurrent-same-key test. The retry presents the exact
same idempotency identity to the PSP; this codebase cannot itself guarantee the PSP received or
dropped the first attempt, only that every retry looks identical to the PSP. **Pass, bounded by PSP
guarantee (§6).**

**Scenario C — PSP rejects, refund becomes `failed`, caller retries.** Covered by "reusing a key
after the PSP call definitively failed is rejected." Design decision (Task 4): reusing the same key
after a `failed` outcome is **rejected outright** (`BusinessRuleError`, no PSP call) rather than
silently retried — no caller in this codebase today has a "retry after failure" use case (Returns'
`DecideResolution` transitions the return to `refund_requested` exactly once; see §11), so
permitting an implicit retry would be speculative engineering. A caller that wants a genuinely new
attempt must mint a new key (proven in the same test: `return-fail:refund:attempt-2` succeeds).
**Pass.**

**Scenario D — two different logical refunds must never share a key.** Covered by "two different
logical refunds (different idempotencyKeys) never share a PSP identity, even concurrently." Two
concurrent calls with distinct keys produce two distinct PSP calls and two distinct keys, refunding
800 total against 1000 captured. **Pass.**

## 6. PSP Semantics

The real production PSP adapter (`packages/psp-stripe/src/stripe-payment-provider.ts`, `refund()`)
sends `idempotencyKey` as the literal `Idempotency-Key` HTTP header on Stripe's `/v1/refunds` call
— confirmed by reading the adapter, not assumed. This is the actual mechanism the fix depends on:
this codebase makes every retry **present the same identity**; whether Stripe's own dedup then
collapses that into a single real refund is a guarantee **Stripe provides, not this codebase**.
Stripe's own documented behavior (not independently verified here — no live Stripe sandbox in this
environment, consistent with the C2-2 sprint's own deferred-to-user Stripe sandbox validation) is
that a repeated call with the same idempotency key returns the cached original response rather than
re-executing. This report does not claim a stronger guarantee than that.

Where this codebase's own test fake needed to model that PSP-side guarantee to test correctly
(`RecordingPaymentProvider` in `refund-idempotency.test.ts`), it distinguishes `calls` (every
physical invocation presented to the fake) from `realEffects` (money that actually moved — counted
once per distinct idempotency key), and the report and tests are explicit about which one each
assertion checks, per the instruction not to fake a stronger guarantee than the underlying PSP API
provides.

## 7. Minimal Fix

Exactly the flow specified, no more:

```
Returns' <returnId>:refund
  -> PaymentsPort.requestRefund(orderRef, amount, currency, idempotencyKey)   [already existed]
  -> PrismaPaymentsPortAdapter.requestRefund                                  [FIXED: no longer discards it]
  -> payments.refundLifecycle({..., idempotencyKey})                         [FIXED: new optional field]
  -> RefundPaymentLifecycle.reserve()
  -> PaymentIntent.requestRefund(amount, eventId, now, idempotencyKey)       [FIXED: find-or-create]
       - existing match, same amount, status pending/completed -> reuse (isNew: false)
       - existing match, different amount -> reject (tamper protection, Task 11)
       - existing match, status failed -> reject (Scenario C — new key required)
       - no match -> create as before (isNew: true)
  -> PSP idempotency key = `${paymentIntentId}:refund:${refund.id}`          [unchanged formula —
                                                                                now stable because
                                                                                refund.id is stable]
```

No new bounded context, no outbox, no distributed lock, no new event contract. `idempotencyKey` is
optional everywhere it was added — callers that omit it (nothing in this codebase currently does,
except the not-yet-fixed admin HTTP route, §13) get exactly the pre-A.5 behavior.

**Files changed:**

- `services/payments/src/domain/refund.ts` — `Refund` gains an optional `idempotencyKey` field/getter.
- `services/payments/src/domain/payment-intent.ts` — `requestRefund` gains the 4th optional param
  and find-or-reject logic; now returns `{ refund, isNew }` (was `void`).
- `services/payments/src/application/payment-lifecycle.use-cases.ts` —
  `RefundPaymentLifecycleInput.idempotencyKey` (optional); `reserve()` threads it through and skips
  `save()` on a pure resume; `execute()` short-circuits on `alreadyCompleted` before ever calling
  the PSP again.
- `services/payments/src/infrastructure/payment-intent.mapper.ts` — `RefundRow.idempotencyKey`
  mapped both directions.
- `packages/db/prisma/schema/payments.prisma` — `Refund.idempotencyKey` (nullable `TEXT`) + unique
  index on `(intentId, idempotencyKey)`, same precedent as the existing Sprint A0
  `PaymentIntent.idempotencyKey` column.
- `packages/db/prisma/schema/migrations/20260811000000_phase_a5_refund_idempotency/migration.sql`
  — new additive migration (generated offline, not applied — no live Postgres in this environment,
  same convention as every other migration file already in this repo's history).
- `apps/runtime/src/composition.ts` — `PrismaPaymentsPortAdapter.requestRefund` forwards
  `idempotencyKey` instead of discarding it; doc comment updated.
- `apps/runtime/src/composition.test.ts` — 2 existing assertions updated to include the now-present
  `idempotencyKey` field; 1 new test proving it survives the bridge unchanged.

**New file:** `services/payments/src/refund-idempotency.test.ts` — 11 tests (§14).

## 8. Reservation Interaction (Task 6)

The A.4 reservation model (`pending` → `completed`/`failed`, optimistic-locked) is unchanged in
shape; only the _identity_ used to find-or-create a reservation changed. Verified interaction:

- **Never sent vs. sent-but-lost vs. rejected** — this codebase genuinely cannot distinguish
  "never sent" from "sent but the response was lost" from inside a single process; both look like
  "reservation is `pending`, no exception was recorded." The fix does not pretend otherwise: both
  cases are handled identically (resume the `pending` reservation, call the PSP again with the same
  key, rely on PSP dedup). Only "PSP rejected" is distinguishable, because it is durably recorded as
  `failed` before the exception propagates (`settle()` runs in its own committed transaction before
  the original error is rethrown — unchanged from A.4).
- **A `pending` refund can safely resume execution** — proven by the Scenario A/B tests: resuming
  a `pending` reservation reuses the same `refund.id`, hence the same derived PSP key, regardless of
  how many times it is resumed.
- No outbox, no distributed transaction was introduced to achieve this — the existing per-reservation
  optimistic lock (`PaymentIntent.version`) is reused unchanged; see §9 for why it is also what
  serializes concurrent same-key creation safely.

## 9. Failure Injection Results (Task 13)

All modeled as fake-repository/fake-PSP state transitions, explicitly labeled as simulations (no
real process kill is possible in a Vitest process) — no claim of real distributed proof is made:

| Injection                                | Test                                                          | Result                                                                               |
| ---------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Crash after reservation, before PSP call | covered implicitly — `pending`, no PSP call yet, resume path  | retry calls PSP once, succeeds                                                       |
| Crash after PSP request (PSP succeeded)  | "Scenario A"                                                  | retry reuses same PSP key, `RecordingPaymentProvider.realEffects` stays 1            |
| Persistence failure after PSP success    | "Scenario A" (settle never ran)                               | same as above — the un-settled `pending` row is what makes resume possible           |
| Network timeout / lost PSP response      | "same idempotencyKey on retry... Scenario B"                  | retry short-circuits once `completed`; if still `pending`, retries with the same key |
| Two concurrent retries of the SAME key   | "concurrent retries... collapse into exactly ONE reservation" | both callers observe success; `realEffects === 1`; refunded total 500, not 1000      |

## 10. Concurrency Regression Results (Task 14 — A4 must remain green)

Re-run against the fixed code, both directly and folded into `refund-idempotency.test.ts`'s own
"A4 concurrency regression" block:

- 700 + 700 (captured 1000) → exactly one PSP refund, one rejection — **pass**
- 500 + 500 → both succeed, two PSP calls, total 1000 — **pass**
- 500 + 600 → exactly one succeeds, never 1100 — **pass**
- 1000 + 1000 → only one succeeds — **pass**
- 50ms-latency variant — **pass**
- PSP failure releases the reservation, capacity is reusable — **pass**
- PSP idempotency key still derived from the durable reservation id — **pass**
- Regression matrix (partial/full/excessive/unknown-intent) — **pass**

All 8 original `refund-concurrency.test.ts` tests plus the 3 duplicated-for-documentation A4 tests
in the new file passed on every one of 3 repeated runs (checked explicitly for flakiness given the
timing-sensitive nature of these `Promise.all`-based races — see §16 for the one flake observed,
and only against reverted/pre-fix code during verification, never against the shipped fix).

## 11. Security Boundary Findings (Task 11)

Verified by reading the actual call chain, not assumed:

- **Choose another Refund ID** — impossible; `Refund.id` is always minted server-side
  (`idGenerator.generate()`), never caller-supplied.
- **Reuse another customer's Refund ID / idempotency key** — the lookup is scoped to
  `this.props.refunds` on the _specific_ `PaymentIntent` being refunded (found via
  `paymentIntentId`, itself resolved server-side from `orderRef` in `PrismaPaymentsPortAdapter`,
  never caller-supplied) — a key cannot be replayed across intents to reach someone else's refund.
- **Change the payment intent behind an existing Refund** — not possible; a `Refund` is a child
  entity of exactly one `PaymentIntent`, addressed by that intent's own id.
- **Change refund amount after reservation** — rejected: `existing.amount.equals(amount)` is
  checked before reusing a match; a mismatch throws `BusinessRuleError` before any PSP call
  (proven by the "reusing a key with a DIFFERENT amount" test).
- **Change currency after reservation** — `Money.equals()` compares currency structurally as part
  of the same check; a currency change is a subset of "different amount" for this purpose.
- **Bypass PSP idempotency by changing request metadata** — the PSP-facing key is derived
  server-side (`${paymentIntentId}:refund:${refund.id}`) from values the caller cannot set
  directly; only the _lookup_ key (`idempotencyKey`) is caller-supplied, and it only ever resolves
  to a _pre-existing, already-validated_ reservation or creates a brand new one under the normal
  capacity check — it cannot be used to relabel an unrelated reservation.
- **Ownership boundary** — enforced one layer up, unchanged by this phase: `orderRef` →
  `PaymentIntent` resolution happens inside `PrismaPaymentsPortAdapter`, tenant-scoped
  (`tenantId` in the Prisma `where` clause), before this phase's code ever runs.

## 12. Production Composition (Task 12)

Verified against the actual wiring files, not assumed:

```
apps/runtime/src/api.ts  (real process entrypoint, startApi())
  paymentsPort: buildReturnsPaymentsPortAdapter(runtime)      <- real PrismaPaymentsPortAdapter
  refundVerification: new PrismaRefundVerificationAdapter(...) <- real, Phase A.2
       |
       v
apps/admin/src/composition.ts  wireAdmin(deps) -> wireReturns(deps)
       |
       v
services/returns/src/composition.ts
  paymentsPort = deps.paymentsPort ?? new InMemoryPaymentsAdapter()   <- real adapter wins when present
  decideResolution: new DecideResolution({ ..., paymentsPort, refundVerification })
```

This is the real production chain — `DecideResolution`'s `idempotencyKey` genuinely reaches the
fixed `PrismaPaymentsPortAdapter`, which genuinely reaches the fixed `RefundPaymentLifecycle`, in
the actual `apps/runtime` process, not only in unit tests. `apps/runtime/src/composition.test.ts`
(46 tests, including the two updated + one new `PrismaPaymentsPortAdapter` test) passed against
this exact composition.

## 13. Repository-Wide Refund Path Inventory (Task 15)

Searched the whole repository (excluding `node_modules`) for `requestRefund`, `idempotencyKey`,
`refundId`, `RefundPaymentLifecycle`, PSP/Stripe refund calls, and alternative/legacy refund paths:

| Path                                                                                                 | Reachable?                                                                                                                                                                | PSP call?                                                               | Protected by this phase?                                                                                    | Status                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Returns `DecideResolution` → `PrismaPaymentsPortAdapter` → `RefundPaymentLifecycle`                  | Yes — real production HTTP surface (`POST /returns/:id/resolution`)                                                                                                       | Yes                                                                     | **Yes**                                                                                                     | Fixed                                                                                                     |
| Admin HTTP `POST /payment-intents/:id/refund` → `PaymentsAdminController.refund` → `refundLifecycle` | Yes — real production HTTP surface, `payments:refund` permission                                                                                                          | Yes                                                                     | **No** — `refundBody` zod schema has no `idempotencyKey` field; a direct HTTP retry still mints a fresh key | **Open — see §16**                                                                                        |
| Legacy `RefundPayment` use case (`PaymentController.refund` → `PaymentIntent.refund()`)              | **No** — not wired to any HTTP route (grepped every `*-routes.ts`); only reachable from unit tests                                                                        | No — this path never calls `PaymentProvider` at all                     | N/A (no PSP call, nothing to make idempotent)                                                               | Dead code in production, pre-existing, out of scope (unrelated flow)                                      |
| Temporal `PurchaseSagaActivities.refundPayment` (saga compensation)                                  | **No** — interface only; grepped for an implementing object literal repository-wide, found none outside `purchase-saga.test.ts`'s fake (`async () => log.push("refund")`) | Unknown — no implementation exists to call anything                     | N/A — not implemented                                                                                       | Unimplemented, not a live risk; flag for whoever wires a real Temporal activity worker later              |
| Orders `RefundOrder` use case (`order.refund()`)                                                     | Reachable in principle (not checked for an HTTP route — Orders is explicitly out of scope for this phase)                                                                 | No — pure Orders-domain status bookkeeping, no Payments/PSP interaction | N/A                                                                                                         | Unrelated concept (order status, not money movement); untouched per the "do not modify Orders" constraint |
| `StripePaymentProvider.refund()` (the actual PSP call)                                               | N/A — infrastructure, not an entry point                                                                                                                                  | Is the PSP call                                                         | Forwards `idempotencyKey` correctly (verified, §6)                                                          | Unchanged, already correct                                                                                |

**No duplicate _production_ refund-to-PSP path exists.** Exactly one real path moves money via the
PSP (`RefundPaymentLifecycle`), reached by two different callers (Returns — now fixed; direct admin
HTTP — still open, §16).

## 14. Test Matrix (Task 8)

`services/payments/src/refund-idempotency.test.ts`, 11 tests:

1. Exploit proof — no key, two retries, two PSP identities, double refund (§4)
2. Same key on retry → one PSP call, one refund total (Scenario B)
3. Scenario A — crash before settle, retry reuses same PSP key
4. Reusing a key after `failed` is rejected; a new key succeeds (Scenario C)
5. Reusing a key with a different amount is rejected (Task 11)
6. Two different keys never collide, even concurrently (Scenario D)
7. Concurrent retries of the _same_ key collapse into one reservation, one real effect
8. Omitting `idempotencyKey` preserves pre-A.5 behavior (additive-only)
   9–11. A4 regression trio (700+700, 500+500, PSP-failure-releases-capacity) re-proven unaffected

Plus `apps/runtime/src/composition.test.ts`: 1 new test (`idempotencyKey` survives the bridge
unchanged across two calls) + 2 existing tests updated to assert the field is now present.

## 15. Quality Gates (Task 16)

All run for real, output inspected directly (not fabricated):

| Gate               | Scope                         | Result                                                                                                                                                  |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`   | full monorepo, 78 packages    | **78/78 successful** (43 cache hits before a forced re-run with the regenerated Prisma client, then re-verified 10/10 forced on the 5 touched packages) |
| `pnpm test`        | full monorepo, 78 packages    | **78/78 successful**, zero failures                                                                                                                     |
| `pnpm lint`        | full monorepo, 78 packages    | **78/78 successful**                                                                                                                                    |
| `pnpm arch`        | `depcruise packages services` | **0 violations**, 1564 modules / 6787 dependencies cruised                                                                                              |
| `pnpm governance`  | —                             | **Does not exist in this checkout** — reporting honestly per instructions, not fabricating a result                                                     |
| `pnpm dup`         | —                             | **Does not exist in this checkout** — same                                                                                                              |
| Targeted: Payments | `services/payments`           | 6 files, **45/45** tests pass (incl. new suite)                                                                                                         |
| Targeted: Returns  | `services/returns`            | 3 files, **16/16** tests pass                                                                                                                           |
| Targeted: Runtime  | `apps/runtime`                | 30 files, **166/166** tests pass                                                                                                                        |
| Targeted: Admin    | `apps/admin`                  | 9 files, **111/111** tests pass                                                                                                                         |

The Prisma client was regenerated (`prisma generate`, schema-only — no live database needed) from
the updated `payments.prisma` to make sure the new `Refund.idempotencyKey` field type-checks
against real generated types, not just hand-written interfaces; typecheck+test were re-run with
`--force` (cache bypassed) afterward and stayed green. No live Postgres/Docker is available in this
sandbox (consistent with prior sessions' findings in memory) — the actual migration was generated
but not applied or run against a live database.

## 16. Remaining Risks

1. **Admin HTTP refund route is not yet protected** (§13). `POST /payment-intents/:id/refund`
   calls the same now-idempotency-aware `RefundPaymentLifecycle`, but its request body has no
   `idempotencyKey` field, so a direct HTTP client retry (ops tooling, a impatient operator
   double-clicking, a proxy-level retry) still reproduces the exact vulnerability class Task 2
   proved. This is a real, reachable gap — deliberately not fixed here because it sits outside this
   phase's explicit mandate (which named the Returns → Payments bridge specifically, and the
   constraints forbid unrequested public-API changes) — flagged for the next phase.
2. **Exactly-once is bounded by Stripe's own idempotency-key retention**, not provable from inside
   this codebase (§6). No live Stripe sandbox was available to verify this directly in this
   session (consistent with the deferred-to-user Stripe sandbox validation noted in the C2-2
   sprint).
3. **No live Postgres** in this sandbox — the new unique constraint
   `(intent_id, idempotency_key)` was verified via schema-only `prisma generate` (succeeded) and
   via the Postgres-emulating in-memory fake (same methodology already established by A4), not
   against a real database engine.
4. **A `pending`-resume can still physically call the PSP twice** (once per retry) — by design
   (§8, Scenario B): this codebase cannot distinguish "never sent" from "sent, response lost," so
   it always re-presents the same key rather than guessing. The _identity_ is guaranteed stable;
   the _call count_ is not, and correctness depends on the PSP's own dedup (§6).
5. **One timing-sensitive test flake was observed**, but only when the fix's own source files were
   deliberately reverted during verification (§4) — never against the shipped code, which passed
   3/3 repeated runs. Documented for transparency, not treated as a defect in the shipped fix.
6. **Temporal saga `refundPayment` activity has no real implementation anywhere** (§13) — not a
   live risk today, but whoever eventually wires a real activity worker for it must thread an
   idempotency key through from the start (Temporal's own at-least-once activity retry policy makes
   this exactly the same class of bug if skipped).

## 17. Production Readiness Verdict

**CONDITIONALLY PRODUCTION READY**

The system is materially protected for its actually-specified scope: the Returns → Payments refund
bridge (the only path this phase was asked to close) now preserves one logical refund → one PSP
idempotency identity across full-request crash/timeout retries, verified by a red-then-green test
suite, with the Phase A.4 concurrency guarantees fully intact and every quality gate green across
the entire monorepo. It falls short of an unconditional **PRODUCTION READY** for two disclosed
reasons that match the spec's own conditional criteria: an external PSP limitation (final
exactly-once behavior is bounded by Stripe's own idempotency-key guarantee, unverifiable without a
live Stripe sandbox in this environment) and one further scope-bounded gap this session's own
inventory surfaced but was not authorized to fix (the admin HTTP refund route, §16 item 1).
