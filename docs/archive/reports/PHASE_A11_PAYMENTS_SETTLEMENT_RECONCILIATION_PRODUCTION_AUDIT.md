# Phase A.11 — Payments Settlement & Webhook Production Readiness Audit

**Date:** 2026-08-12
**Scope:** `services/payments`, `packages/psp-stripe`, `packages/db/prisma/schema/payments.prisma` + migrations, `apps/admin/src/http/payments-*`, `apps/runtime` Payments composition.
**Mode:** Runtime Verification / Production-Readiness Audit (evidence-first, no invented files/APIs, fixes only for demonstrated defects — see `lumo-principal-architect-persona` / `lumo-engineering-constitution`).
**Predecessors:** A.4 (refund concurrency), A.5 (refund idempotency), A.6 (direct refund HTTP idempotency), A.7 (PostgreSQL schema/migration audit), A.8 (capture concurrency), A.9 (capture crash recovery), A.10 (refund reconciliation + Stripe webhook correlation).

---

## 1. Executive Summary

Phase A.11 re-audited the full Payments settlement/webhook surface end-to-end against the 24-task
brief and found **three genuine, previously-undiscovered defects**, all now fixed with regression
tests, plus **one genuine schema/migration drift** (same class as A.7's), also fixed. Everything else
the brief asked to "prove" was already correctly built and covered by A.4–A.10's tests; this phase
re-verified those claims against current code rather than re-stating them uncritically, and found them
all still accurate.

**New defects found and fixed this phase:**

1. **HIGH — Webhook-after-success throws instead of no-op'ing** (Task 11). A duplicate-_kind_
   webhook delivered under a genuinely different Stripe event id (not caught by the
   `(provider, eventId)` dedup) for a status the intent already reached threw an uncaught
   `BusinessRuleError` instead of being a safe idempotent no-op, for every kind except `captured`.
2. **HIGH — `AuthorizePayment` has no idempotency protection of its own** (Task 1/14). Unlike
   capture/refund, a retried `/authorize` call reaching the domain twice (missing `Idempotency-Key`
   header, expired transport cache, or a second admin action) threw the same class of error as (1).
3. **MEDIUM/INFORMATIONAL — cross-resource idempotency-key collision in the shared HTTP transport**
   (Task 14/16). Documented, not fixed — it lives in `packages/http` (261 call sites across 38
   files, every bounded context), outside Payments' scope per this phase's absolute constraints.
4. **LOW — `PaymentIntent.pspReference` index declared in Prisma but never migrated** (Task 9), the
   same drift class A.7 found for `Refund.status`. Fixed with an additive migration.

**Verdict: CONDITIONALLY PRODUCTION READY** — unchanged from every prior phase. The condition is,
as always, that PostgreSQL/Stripe production behavior has not been verified against real
infrastructure in this sandbox (no Docker host, confirmed `P1001` below). Everything provable without
live infra has been proven, with regression tests, in this phase.

---

## 2. Current Architecture (unchanged this phase)

Payments is a single bounded context (`services/payments`) on Clean Architecture: domain
(`PaymentIntent` aggregate + `Charge`/`Refund`/`PaymentAttempt` entities) → application (use cases) →
infrastructure (Prisma repository + in-memory fake) → interfaces (`PaymentController`, framework-
agnostic). One external port, `PaymentProvider` (`@platform/contracts`, ADR-0012), abstracts the PSP;
`StripePaymentProvider` (`packages/psp-stripe`) is the production adapter (raw REST, no SDK, D-048).
Payments never posts to Finance/Orders/Notifications directly — only through reference-only outbound
ports (`FinancePort`/`OrdersPort`/`NotificationPort`), called best-effort (`notifyBestEffort`) so a
downstream failure never fails the payment transition itself.

Webhook ingress exists **only** in `apps/admin` (`POST /payments/webhook`,
`payments-webhook-routes.ts`) — `apps/runtime` has no webhook route of its own. This is an existing
architecture fact (Stripe is configured against the admin/backend surface), not a defect.

---

## 3. Payment State Machine (Task 1)

`PaymentStatusValue` (`domain/value-objects/payment-status.ts`) is a 12-value closed union covering
two co-existing lifecycles: the **legacy** 4-state path (`requires_payment → captured|failed →
refunded`, used by the unhardened `CapturePayment`/`FailPayment`/`RefundPayment` use cases — dead
code, see §22) and the **full Sprint 4.8 lifecycle** actually reachable from every wired composition
root:

```
created → processing → authorized → capture_requested → captured → partially_refunded → refunded → closed
                ↓            ↓                              ↓            ↓
              failed     cancelled/expired                closed       closed
                ↓
            processing (retry)
```

Full transition table (`TRANSITIONS`, `payment-status.ts`):

| From                 | Legal To                                    |
| -------------------- | ------------------------------------------- |
| `requires_payment`   | `captured`, `failed`                        |
| `captured`           | `refunded`, `partially_refunded`, `closed`  |
| `failed`             | `processing`                                |
| `refunded`           | `closed`                                    |
| `created`            | `processing`, `cancelled`                   |
| `processing`         | `authorized`, `failed`                      |
| `authorized`         | `capture_requested`, `cancelled`, `expired` |
| `capture_requested`  | `captured`, `failed`                        |
| `cancelled`          | `closed`                                    |
| `expired`            | `closed`                                    |
| `partially_refunded` | `refunded`, `closed`                        |
| `closed`             | _(terminal)_                                |

**Design property, confirmed and now correctly handled everywhere (see §11):** no status has a
self-transition. This is intentional (a self-loop is not a "move"), but it means every entry point
that calls the generic `transition()` unconditionally on a webhook/retry must itself guard against
re-presenting an already-reached status — `CapturePaymentLifecycle.settle()` already did
(`alreadyCaptured`); `RecordWebhook` and `AuthorizePayment` did not, until this phase (§11, §14).

Per-transition trace (initiating use case → route → domain method → repository write → version check
→ PSP call → event → side effects), for every reachable edge:

| Transition                                  | Use case                                                             | HTTP route                                                                                      | Domain method                 | PSP call                                                           | Event                                        | Side effects                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `created` (open)                            | `CreatePaymentIntentLifecycle`                                       | `POST /payment-intents`                                                                         | `createIntent`                | `createIntent` (deterministic `<id>:create` key)                   | none (no domain event on create)             | none                                                                                                            |
| `→ processing`                              | `AdvancePayment`                                                     | _(not routed — saga/internal)_                                                                  | `transition`                  | none                                                               | `payment.transitioned`                       | best-effort notify                                                                                              |
| `→ authorized`                              | `AuthorizePayment`                                                   | `POST /:id/authorize`                                                                           | `authorize`                   | none (PSP already authorized upstream; this records the reference) | `payment.transitioned`                       | none (fixed this phase to short-circuit safely on retry, §14)                                                   |
| `→ capture_requested` (reserve)             | `CapturePaymentLifecycle.reserve`                                    | _(internal step of)_ `POST /:id/capture`                                                        | `requestCapture`              | none — durably committed **before** the PSP call (A.8)             | `payment.transitioned`                       | none                                                                                                            |
| _(PSP capture, outside any tx)_             | `CapturePaymentLifecycle.execute`                                    | —                                                                                               | —                             | `paymentProvider.capture` (`<id>:capture`)                         | —                                            | —                                                                                                               |
| `→ captured` (settle)                       | `CapturePaymentLifecycle.settle`                                     | _(internal)_, or `RecordWebhook` when `captureSettlement` is wired (always, in production — §5) | `markCaptured`                | none                                                               | `payment.captured`                           | Charge row, best-effort Orders/Notifications, Finance record — all idempotency-guarded (`alreadyCaptured`, A.9) |
| `→ refunded`/`partially_refunded` (reserve) | `RefundPaymentLifecycle.reserve`                                     | _(internal step of)_ `POST /:id/refund`                                                         | `requestRefund`               | none — durably committed before the PSP call (A.4)                 | `refund.transitioned` (`requested`)          | none                                                                                                            |
| _(PSP refund, outside any tx)_              | `RefundPaymentLifecycle.execute`                                     | —                                                                                               | —                             | `paymentProvider.refund` (`<id>:refund:<refundId>`)                | —                                            | —                                                                                                               |
| `→ refunded`/`partially_refunded` (settle)  | `RefundPaymentLifecycle.settle`                                      | _(internal)_                                                                                    | `completeRefund`/`failRefund` | none                                                               | `refund.transitioned` (`completed`/`failed`) | best-effort notify, guarded (`alreadySettled`, A.10) — **no Finance record** (§18)                              |
| `→ failed`/`cancelled`/`expired`            | `RecordWebhook` (webhook only — no HTTP mutation route drives these) | `POST /payments/webhook`                                                                        | `transition`                  | none                                                               | `payment.transitioned`                       | none beyond the attempt log                                                                                     |
| `→ closed`                                  | `AdvancePayment`                                                     | _(not routed)_                                                                                  | `transition`                  | none                                                               | `payment.transitioned`                       | best-effort notify                                                                                              |

**Illegal/self/retry/webhook-timing transitions, explicitly proven (test evidence cited, not
asserted):**

- Illegal cross-status (e.g. `cancelled → failed`): rejected, `BUSINESS_RULE` —
  `webhook-ordering-idempotency.test.ts`, `authorize-retry-idempotency.test.ts`.
- Self-transition after genuine success, same status re-presented under a **new** event id: **found
  broken, fixed this phase** — §11, §14.
- Webhook-after-webhook (identical event id, true duplicate): idempotent via `ProcessedWebhookStore`
  — `capture-crash-recovery.test.ts` (Task 12 describe block), `webhook-identifier-correlation.test.ts`.
- Webhook-after-cancellation / webhook-after-failure: both terminal-ish states have no further
  webhook-driven forward edge except to `closed` (not webhook-driven at all) — a webhook whose kind
  maps to anything else is correctly rejected as illegal (verified,
  `webhook-ordering-idempotency.test.ts`'s third case).

No changes were made to the transition table itself — every fix this phase is an application-layer
guard in front of it, per the absolute constraint against redesigning the state machine.

---

## 4. Capture Analysis (Task 2)

`CapturePaymentLifecycle` (A.8/A.9) is the reserve → PSP-call → settle pattern, fully re-verified
unchanged this phase. Scenario-by-scenario, against **existing** tests (re-run, still green — not
re-written):

- **Scenario A** (DB reservation commits, PSP succeeds, crash before settle): webhook recovers fully
  (Charge + Finance + notify), proven in `capture-crash-recovery.test.ts` ("Task 3 — exploit proof").
- **Scenario B** (reservation commits, PSP fails, crash before settle): a fresh capture attempt
  resumes from `capture_requested` and retries the PSP call under the _same_ deterministic key —
  `capture-concurrency.test.ts` ("Task 4/18 Scenario D").
- **Scenario C** (settle runs twice): exactly one Charge/notify/Finance/event — `alreadyCaptured`
  guard, `capture-crash-recovery.test.ts` ("Task 12"), `capture-concurrency.test.ts` ("Task 3/20").
- **Scenario D** (webhook first, retry second): both converge, one Charge, one Finance record —
  `capture-crash-recovery.test.ts` ("Task 11").
- **Scenario E** (retry first, webhook second): same convergence, reversed order — same file.

The PSP capture key (`<intentId>:capture`) is fully deterministic — never derived from a per-attempt
id — so unlike the pre-A.5 refund bug, capture was never at risk of presenting the PSP two different
identities for one logical capture.

---

## 5. Refund Analysis (Task 3)

`RefundPaymentLifecycle` (A.4/A.5/A.10) mirrors capture's shape, adapted for partial amounts (a
durable `pending` reservation, not just a status flag). Re-verified against
`refund-concurrency.test.ts` (A.4 — concurrent-amount matrix, PSP-failure release, deterministic
key-from-reservation-id) and `refund-duplicate-side-effects.test.ts` (A.10 — concurrent same-key
settle, sequential re-settle, no duplicate event/attempt-log entry).

**Standing, documented (not new, re-confirmed) gap:** there is **no webhook-driven refund recovery**.
`KIND_TO_STATUS` has no `refunded` entry and `STRIPE_TYPE_TO_KIND` has no `charge.refunded` mapping —
by design, no `refundSettlement` capability is wired anywhere (mirroring `captureSettlement` for
capture). If a refund's PSP call succeeds but the process crashes before `settle()` commits, the
**only** recovery path is a caller retry with the same `idempotencyKey` (safe since A.5/A.10) — there
is no automatic webhook-driven repair the way capture has. Building one would need a new capability +
event mapping: real scope expansion with zero demonstrated production incident behind it, so per the
absolute constraints (no new event contracts without a demonstrated defect) this phase does **not**
build it — it is flagged here again so it stays visible rather than silently re-buried.

`RefundPaymentLifecycle.settle()` still never calls `FinancePort.recordPaymentEvent` (unlike Capture's
settle) — a pre-existing completeness gap, not a duplication risk (see §18).

---

## 6. Webhook Analysis (Tasks 4–6)

**Correlation (Task 4).** Traced `payments-webhook-routes.ts` → `RecordWebhook.execute()` →
`PaymentIntentRepository`. A real Stripe webhook's `data.object.id` is Stripe's own `pi_...`
reference, never our domain id. `RecordWebhook` tries `findById` first (backward-compatible for any
caller that already knows the domain id), then falls back to `findByPspReference` (A.10) — proven
correct and proven to fail closed (`NOT_FOUND`, untouched unrelated record) on an unknown reference:
`webhook-identifier-correlation.test.ts`. Grepped every `pspReference`/`paymentIntentId`/`pi_`/charge-
id/refund-id lookup in the repo — no other inconsistent identifier usage found; Charge/Refund ids are
never looked up independently (always reached via the owning `PaymentIntent`).

**Idempotency matrix (Task 5).** Only events the code actually supports:

| Event                                                     | First delivery                                                                 | Duplicate delivery (same eventId) | New eventId, same target status                                               | Expected           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------- | ------------------ |
| `payment_intent.amount_capturable_updated` → `authorized` | transitions                                                                    | no-op (`ProcessedWebhookStore`)   | **was BUSINESS_RULE error → now no-op** (§11)                                 | idempotent         |
| `payment_intent.succeeded` → `captured`                   | settles via `captureSettlement` (always wired in production, §buildController) | no-op                             | no-op (settle's own `alreadyCaptured` guard — never reaches the generic path) | idempotent         |
| `payment_intent.payment_failed` → `failed`                | transitions                                                                    | no-op                             | **was BUSINESS_RULE error → now no-op** (§11)                                 | idempotent         |
| `payment_intent.canceled` → `cancelled`                   | transitions                                                                    | no-op                             | **was BUSINESS_RULE error → now no-op** (§11)                                 | idempotent         |
| _(unrecognized type, e.g. `charge.refunded`)_             | recorded verbatim, no transition                                               | no-op                             | recorded verbatim, no transition (harmless)                                   | correct, by design |

`refund.updated`/`charge.refunded` are **not** mapped to any transition — confirmed, not assumed (no
speculative Stripe-behavior claims): grepped `STRIPE_TYPE_TO_KIND` and `KIND_TO_STATUS`, neither
contains a refund-facing entry.

**Duplicate financial side effects (Task 6).** Every settlement side effect (Charge row, Finance
record, notify, domain event, attempt-log entry) was audited for its guard:

| Side effect                  | Guarded by                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| Charge row                   | `alreadyCaptured` (capture) — state guard, before write                                              |
| Refund row status transition | `alreadySettled`/`alreadyCompleted` (refund) — state guard, before write                             |
| Finance record               | Same `alreadyCaptured` guard (capture only — refund never calls Finance, §18)                        |
| Notification/Orders          | Same guard, both capture and refund                                                                  |
| Domain event                 | Same guard — no event emitted on a no-op path                                                        |
| `ProcessedWebhookStore` row  | DB unique constraint `(tenantId, provider, eventId)` — insert-race-safe (`P2002` treated as success) |

All proven with concurrent-delivery tests (`refund-duplicate-side-effects.test.ts`,
`capture-crash-recovery.test.ts` "Task 12").

---

## 7. Idempotency Analysis (Tasks 13–14, 16)

**PSP idempotency keys (Task 13)**, traced through `StripePaymentProvider`
(`packages/psp-stripe/src/stripe-payment-provider.ts`): every mutating call (`createIntent`,
`capture`, `cancel`, `refund`) sends `Idempotency-Key` (Stripe's own 24h dedup). Sources:

| Operation      | Key                                            | Deterministic?                                                                                                                | Reused on retry?                                                                                                                                        |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createIntent` | `<domainId>:create`                            | Yes, but `domainId` is **freshly minted per call** (no domain-level create-idempotency exists)                                | **No** — a create retry mints a new domain id and thus a new PSP key. Retry-safety for this route depends entirely on the HTTP-transport cache (§ next) |
| `capture`      | `<intentId>:capture`                           | Yes — pure function of the existing intent id                                                                                 | Yes                                                                                                                                                     |
| `refund`       | `<intentId>:refund:<refundId>`                 | Yes once `refundId` is durably reserved; `refundId` is itself resumed (not re-minted) when `idempotencyKey` is supplied (A.5) | Yes, when the caller supplies `idempotencyKey`                                                                                                          |
| `cancel`       | _(not called by any lifecycle use case today)_ | —                                                                                                                             | —                                                                                                                                                       |

**HTTP idempotency (Task 14).** Two different mechanisms coexist on the Payments HTTP surface:

1. **Refund route** (`POST /:id/refund`) — bespoke, A.6: requires `Idempotency-Key` header, fails
   closed (422) if missing/empty, threads the key into the domain (`PaymentIntent.requestRefund`)
   which rejects a reused key against a **different amount** (`BUSINESS_RULE`). Verified still
   correct, unchanged.
2. **Create/authorize/capture routes** — generic transport-level `idempotent: true`
   (`packages/http/src/server.ts:349-381`): `cacheKey = \`tenant:${tenantId}:idem:${idempotencyKey}\``
   (line 352), response-replay on a cache hit, a claim/release lock against concurrent in-flight
   duplicates. **Two defects found here:**
   - **(a) Missing key ⇒ zero protection**, not fail-closed: `if (route.idempotent === true &&
idempotencyKey !== null)` (line 351) — when the header is absent, the whole block is skipped
     and the handler runs with no dedup at all. This is inconsistent with the refund route's explicit
     fail-closed convention, and it is the reason `AuthorizePayment`'s own lack of idempotency
     (§ next) is reachable in production, not just in a contrived test.
   - **(b) Same key, different resource ⇒ wrong cached response returned** (Task 14's own "same key
     - different PaymentIntent" test case): the cache key has **no route/resource discriminator at
       all** — only `(tenantId, idempotencyKey)`. A client reusing an `Idempotency-Key` value across
       two different payment intents (or even two different routes) on the same tenant would receive
       the **first** call's cached response for the **second**, unrelated request. Confirmed by direct
       code inspection of the single line above (deterministic, not a race — no test scaffolding needed
       to establish this as fact). **Not fixed in this phase** — see §13 (Security Findings) for why,
       and §17/§Remaining Risks for the recommended follow-up.

**Cross-caller idempotency collision (Task 16).** The **domain-level** mechanisms (refund's
`idempotencyKey`, `PaymentIntent.requestRefund`'s lookup) are scoped **per payment intent**
(`this.props.refunds.find(...)`, backed by the DB unique constraint `@@unique([intentId,
idempotencyKey])`) — two different intents reusing the same key value is safe by construction, proven
by the schema itself, no test needed to demonstrate a non-collision. The **transport-level** mechanism
described in (b) above is the one place a real cross-resource collision exists, and it is a shared
platform primitive, not Payments-owned (see §13).

---

## 8. PostgreSQL Analysis (Tasks 7–8)

**Optimistic concurrency (Task 7).** `PrismaPaymentIntentRepository.save` (lines 40-60): first write
is `create`; every subsequent write is `updateMany({ where: { id, tenantId, version },
data: { ..., version: { increment: 1 } } })`, throwing `ConcurrencyError` when `updated.count === 0`.
This is the exact contract `PostgresLikePaymentIntentRepository` (the shared fake across
`refund-concurrency.test.ts`/`capture-concurrency.test.ts`/`capture-crash-recovery.test.ts`/
`refund-duplicate-side-effects.test.ts`/`webhook-identifier-correlation.test.ts`/
`webhook-ordering-idempotency.test.ts`/`authorize-retry-idempotency.test.ts`) reproduces faithfully —
version mismatch → throw, matching version → increment. This is a **faithful simulation of Postgres's
`WHERE ... AND version = ?` semantics**, not a claim that it _is_ Postgres — re-stated explicitly per
the task's own instruction not to conflate the two.

**Real PostgreSQL integration (Task 8).** Attempted: `npx prisma migrate status` against
`postgresql://user:pass@localhost:5432/placeholder` →

```
Error: P1001: Can't reach database server at `localhost:5432`
```

Identical failure class to every prior phase (A.5/A.7/A.9/A.10) — no Docker host in this sandbox.
`prisma validate` (schema-syntax-only, no connection required) **passes**, including this phase's new
index migration. `apps/runtime/scripts/c2-2-stripe-sandbox-validation.ts` exists (from C2-2) and would
exercise the real `StripePaymentProvider` against Stripe's test API + prove `verifyWebhook`'s crypto
against a real signature scheme, but requires user-supplied `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`
credentials never available in this environment.

**What is proven without Postgres:** every optimistic-lock, crash-recovery, and duplicate-delivery
scenario listed in §4–§6, against a fake that reproduces Postgres's `version`-check contract exactly.
**What remains unproven:** real MVCC/isolation-level behavior under genuine concurrent transactions,
real index usage/query plans, real trigger/constraint enforcement, and the actual Stripe webhook
delivery/retry/signature path end-to-end.

---

## 9. Migration Analysis (Tasks 9–10)

**Schema ↔ migration drift audit**, every `Refund`/`PaymentIntent`/`Charge`/`ProcessedWebhook`
constraint in `payments.prisma` checked against every migration file that touches
`payments"."payment_intents/refunds/charges/processed_webhooks/payment_attempts`:

| Constraint (schema)                                                                                | Migration                                                      | Status                                                                                   |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `PaymentIntent.@@unique([tenantId, idempotencyKey])`                                               | `20260726000000_sprint_a0_preconditions`                       | ✅ present                                                                               |
| `PaymentIntent.@@index([tenantId, orderRef])` / `@@index([tenantId, status])`                      | `20260704000000_init`                                          | ✅ present                                                                               |
| `PaymentIntent.@@index([tenantId, pspReference])` (added Phase A.10)                               | **none — no migration was ever generated**                     | ❌ **DRIFT — fixed this phase**, `20260811020000_payments_psp_reference_index`           |
| `Refund.status` column (+ default `"completed"`)                                                   | `20260811010000_payments_refund_status_column` (Phase A.7 fix) | ✅ present                                                                               |
| `Refund.idempotencyKey` + `@@unique([intentId, idempotencyKey])`                                   | `20260811000000_phase_a5_refund_idempotency`                   | ✅ present                                                                               |
| `Refund.status` `CHECK (status IN (...))` (documented in the schema's own doc comment as deferred) | —                                                              | Deliberately deferred, not new drift — documented in-schema, re-confirmed still deferred |
| `ProcessedWebhook.@@unique([tenantId, provider, eventId])`                                         | `20260712060000_payments_core_sprint48`                        | ✅ present                                                                               |
| `PaymentAttempt` table + FK + index                                                                | `20260712060000_payments_core_sprint48`                        | ✅ present                                                                               |

**Impact of the found drift:** unlike A.7's finding (a genuinely missing _column_, which would have
hard-errored every refund write against real Postgres), a missing _index_ does not break correctness
— `findByPspReference`'s query still returns correct results via a sequential scan. It is a
**production performance** gap sitting directly on the Stripe webhook ingress hot path (every
`payment_intent.*` webhook that doesn't already know the domain id hits this exact query). Fixed with
a purely additive `CREATE INDEX` migration, mirroring A.7's precedent exactly (see the new migration
file's own doc comment for the full justification). No existing migration was rewritten (all already
shipped).

**Migration safety (Task 10):** every Payments migration reviewed — all are additive (`ADD COLUMN`
nullable / `ADD COLUMN ... DEFAULT` / `CREATE INDEX` / `CREATE UNIQUE INDEX` on new nullable columns).
None drop, rename, or narrow an existing column; none add a `NOT NULL` column without a default; none
touch an enum. No migration in this set risks locking a large table beyond a standard index build (the
one `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT 'completed'` from A.7 is a Postgres 11+
metadata-only operation, documented as such in its own file). Nothing here needed rewriting.

---

## 10. Concurrency Analysis (Tasks 7, 15/16 context, 19)

Covered in depth in §4–§8. Summary: every mutating path that touches money (capture, refund) is
reserve-then-PSP-then-settle, each step its own committed transaction, PSP calls always outside an
open transaction (`TrackingUnitOfWork` proof, `capture-concurrency.test.ts`), optimistic locking
(`version`) is the sole serialization mechanism (no new lock service — none was needed, none was
added, per the absolute constraints). Every crash-window scenario in Tasks 2/3/19 (before/after
reservation, before/after PSP call, before/after settlement) is either covered by an existing passing
test or — for the one genuinely new gap found (§11) — now covered by a new one.

---

## 11. Financial Invariants (Task 17) & Webhook Ordering Defect (Task 11) — Fixes Implemented

### 11.1 `totalRefunded <= totalCaptured` and boundary cases

Re-proven unchanged: `PaymentIntent.remaining()` (`domain/payment-intent.ts:389-397`) is the single
authoritative computation (captured minus non-failed refunds), consumed by `requestRefund`'s
`amount.isGreaterThan(this.remaining())` guard. Boundary cases from `refund-concurrency.test.ts`:
refund == remaining (Case 4, exact consumption), refund < remaining (Case 1/3, partial), refund >
remaining (Case 3/regression matrix, rejected pre-PSP-call), two refunds exactly consuming remaining
(Case 2, 500+500=1000), two refunds exceeding remaining (Case 1, 700+700 — only one wins). All hold
under real concurrency (`Promise.all`), not just sequentially.

### 11.2 Defect: webhook-after-success threw instead of no-op'ing (Task 11)

**Root cause.** `RecordWebhook.execute()` called `intent.transition(toStatus, ...)` unconditionally
whenever a webhook's mapped `kind` produced a `toStatus` and `captureSettlement` wasn't handling it.
Since no status has a self-transition (§3, by design), a **second, genuinely distinct** webhook event
(different `eventId` — e.g. Stripe emitting two separate `payment_intent.payment_failed` events for
two different failed attempts on one intent) that mapped to a status the intent had **already**
reached threw an uncaught `BusinessRuleError` instead of being recorded as a harmless no-op.
`ProcessedWebhookStore`'s `(provider, eventId)` dedup does not catch this case — it is a different
event, not a redelivery.

**Exploit/reproduction.** `webhook-ordering-idempotency.test.ts`: seed an intent, send `kind: "failed"`
twice with different `eventId`s — pre-fix, the second call returned `ok: false` /
`code: "BUSINESS_RULE"`. Confirmed failing before the fix (isolated test run), confirmed passing after.

**Minimal fix.** `record-webhook.use-case.ts`: added `intent.status.value !== toStatus` to the
existing condition gating `intent.transition(...)`. The webhook is still recorded (attempt log,
`recordWebhook()` call unaffected) — only the redundant, illegal `transition()` call is skipped.
A genuinely illegal cross-status webhook (current status differs and the transition table forbids the
move) is **unaffected** — still correctly rejected (third test case in the same file).

**Why this fix, alternatives rejected.** Adding self-transitions to `TRANSITIONS` itself was rejected:
it would make "no-op" and "real state" indistinguishable at the transition-table level for every
future caller of `transition()`, a broader semantic change than the narrow defect warrants. Guarding
at the call site (mirroring `CapturePaymentLifecycle.settle()`'s existing `alreadyCaptured` pattern)
is the smallest change that fixes exactly the demonstrated defect.

**Regression tests:** 3 new (`webhook-ordering-idempotency.test.ts`) — duplicate `failed`, duplicate
`cancelled`, and a control case proving illegal transitions still reject.

**Architectural impact:** none — purely additive application-layer guard, no event/API contract change.

### 11.3 Defect: `AuthorizePayment` has no idempotency protection (Task 1/14)

**Root cause.** `AuthorizePayment.execute()` called `intent.authorize(...)` unconditionally after
`findById`, with no check for "already authorized." Combined with the HTTP-transport gap in §7 (a
missing `Idempotency-Key` header gets **zero** protection, not fail-closed), a retried `/authorize`
call reaching the domain a second time hit the exact same "no self-transition" shape as §11.2.

**Exploit/reproduction.** `authorize-retry-idempotency.test.ts`: authorize an intent, then call
`AuthorizePayment.execute()` again with the identical input — pre-fix, the second call threw/returned
`BUSINESS_RULE`. Confirmed failing, then passing.

**Minimal fix.** In `AuthorizePayment.execute()`, before calling `intent.authorize(...)`: if the
intent is already `authorized`, compare the incoming `pspReference`/`authorizedAmountMinor` against
the stored ones. Identical ⇒ safe no-op (return current status, no write). Different ⇒ genuine
conflict, rejected with `BusinessRuleError` (mirrors `PaymentIntent.requestRefund`'s existing
"different amount" rejection pattern — not a new idea, a consistent application of an existing one).

**Regression tests:** 3 new — identical retry (no-op, single `authorize` attempt-log entry, not
duplicated), conflicting retry (different `pspReference`, correctly rejected, original untouched), and
a control case (re-authorizing an already-`captured` intent, still correctly rejected as illegal).

**Architectural impact:** none — same shape as capture/refund's existing resume patterns, no new
dependency, no event/API contract change.

### 11.4 `remaining = captured - successful refunds - pending reservations`

Verified: `remaining()` subtracts every non-`failed` refund, which **includes** `pending` ones — a
reservation durably shrinks capacity the instant it commits, before any PSP call (A.4's core
invariant). No change needed; re-confirmed via `refund-concurrency.test.ts`.

---

## 12. Failure/Restart Matrix (Tasks 12, 18, 19)

| Failure point                                     | Payment status                  | Charge | Refund          | Finance                                                                 | Notification | Repaired by                                                                         |
| ------------------------------------------------- | ------------------------------- | ------ | --------------- | ----------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| Capture: crash before reservation commits         | `authorized`                    | none   | —               | none                                                                    | none         | Caller retry (nothing was ever committed)                                           |
| Capture: crash after reservation, before PSP call | `capture_requested`             | none   | —               | none                                                                    | none         | Retry resumes reservation, re-calls PSP under same key                              |
| Capture: crash after PSP success, before settle   | `capture_requested`             | none   | —               | none                                                                    | none         | **Webhook** (`captureSettlement`, A.9) or retry — both converge, exactly one Charge |
| Capture: crash after settle commits               | `captured`                      | 1      | —               | 1 record                                                                | 1            | N/A — already consistent                                                            |
| Refund: crash before reservation commits          | `captured`/prior                | —      | none            | none                                                                    | none         | Caller retry (nothing committed)                                                    |
| Refund: crash after reservation, before PSP call  | `captured`/prior                | —      | 1 (`pending`)   | none                                                                    | none         | Retry (same `idempotencyKey`) resumes, re-calls PSP under same key                  |
| Refund: crash after PSP success, before settle    | `captured`/prior                | —      | 1 (`pending`)   | none                                                                    | none         | **Caller retry ONLY — no webhook path** (§5, standing gap, documented not fixed)    |
| Refund: crash after settle commits                | `refunded`/`partially_refunded` | —      | 1 (`completed`) | **none — settle() never calls FinancePort** (§5, pre-existing, not new) | 1            | N/A                                                                                 |

**Refund's Finance gap** is not a duplication risk (nothing to duplicate) but is a genuine
**completeness** gap: Finance's ledger never learns about a refund at all through this path, unlike
capture. Out of this phase's scope to fix (no demonstrated defect in _this_ audit's terms — it is a
missing feature, not a race/idempotency bug — flagged for a future phase, consistent with how A.10
flagged the adjacent "no webhook-driven refund recovery" gap without building it).

**Process-restart simulation (Task 19):** every "Instance A crashes, Instance B recovers" scenario for
capture is explicitly tested (`capture-crash-recovery.test.ts`, "Task 10 — process restart
simulation"); refund's equivalent is covered by the reservation/idempotency-key tests in
`refund-idempotency.test.ts`/`refund-duplicate-side-effects.test.ts` (a fresh `RefundPaymentLifecycle`
instance per call already models a fresh process).

---

## 13. Security Findings

| #   | Severity      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                       | Status                                |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| S1  | HIGH          | Webhook-after-success (new eventId, already-reached status) threw instead of no-op'ing for `authorized`/`failed`/`cancelled`/`expired` kinds                                                                                                                                                                                                                                                                                  | **FIXED** (§11.2)                     |
| S2  | HIGH          | `AuthorizePayment` had no domain-level idempotency; a retry reaching it twice threw the same class of error, reachable in production because the HTTP-transport idempotency cache silently no-ops when the `Idempotency-Key` header is absent                                                                                                                                                                                 | **FIXED** (§11.3)                     |
| S3  | MEDIUM        | Shared HTTP-transport `idempotent: true` cache key (`packages/http/src/server.ts:352`) is `(tenantId, idempotencyKey)` only — **no route or resource discriminator**. A client reusing a key value across two different payment intents (or routes) receives the wrong cached response. Also: a missing `Idempotency-Key` header disables the mechanism entirely rather than failing closed.                                  | **Documented, not fixed** — see below |
| S4  | LOW           | `PaymentIntent.pspReference` index declared in Prisma, never migrated (schema/migration drift, same class as A.7)                                                                                                                                                                                                                                                                                                             | **FIXED** (§9)                        |
| S5  | INFORMATIONAL | Payments composition pins one `tenantId` per process (`ADR-0008`, `TENANT_DEFAULT_ID`) — genuinely single-tenant-per-deployment by existing, documented design, not a new finding. Within that tenant, any staff principal holding `payments:refund`/`payments:capture` can act on any payment intent id — this is RBAC-by-design (admin backend, not customer-facing), not a bypass. No concrete authorization defect found. | No action — not a defect              |

**Why S3 is documented, not fixed, in this phase.** `idempotent: true` is used at 261 call sites
across 38 route files spanning every bounded context in `apps/admin` — Payments, Cart, Checkout,
Returns, Security, Licensing, and more. Phase A.11's absolute constraints explicitly forbid modifying
unrelated bounded contexts and changing public APIs without an additive-only path. There is no
additive fix to the shared cache-key formula that stays inside Payments' own files — the fix, by
construction, touches every consumer of the primitive simultaneously. This is exactly the class of
change the brief's constraints are designed to keep out of a narrowly-scoped Payments phase. It is
recorded here, with its exact file/line, as a real, precisely-located, concrete defect for a dedicated
cross-cutting follow-up (see Remaining Risks) — not silently dropped, not fixed out-of-scope either.

No card data, secrets, full PSP payloads, or customer PII are logged anywhere in the audited paths —
confirmed by grep (only tokenized `psp_token`/`payment_method.token` ever reach persistence, per G-27,
unchanged).

---

## 14. Performance Findings (Task 21)

- `findById` eager-loads charges/refunds/attempts in one Prisma query (`include`) — no N+1.
- `findByPspReference` was an unindexed sequential scan on the Stripe webhook hot path — **fixed**
  (§9). No other unindexed hot-path query found.
- Reserve/settle's two separate transactions (capture and refund) are a deliberate, already-justified
  design (A.4/A.8 fixed the _prior_ long-transaction anti-pattern by introducing this split) — not a
  new N+1 or inefficiency; re-confirmed correct, not re-litigated.
- No unbounded retries anywhere in the audited paths: `withConcurrencyRetry` is bounded
  (`MAX_CONCURRENCY_RETRIES = 5`), `notifyBestEffort` never retries (fails silently, by design).
- No benchmark run — no measurable bottleneck was found to benchmark; per the absolute constraint
  against optimizing without a demonstrated issue, none of the above needed further micro-optimization
  beyond the index fix.

---

## 15. Fixes Implemented (summary; full detail in §11)

| Fix                                        | File(s)                                                                                          | Root cause                                                                             | Regression tests                                         | Architectural impact                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Webhook self-transition no-op              | `services/payments/src/application/record-webhook.use-case.ts`                                   | Unconditional `transition()` call on a webhook whose target status was already reached | 3 new (`webhook-ordering-idempotency.test.ts`)           | None — additive guard                                                 |
| Authorize retry no-op / conflict rejection | `services/payments/src/application/payment-lifecycle.use-cases.ts`                               | No idempotency check before `intent.authorize()`                                       | 3 new (`authorize-retry-idempotency.test.ts`)            | None — additive guard, mirrors existing capture/refund resume pattern |
| `pspReference` index migration             | `packages/db/prisma/schema/migrations/20260811020000_payments_psp_reference_index/migration.sql` | Schema declared an index (Phase A.10) no migration ever created                        | N/A (schema/migration consistency, not runtime behavior) | None — purely additive `CREATE INDEX`                                 |

## 16. Fixes Intentionally Rejected / Deferred

- **Shared HTTP idempotency cache-key scoping (S3).** Rejected for this phase — out of Payments'
  bounded context, 261-call-site blast radius. Recommended as its own dedicated cross-cutting phase.
- **Webhook-driven refund settlement recovery (§5).** Rejected — real scope expansion (new
  capability + event mapping), zero demonstrated production incident, would duplicate the
  `captureSettlement` pattern speculatively rather than in response to a proven gap.
- **`RefundPaymentLifecycle.settle()` Finance recording (§12).** Rejected — a missing feature, not a
  race/duplication defect; flagged for a future phase rather than added speculatively here.
- **Adding self-transitions to `TRANSITIONS`.** Rejected in favor of call-site guards (§11.2) — a
  narrower, more precise fix for the actual defect.
- **New logging/observability plumbing (Task 20).** Rejected — see §17.

---

## 17. Remaining Risks / Environment Limitations

- **No structured logging in the payment lifecycle/webhook paths.** `PaymentLifecycleDeps`/
  `RecordWebhookDeps` carry no `Logger`. Production diagnosis relies entirely on the append-only
  `PaymentAttempt` table (kind/outcome/reference/occurredAt) and outbox domain events — there is no
  correlated log line carrying PSP reference + idempotency key + webhook event id + outcome at the
  point of failure. Not fixed: threading a `Logger` through would touch every use case's constructor
  and every composition root (`services/payments/src/composition.ts`, `apps/admin`, `apps/runtime`) —
  a real design change, not the "smallest safe fix" the brief calls for, and no concrete diagnosis
  failure was demonstrated (only the absence of the capability). Flagged for deliberate follow-up, not
  built speculatively.
- **S3 (§13)** — the shared HTTP idempotency-cache collision — remains open, precisely located, with
  its exact fix direction noted (scope the cache key by route/resource, not just the raw key; fail
  closed on a missing header, matching the refund route's own convention).
- **No live PostgreSQL or Stripe verification possible in this sandbox** (§8) — `P1001`, no Docker
  host, confirmed identically to every prior phase. Every claim in this report that depends on real
  infrastructure behavior is explicitly marked as such above, not asserted as proven.
- **`RefundPaymentLifecycle.settle()` never posts to Finance** (§5/§12) — a real completeness gap.

---

## 18. Complete Test Matrix (this phase's additions)

| File                                                        | New in A.11        | Tests | Proves                                                |
| ----------------------------------------------------------- | ------------------ | ----- | ----------------------------------------------------- |
| `webhook-ordering-idempotency.test.ts`                      | Yes                | 3     | Task 11 fix + control case                            |
| `authorize-retry-idempotency.test.ts`                       | Yes                | 3     | Task 1/14 fix + conflict + illegal-transition control |
| `webhook-identifier-correlation.test.ts`                    | Re-verified (A.10) | 4     | Task 4/6                                              |
| `capture-crash-recovery.test.ts`                            | Re-verified (A.9)  | 10    | Task 2, 12, 19                                        |
| `capture-concurrency.test.ts`                               | Re-verified (A.8)  | 8     | Task 2, 7                                             |
| `refund-concurrency.test.ts`                                | Re-verified (A.4)  | 8     | Task 3, 17                                            |
| `refund-duplicate-side-effects.test.ts`                     | Re-verified (A.10) | 3     | Task 3, 6                                             |
| `refund-idempotency.test.ts`                                | Re-verified (A.5)  | 11    | Task 3, 13, 16                                        |
| `payment-intent.test.ts`                                    | Re-verified        | 14    | Task 1 domain-level rules                             |
| `payments.e2e.test.ts`                                      | Re-verified        | 9     | Task 1 full lifecycle, webhook idempotency            |
| `value-objects.test.ts` / `find-by-idempotency-key.test.ts` | Re-verified        | 3     | VO/repo scaffolding                                   |

**Total, `services/payments` package: 76 tests, all green** (was 70 before this phase; +6 new, all
proving previously-undiscovered-and-now-fixed defects).

---

## 19. Quality Gate Results (Task 23)

Run via `turbo run <task> --concurrency=1` (the established workaround for this Windows host's
default-concurrency flakiness — see `lumo-platform-project-root` memory):

| Gate                    | Command                                                                   | Result                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck               | `pnpm typecheck` (`turbo run typecheck`)                                  | **78/78 successful**                                                                                                                |
| Lint                    | `pnpm lint` (`turbo run lint`)                                            | **78/78 successful**                                                                                                                |
| Test                    | `pnpm test` (`turbo run test`)                                            | **78/78 successful** (includes the 76 in `services/payments` above)                                                                 |
| Arch                    | `pnpm arch` (`depcruise packages services`)                               | **0 violations, 1565 modules, 6788 dependencies**                                                                                   |
| `pnpm governance`       | —                                                                         | **Does not exist in this checkout** (confirmed via root `package.json` scripts — reported honestly, not fabricated)                 |
| `pnpm dup`              | —                                                                         | **Does not exist in this checkout** (same)                                                                                          |
| `prisma validate`       | `npx prisma validate --schema=prisma/schema` (placeholder `DATABASE_URL`) | **Passes** (schema-syntax-only, includes this phase's new index)                                                                    |
| `prisma migrate status` | same placeholder `DATABASE_URL`                                           | **`P1001: Can't reach database server at localhost:5432`** — identical failure class to every prior phase, no Docker host available |

---

## 20. Production Readiness Verdict

**CONDITIONALLY PRODUCTION READY.**

Every task in the brief that could be proven without live infrastructure has been proven, with
regression-test evidence, not assertion. Three genuine, previously-undiscovered correctness defects
were found and fixed this phase (webhook self-transition, authorize retry, index drift), each with a
failing-test-before/passing-test-after proof and a documented root cause, minimal fix, and rejected
alternatives. One real defect (S3, shared HTTP idempotency cache-key scoping) was found, precisely
located, and deliberately left open because fixing it correctly requires leaving Payments' bounded
context — exactly the discipline this phase's absolute constraints call for.

The condition, unchanged across A.5 through A.11: **PostgreSQL and Stripe production behavior have
still not been verified against real infrastructure** in this sandbox (no Docker host, `P1001`
confirmed again this phase). Every claim in this report that depends on real-infra behavior is
explicitly flagged as unproven-in-this-environment rather than asserted as production-proven. Nothing
in this report claims readiness on the strength of green tests alone — the tests prove what the fakes
model faithfully; the fakes are honest about what they do and do not model (§8).

All changes are uncommitted, per the standing sprint-isolation discipline — this phase's own diff is
scoped exactly to: 2 new test files, 2 modified application-layer files (targeted guards only), and 1
new additive migration. No pre-existing uncommitted work from prior phases was touched, swept in, or
cleaned up.
