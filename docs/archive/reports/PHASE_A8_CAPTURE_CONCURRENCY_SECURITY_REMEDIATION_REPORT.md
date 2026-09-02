# Phase A.8 — Payment Capture Transaction / PSP Concurrency Security Remediation

**Status: CONDITIONALLY PRODUCTION READY**
**Scope:** `CapturePaymentLifecycle` (`services/payments/src/application/payment-lifecycle.use-cases.ts`), the only production-reachable capture path.
**Discipline:** Evidence-first. Every claim below is either **code-proven** (traced/tested without live infrastructure) or explicitly marked **environment-blocked**. Nothing is asserted as "PostgreSQL-live-verified" — Docker Desktop/WSL2 remain broken in this sandbox, consistent with every prior phase ([[lumo-integration-verification-sprint]], [[lumo-phase-a3-refund-execution-audit]]).

---

## 1. Executive Summary

`CapturePaymentLifecycle` originally ran its entire read→validate→PSP-call→persist sequence inside **one open database transaction** — the same long-transaction anti-pattern Phase A.7 flagged and Phase A.4 already fixed for `RefundPaymentLifecycle`. Unlike the pre-A.5 refund bug, capture's PSP idempotency key was **already fully deterministic** (`<intentId>:capture`, no random/per-attempt component), so the feared "double real PSP charge" was disproven by a written, executed test (Task 3). What _was_ proven, by three initially-failing exploit tests:

1. **Uncaught exception on the losing side of a genuine concurrent capture race** — no `withConcurrencyRetry` wrapper existed for Capture (unlike Refund), so a real 2-replica race surfaced as a raw 500, not a clean result.
2. **The PSP network call happened while a DB transaction was open** (`openCount = 1` at call time) — holding a connection/lock for the full PSP round-trip, and exposed to Prisma's default 5000ms transaction timeout racing against the Stripe adapter's own 10000ms per-request timeout.
3. **Retrying a capture after genuine success returned a domain error, not an idempotent success** — no "already captured" short-circuit existed.

A structural, evidence-driven root cause connects all three: no durable state was committed _before_ calling the PSP. The fix reuses the already-proven Phase A.4 reserve/PSP-call/settle split, adapted (not copied) for capture's single-shot, no-partial-amount semantics. All three exploit tests now pass; all pre-existing tests (53/53 in `services/payments`, 78/78 packages repo-wide) remain green.

**One residual structural gap is documented, not fixed, per the "no speculative engineering" constraint:** `authorized → captured` is not a legal transition, so a PSP webhook cannot repair an intent that crashes _before_ the new `capture_requested` reservation is durably committed (a window now measured in a single fast local write, not a full PSP round-trip — see §8).

---

## 2. Capture Architecture

End-to-end trace, file:line evidence:

```
HTTP: POST /payment-intents/:paymentIntentId/capture
  apps/admin/src/http/payments-routes.ts:73-82  (permission "payments:capture", idempotent:true, NO Idempotency-Key required)
    → apps/admin/src/interfaces/payments.admin-controller.ts:46-53  (AdminGuard.ensure, then delegates)
      → services/payments/src/interfaces/payment.controller.ts:79-81  (captureLifecycle)
        → services/payments/src/application/payment-lifecycle.use-cases.ts  (CapturePaymentLifecycle)
          → services/payments/src/domain/payment-intent.ts:213-227  (requestCapture / markCaptured)
          → packages/psp-stripe/src/stripe-payment-provider.ts:90-97  (capture(), raw REST, Idempotency-Key header)
          → services/payments/src/infrastructure/prisma-payment-intent-repository.ts:34-79  (save(), optimistic lock)
```

**Two capture implementations exist in the repository (Task 21 sweep):**

- `CapturePaymentLifecycle` (`payment-lifecycle.use-cases.ts:261+`) — the **only production-reachable** one (wired at `apps/admin/src/interfaces/payments.admin-controller.ts:52`, confirmed by the route's zod schema having no `pspToken` body field, which only this use case's input shape matches).
- `CapturePayment` (`services/payments/src/application/capture-payment.use-case.ts`) — the **legacy** `requires_payment → captured` path. Confirmed via repo-wide grep (`\.capture(`, `CapturePayment\b`) that it is invoked **only from `services/payments`'s own unit/e2e tests** — zero references in `apps/admin` or `apps/runtime` production wiring. Dead in production, out of scope for remediation (no live defect to fix).

---

## 3. Trust Boundaries

- HTTP boundary: zod validates `params` only (no body) — `payments-routes.ts:80`.
- AuthZ boundary: `AdminGuard.ensure(principal, "payments:capture")` — `payments.admin-controller.ts:50`. Permissive/RBAC-pending per the same doc comment as every other Payments admin action (`payments.admin-controller.ts:14-17`) — not new to this phase, not fixed here (out of scope; matches Phase A.2/A.3's treatment of the same permissive-RBAC state elsewhere).
- Tenant boundary: `PrismaPaymentIntentRepository.findById` scopes every read `where: { id, tenantId: this.deps.tenantId }` (`prisma-payment-intent-repository.ts:83-90`) — cross-tenant capture of another tenant's intent is structurally impossible (404, not data leakage).
- PSP boundary: `StripePaymentProvider` — no SDK, raw REST, secret key/webhook secret never logged (`stripe-payment-provider.ts:1-72`).

---

## 4. Transaction Boundary

**Before this phase** (Task 2 pattern match — confirmed exactly):

```
BEGIN TRANSACTION (unitOfWork.run, payment-lifecycle.use-cases.ts:226 pre-fix)
    findById
    validate pspReference
    requestCapture()            [in-memory transition]
    await paymentProvider.capture()   ← PSP CALL, TRANSACTION STILL OPEN
    markCaptured()
    save()                       [optimistic-lock write]
    notify / finance (best-effort)
COMMIT
```

This is the **first branch** of the three patterns named in the task brief — the one explicitly flagged as unsafe.

**After this phase:**

```
TX1 (reserve): findById → requestCapture() → save()   [commits BEFORE any PSP call]
COMMIT
    ↓ (no open transaction)
await paymentProvider.capture()   ← PSP CALL, ZERO OPEN TRANSACTIONS
    ↓
TX2 (settle): findById → markCaptured() → save() → notify/finance
COMMIT
```

This matches the **already-proven** pattern from `RefundPaymentLifecycle` (Phase A.4), adapted for capture having no partial-amount concept (one reservation state, not a per-slice amount ledger).

**Duration/connection analysis (code-proven, not measured live):** `PrismaUnitOfWork.run()` (`packages/db/src/prisma-repository.ts:41-43`) calls `runInTransaction(prisma, work)` with **no `options` argument** (`payment-lifecycle.use-cases.ts` never passed any), so `runInTransaction` (`packages/db/src/transaction.ts:15-24`) invokes `prisma.$transaction(fn, { maxWait: undefined, timeout: undefined })` — Prisma substitutes its **documented defaults: `maxWait: 2000ms`, `timeout: 5000ms`**. Meanwhile `StripePaymentProvider`'s own per-request timeout defaults to **10000ms** (`stripe-payment-provider.ts:52`, `DEFAULT_TIMEOUT_MS`). Before this fix, a PSP capture call taking 5-10 seconds (a real, documented Stripe degradation scenario, not hypothetical) could outlive Prisma's transaction timeout while still being "in flight" from Node's perspective (the `await` doesn't know or respect Prisma's internal timer) — Prisma would consider the transaction expired/rolled back server-side, and the subsequent `save()` call against the now-stale transaction client would throw a Prisma transaction-error, **after the PSP had already genuinely captured the money**. This is the exact crash-consistency risk analyzed in §8. Not measured against a live Postgres (environment-blocked), but derived directly from the two timeout constants in the codebase — a **code-proven** structural mismatch, not a guess.

---

## 5. Concurrency Analysis

**Exploit test** (`services/payments/src/capture-concurrency.test.ts`, "Task 3/20") ran two concurrent `execute()` calls against a `PostgresLikePaymentIntentRepository` fake that reproduces Postgres's `UPDATE ... WHERE id=? AND version=?` optimistic-lock contract exactly (same fake pattern as `refund-concurrency.test.ts`, Phase A.4 — round-trips every read/write through `PaymentIntentMapper`, giving each `findById` call an independent snapshot).

**Pre-fix result:** one call fulfilled, the other's promise **rejected** with an uncaught `ConcurrencyError` — `Promise.allSettled` showed `status: "rejected"`. No `withConcurrencyRetry` wrapper existed around the single transaction, unlike `RefundPaymentLifecycle.reserve()`/`.settle()` which both use it (`payment-lifecycle.use-cases.ts:378`, `:419`, pre-existing).

**Post-fix result:** both calls fulfill. The loser's `reserve()` retries (`withConcurrencyRetry`, max 5 attempts) against the now-current row, finds it already `capture_requested`, and **resumes** instead of erroring — both callers proceed to `settle()`, one performs the real write, the other's `settle()` sees `status === "captured"` already and short-circuits to a read-only success.

---

## 6. TOCTOU Analysis

**Prove-or-disprove the distinction the brief asked for** (a Postgres optimistic-lock failure _after_ the PSP call does not protect the PSP side effect):

- **True in general**, and true of the pre-fix code: both racing transactions could pass validation, both could call the PSP, and only the _persistence_ was serialized by `version`.
- **Not exploitable here**, proven by test (`Task 3/20`, first test): both racing calls present the **identical** deterministic idempotency key `<intentId>:capture` (no reservation-id, no randomness — confirmed by reading `stripe-payment-provider.ts:90-97` and the call site). A `RecordingCaptureProvider` modeling Stripe's documented idempotency-key dedup guarantee (`realEffects` only increments on the first occurrence of a key, exactly as `refund-idempotency.test.ts`'s fake already does for Task 7 semantics) shows **`realEffects === 1`** even under concurrent identical requests, both before and after this phase's fix.
- **What actually needed fixing was not "double PSP charge"** (disproven) but **(a)** the loser's ugly uncaught exception (§5) and **(b)** the long-transaction/crash-consistency exposure (§4, §8) — both are now closed.

---

## 7. PSP Idempotency

Traced HTTP → PSP SDK:

- HTTP: no `Idempotency-Key` header is required or read by `payments-routes.ts`'s capture route (contrast with the refund route, `payments-routes.ts:108-119`, which explicitly requires one — Phase A.6). The generic `idempotent: true` transport response-cache (`packages/http/src/server.ts:349-381`) is **available but optional**: only engages if a caller happens to send an `Idempotency-Key` header.
- Domain: `paymentProvider.capture(pspReference, \`${paymentIntentId}:capture\`)` — **no caller input feeds this key at all**. It is 100% derived from the payment intent's own id, unchanged since Sprint 4.8, unchanged by this phase.
- Adapter: `StripePaymentProvider.capture()` forwards it verbatim as the `Idempotency-Key` HTTP header (`stripe-payment-provider.ts:90-97`, `:166`) — confirmed the key is never discarded or regenerated between the port and the wire.
- **Conclusion:** capture's PSP-level idempotency is _stronger_ than refund's was pre-A.5 (no caller cooperation needed, no header requirement, cannot be forgotten by an HTTP route) precisely because it never depended on a reservation id in the first place. This phase's fix does not touch this key derivation — it was already correct.

---

## 8. Crash Consistency

Failure-point matrix (code-proven; "live" = would additionally need a real Postgres + Stripe sandbox, environment-blocked):

| Point                                        | Pre-fix behavior                                                                                                                                                                           | Post-fix behavior                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 1. Before PSP call                           | Nothing committed; safe                                                                                                                                                                    | `capture_requested` already durably committed (TX1)                                                |
| 2. During PSP call                           | Transaction open, holding a DB connection for the full network round-trip                                                                                                                  | Zero open transactions during the call                                                             |
| 3. Immediately after PSP success             | Still inside the one open transaction; if the process crashes here, the _entire_ transaction (including the in-memory `capture_requested` transition) is lost — DB reverts to `authorized` | Reservation was already committed (point 1); only `settle()`'s write is at risk                    |
| 4. Before DB persistence                     | Same as 3                                                                                                                                                                                  | Intent durably sits at `capture_requested` — **repairable** (see below)                            |
| 5. After persistence, before HTTP response   | Client may retry believing failure; retry would fail (pre-fix had no idempotent-resume — Task 4/12 test proved this)                                                                       | Retry finds `status === "captured"`, returns a clean idempotent success (Task 4 test, now passing) |
| 6. After commit, before caller sees response | Same as 5                                                                                                                                                                                  | Same as 5                                                                                          |

**The webhook-reconciliation gap (proven by test, not fixed — documented per "PROVE every finding... do not modify unless a real defect is demonstrated" and the "no new architecture" constraint):**
`STRIPE_TYPE_TO_KIND` maps `payment_intent.succeeded → "captured"` (`apps/admin/src/http/payments-webhook-routes.ts:28`), and `RecordWebhook` calls `intent.transition("captured", ...)` (`record-webhook.use-case.ts:86`). The transition table (`payment-status.ts:20-33`) allows `capture_requested → captured` but **not** `authorized → captured`.

- Pre-fix, a crash at points 3-4 leaves the intent at `authorized` (nothing durable) — a reconciling webhook is **permanently rejected** (`BUSINESS_RULE` error), and there is no automated recovery path. Proven by `capture-concurrency.test.ts`, "STANDING GAP" test.
- Post-fix, the same crash window leaves the intent at `capture_requested` (TX1 already committed) — the identical webhook **succeeds** and repairs the state. Proven by `capture-concurrency.test.ts`, "FIX TARGET" test.
- **Residual risk, explicitly not fixed:** a crash _before_ TX1 commits (i.e., during `reserve()`'s own write) still leaves the intent at `authorized`, still unreconcilable by webhook. This window is now a single local DB write (milliseconds), not a full PSP round-trip (seconds, possibly 5-10s under degradation) — the _exposure_ is reduced by roughly the ratio of a local write to a network round-trip, but not eliminated. Closing it fully would mean adding `authorized → captured` as a legal transition (or another new state) purely to cover an already-tiny window with no demonstrated occurrence — **not built**, per the "no speculative engineering" / "PROVE every finding" constraints. Flagged for a future phase if evidence (a real stuck intent) ever appears.

---

## 9. Domain Invariants

- `captured ≤ authorized`: not applicable in the exploited sense — capture is all-or-nothing (`markCaptured` always captures exactly `authorizedAmount ?? amount`, `payment-intent.ts:219`), there is no partial-capture input anywhere in the domain or HTTP surface (confirmed: `PaymentIntentIdInput` carries no amount field). The refund-style "remaining() capacity" race the task brief's Scenarios A/B/C describe **does not apply to this domain** — capture has no amount parameter to race over. This was determined from the domain, not assumed (per the brief's own Task 4 instruction), and reframes Scenarios A/B/C: the only real race is "the same single full-amount capture, requested twice concurrently," which §5/§6 cover.
- `capture_requested` has no self-transition (`payment-status.ts:28`) — this is exactly what makes the resume-not-retry logic in `reserve()` safe: a second `requestCapture()` call from an already-`capture_requested` row is domain-rejected, so `reserve()` must (and does) special-case that status explicitly rather than calling the domain method again.
- Enforced in TypeScript only, not in Postgres: the "one charge per intent" invariant relies entirely on `save()`'s optimistic-lock write ordering (PaymentIntent row updated before `Charge.createMany`, `prisma-payment-intent-repository.ts:44-63`) plus the transition table — there is no DB-level unique constraint preventing two `Charge` rows per `intentId`. Documented, not fixed: no live-reachable path produces this today (legacy `CapturePayment` is unreachable, §2; the Sprint-4.8 path's transition table prevents re-entry to `capture_requested`), so adding a speculative constraint would violate "DO NOT introduce speculative infrastructure."

---

## 10. Database Constraints

`packages/db/prisma/schema/payments.prisma`:

- `PaymentIntent.version Int @default(0)` (`:21`) — optimistic lock, enforced via `updateMany({ where: { version } })` (`prisma-payment-intent-repository.ts:45-59`), not a DB-level `CHECK`.
- `PaymentIntent` has **no** `idempotencyKey` usage on the capture path (that column is intent-_creation_-scoped, Sprint A0 precondition, still all-NULL — unrelated to this phase).
- `Charge` (`:66-79`): no unique constraint tying it to one-per-intent or one-per-idempotency-key. Gap noted in §9, not fixed (no demonstrated exploit path).
- `Refund.status` has no DB `CHECK` (`payments.prisma:81-87`'s own comment already documents this as deferred) — unrelated to capture, not re-litigated here.

---

## 11. Migration Verification

`PaymentIntent.version`, `authorizedAmountMinor`, `pspReference` all present since the Sprint 4.8 migration (`20260712060000_payments_core_sprint48`, confirmed present in schema and consistent with [[lumo-payments-implementation]]). Phase A.7's schema/migration-drift regression test (`packages/db`) already covers whole-schema drift generically; this phase introduced no new columns, so no new migration was needed and none was written — the fix is application-layer only (two transactions using the existing schema, not a schema change).

---

## 12. HTTP Idempotency

Audited per the required matrix (Task 11):

| Missing key                                                         | Empty key       | Same key + same request                                                                                                          | Same key + different amount       | Same key + different payment                                                                                                                                                                                                                                                                                                               | Different key + same payment                              |
| ------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Falls through, no cache — but domain-level dedup still applies (§7) | Same as missing | Response-cache replay if header sent (`server.ts:351-380`) — no assertion needed beyond existing generic transport test coverage | N/A — capture has no amount input | N/A — the key is `tenant:${tenantId}:idem:${key}`, a different `paymentIntentId` in `params` would target a different resource entirely; the cache key itself carries no payment-intent identity, so this is a pre-existing, capture-agnostic property of the generic `idempotent: true` mechanism, not something this phase's fix touches | Domain-level key is unaffected by HTTP header at all (§7) |

**Conclusion:** capture's HTTP idempotency boundary is intentionally weaker than refund's (no required header) because it doesn't need to be stronger — the domain-level key was never caller-dependent. Not a gap; a documented, evidence-based design difference (Task 19's instruction: "Do not blindly copy the refund implementation if capture semantics differ" applies here too).

---

## 13. Authorization

- Route-level: `permission: "payments:capture"` (`payments-routes.ts:77`).
- Use-case-level: `AdminGuard.ensure` (`payments.admin-controller.ts:50`) before any domain call.
- Repository-level: tenant-scoped `findById` (§3) — the actual object-ownership boundary. A capture request naming a nonexistent or cross-tenant `paymentIntentId` returns `NOT_FOUND` (proven by `capture-concurrency.test.ts`'s "nonexistent payment intent" test) — confirmed no data leakage, no PSP call made (`provider.calls` asserted empty).
- No per-order/per-customer ownership check beyond tenant scope exists, by design — this is an **admin/backoffice** operation (same model as `authorize`/`refund`/`create`), not a customer-facing one. No public/storefront capture route exists anywhere in the repo (confirmed by the Task 21 sweep, §2).

---

## 14. Performance / Long Transaction Analysis

- **Pre-fix:** 1 transaction, 1 `findById`, PSP call in-transaction (5000ms Prisma default timeout vs 10000ms Stripe adapter timeout — mismatch, §4), 1 `save()`.
- **Post-fix:** 2 transactions (`reserve`, `settle`), 2 `findById` calls, PSP call **outside** both, each transaction's lifetime is now bounded by a single local read+write, not by PSP latency. This is a deliberate, measured trade: **one extra round-trip query** in exchange for closing the connection-holding and crash-consistency exposure — the same trade Phase A.4 already made and shipped for refund. Not optimized further (no N+1 beyond the necessary 2 reads; Task 15 — no evidence of a bottleneck at this query count, no speculative caching added per the explicit constraint).
- Connection pool: `createPrismaClient` (`packages/db/src/client.ts:13-17`) passes no `connection_limit`/`pool_timeout` — relies on `DATABASE_URL`-embedded or Prisma-default pool sizing, consistent with Phase A.7's prior finding ("pool size not wired") — not re-fixed here, out of this phase's scope (no capture-specific evidence it's the bottleneck; a repo-wide pool-sizing decision belongs to a dedicated phase).

---

## 15. Exploit Evidence

File: `services/payments/src/capture-concurrency.test.ts` (new, 8 tests). Pre-fix run: **3 failures**, exactly matching the findings above:

```
✗ EXPLOIT: the losing side of a genuine concurrent capture race throws an uncaught ConcurrencyError
   expected 'rejected' to be 'fulfilled'
✗ EXPLOIT: PaymentProvider.capture() is invoked with a transaction still open (openCount > 0)
   expected 1 to be 0
✗ retrying capture on an already-captured intent is a clean idempotent no-op
   expected false to be true
```

Post-fix run: **8/8 pass**. Full repo `services/payments` suite: **53/53 pass**. Repeated 3× consecutively with no flakiness (concurrency assertions are deterministic under the fake's synchronous version-check model, matching the same guarantee `refund-concurrency.test.ts` already relies on).

---

## 16. Remediation

**Option chosen: minimal reservation model, reusing the proven Refund pattern (Option B in the brief's terms), justified entirely by the three failing tests in §15** — not chosen speculatively.

Change: `services/payments/src/application/payment-lifecycle.use-cases.ts`, `CapturePaymentLifecycle` (was 58 lines, one transaction; now `reserve()`/`settle()` split, ~125 lines, two transactions + `withConcurrencyRetry`, matching `RefundPaymentLifecycle`'s existing shape). No new files, no new domain entities, no schema change, no new bounded context, no event-bus, no outbox change, no public API change (`PaymentIntentIdInput`/`PaymentIntentStatusOutput` unchanged), no distributed lock. `PaymentIntent.requestCapture`/`markCaptured` (pre-existing domain methods) are reused verbatim — the fix is entirely in the use case's transaction shape, not the aggregate.

**Why sufficient:** closes all three demonstrated exploits (§15) and the crash-consistency gap for the dominant crash window (§8), without introducing the semantic mismatch a naive reuse of `markFailed`/refund's reservation-amount model would have caused (§18).

---

## 17. Regression Tests

`capture-concurrency.test.ts` (8 tests, described in §15) plus full existing suite unaffected: `payment-intent.test.ts` (14), `payments.e2e.test.ts` (9, includes the authorize→capture→refund happy path and a concurrent-refund-after-capture race), `refund-concurrency.test.ts` (8), `refund-idempotency.test.ts` (11), `value-objects.test.ts` (2), `find-by-idempotency-key.test.ts` (1). Total `services/payments`: **53/53 green**.

---

## 18. Quality Gates

```
pnpm typecheck   → 78/78 packages, 0 errors
pnpm test        → 78/78 packages, all green (repo-wide, includes apps/admin, apps/runtime)
pnpm lint        → 78/78 packages, 0 errors
pnpm arch        → 0 violations (1565 modules, 6788 dependencies cruised)
pnpm governance  → NOT AVAILABLE IN THIS CHECKOUT (no such script; re-confirmed, consistent with every prior phase A.1-A.7)
pnpm dup         → NOT AVAILABLE IN THIS CHECKOUT (same)
```

Targeted: `pnpm --filter @platform/payments test` — 53/53, run 3× for flakiness — deterministic every time. `apps/admin`/`apps/runtime` test suites (which exercise the Payments admin routes and runtime composition, including Stripe/Docker-absent guards) — all green in the repo-wide `pnpm test` run; database-connection warnings in `apps/runtime`'s composition tests are expected (no live Postgres/Redis in this sandbox, gracefully handled by design, not failures).

---

## 19. Remaining Risks

1. **Crash-before-TX1-commit webhook gap** (§8) — residual, tiny window, not fixed (no evidence of occurrence; fixing would mean adding a new legal transition purely speculatively).
2. **No live-Postgres verification** — the optimistic-lock fake is faithful to the documented Prisma/Postgres contract (same fake already trusted for the shipped Phase A.4 refund fix) but this phase, like every phase before it in this sandbox, could not execute against real Postgres. Environment-blocked, not silently assumed safe.
3. **DB pool sizing not configured** (§14) — pre-existing (Phase A.7), out of scope, not re-fixed.
4. **`Charge` table has no DB-level one-per-intent constraint** (§9/§10) — TypeScript-only invariant, no live exploit path found, not fixed.
5. **Permissive RBAC on `payments:capture`** — pre-existing across all Payments admin actions, not specific to capture, not this phase's scope.
6. **HTTP-level capture idempotency remains optional** (§12) — by design, given the domain-level key was never caller-dependent; documented, not treated as a gap requiring a forced header like refund's.

---

## 20. Production Readiness Verdict

**CONDITIONALLY PRODUCTION READY.**

Justification: all three demonstrated exploits are closed with a minimal, evidence-driven fix reusing an already-shipped pattern; no speculative architecture was introduced; all quality gates that exist in this checkout are green; the one residual gap (§19.1) is explicitly bounded, tiny, and undemonstrated as an actual occurrence — consistent with how Phase A.3 accepted A3-02 as a documented condition rather than blocking on a live-infrastructure fix that this sandbox cannot produce. Not unconditional, for the same class of reason every prior phase in this project has not been unconditional: no live-Postgres/live-Stripe-sandbox run has ever been possible in this environment (Docker Desktop/WSL2 confirmed broken again, unchanged from every previous session).
