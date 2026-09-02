# Phase A.15 — Cross-Bounded-Context External-Call Transaction Boundary Remediation

**Date:** 2026-08-12
**Scope:** Remediate the 9 external-call-inside-open-transaction violations A.14 found across Licensing, Shipping, Fulfillment, Orders, Search, and Notifications, plus Finance's journal-repository N+1. Code remediation, not capacity testing.
**Status:** All 9 violations independently traced and fixed. Finance N+1 fixed. Repository-wide sweep shows zero remaining genuine violations. All offline quality gates green. Real PostgreSQL load testing remains an A.14 environment blocker (unchanged, not re-attempted per this phase's constraints). Nothing committed.

---

## 1. Executive Summary

A.14 found the PSP/HTTP-call-inside-open-transaction anti-pattern — already closed for Payments (A.4/A.8) and Returns (A.13.1) — open in 9 new call sites across 6 bounded contexts, plus one N+1 query in Finance's journal repository. This phase closed all 10 findings:

- **Licensing** (`CollectInvoice`): PSP `collect()` and Finance `postSettlement()` moved outside the transaction. Fixing this also **eliminated a latent bug** the pre-fix code had: a `postSettlement()` failure used to land in a `catch` block that called `invoice.markFailed()` on an already-`paid` in-memory invoice — an illegal transition (`TRANSITIONS.paid = []`) that threw a second, different error and rolled back the whole transaction, silently reverting a successfully-collected payment back to `issued`. That code path is no longer reachable.
- **Shipping** (`CreateLabel`, `VoidLabel`): both carrier calls moved outside their transactions independently.
- **Fulfillment** (`RequestReservation`, `CreateShipment`): `RequestReservation` got a genuinely new durable pre-call reservation write (the domain already had a `reservation_requested` status the code computed but never persisted before calling Inventory) — this is the strongest fix in the phase, provably closing the duplicate-external-call race, not just moving the call. `CreateShipment` got the simpler precheck/settle split.
- **Orders** (`RequestPaymentCapture`, `RequestFulfillment`): both fixed with the simple pattern; `RequestFulfillment`'s pre-existing partial-failure orphan-reservation gap (if the second of two sequential external calls fails after the first succeeded) was preserved exactly, not worsened, and is documented as a residual risk.
- **Search** (`UpsertDocument`, `DeleteDocument`): fixed; confirmed the search-index provider calls are genuinely idempotent by design (`IndexProviderPort`'s own contract), so this fix carries the smallest residual concurrency risk of the six contexts.
- **Notifications** (`SendNotification`): fixed — A.14 called this "the most load-sensitive instance." Also **found and preserved (not fixed)** a pre-existing, unrelated defect: the notification status transition table doesn't actually permit `→ failed` from the only two statuses `SendNotification` ever runs from, so the failure branch already threw a domain error pre-fix, not the `ok({status:"failed"})` its shape suggests — confirmed against the unmodified code before writing the fix, preserved identically post-fix.
- **Finance**: the N+1 in `PrismaJournalRepository.findBySourceRef` batched into one query, RED→GREEN proven.

Every fix has a dedicated regression test proving `openCountAtCall === 0` for the external call, proven RED against the pre-fix shape and GREEN after. Every affected package's full suite is green, plus Payments/Returns/Admin/Runtime (the previously-hardened flows) remain green. Repository-wide typecheck (78/78), lint (78/78), and `pnpm arch` (0 violations) are green. `prisma validate` is clean; `prisma migrate status` correctly fails `P1001` — no live PostgreSQL, matching A.14's still-unresolved Docker Desktop blocker exactly. Nothing was committed.

**Verdict: CONDITIONALLY PRODUCTION READY** — see §21 for full reasoning.

---

## 2. A.14 Findings Reproduced

Independently re-traced (not assumed) all 9 A.14 §11 findings plus the §13 N+1, by reading each file at the cited line and confirming the exact shape A.14 described, before writing any fix:

| #   | Context       | File:line (A.14 citation)                                                | Confirmed                                                                                                                           |
| --- | ------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Licensing     | `billing.use-cases.ts:104` `CollectInvoice.execute`                      | ✅ exact match — PSP `collect()` + `financeLedger.postSettlement()` both inside `unitOfWork.run`                                    |
| 2   | Shipping      | `shipment-lifecycle.use-cases.ts:104` `CreateLabel.execute`              | ✅ exact match                                                                                                                      |
| 3   | Shipping      | `shipment-lifecycle.use-cases.ts:162` `VoidLabel.execute`                | ✅ exact match                                                                                                                      |
| 4   | Fulfillment   | `create-shipment.use-case.ts:42` `CreateShipment.execute`                | ✅ exact match                                                                                                                      |
| 5   | Fulfillment   | `request-reservation.use-case.ts:51` `RequestReservation.execute`        | ✅ exact match, plus found the in-memory `requestReservation()` transition was computed but never durably committed before the call |
| 6   | Orders        | `order-lifecycle.use-cases.ts:104` `RequestPaymentCapture.execute`       | ✅ exact match                                                                                                                      |
| 7   | Orders        | `order-lifecycle.use-cases.ts:153-154` `RequestFulfillment.execute`      | ✅ exact match — two sequential external calls in one open transaction                                                              |
| 8   | Search        | `search.use-cases.ts:131,171` `UpsertDocument`/`DeleteDocument`          | ✅ exact match                                                                                                                      |
| 9   | Notifications | `notification-lifecycle.use-cases.ts:128-190` `SendNotification.execute` | ✅ exact match                                                                                                                      |
| N+1 | Finance       | `prisma-finance-repositories.ts:88-91` `findBySourceRef`                 | ✅ exact match — one `ledgerEntry.findMany` per journal row in a `for` loop                                                         |

Payments/Returns were re-verified as still intact (A.4/A.8/A.13.1 unregressed) — confirmed via the full Payments/Returns test suites in §13, not by re-reading source (already read during pattern research, see §3).

---

## 3. Complete Violation Inventory (Task 1 repo-wide sweep, done independently of A.14's list)

Searched `services/*/application/*.ts` (154 files use `unitOfWork.run`) for port/provider-shaped calls (`await this.deps.\w*(Port|Provider|Gateway)\.\w+\(`, plus broader `send|call|request|verify|charge|authorize|dispatch|publish|post|notify|sync|push|invoke|collect` method-name sweeps against Security's 13 use-case files and Finance's 3 command files, which A.14 flagged as "not exhaustively re-verified"), and a repo-wide `fetch(`/`axios.`/`http.request(`/`https.request(` sweep.

**Result: the 9 A.14 findings are complete — no additional violations found.**

- Security's application layer: every `await this.deps.*.publish(...)` call found is `outbox.publish(...)` — the transactional outbox pattern, which **writes to the same DB transaction by design** (that's the entire point of an outbox: the whole reason it's safe to call from inside a transaction is that it never leaves the process during the call). Confirmed safe-by-design, not a violation. MFA (`mfa.use-cases.ts`) independently re-confirmed clean, matching A.14.
- Finance's application layer (`fiscal.commands.ts`, `ledger.commands.ts`, `reference-data.commands.ts`): zero port/provider-shaped calls found.
- No `fetch`/`axios`/raw `http(s).request` call sites exist anywhere under `services/*/application/*.ts`.

---

## 4. Licensing Remediation

**File:** `services/licensing/src/application/billing.use-cases.ts`, class `CollectInvoice`.

**Pattern chosen:** simple precheck → external-call → settle (not the full reserve/settle two-phase pattern), because `Invoice`'s status machine (`draft → issued → paid|failed|voided`) has no `collecting`-style intermediate status to durably reserve, and adding one would be a business-semantics/schema change out of this phase's scope.

**Shape:**

1. `precheck(invoiceId)` — read-only transaction: 404 if missing, idempotent short-circuit if already `paid`, `BusinessRuleError` if not `issued`. Returns `{ tenantRef, total, currency }` as a value, not an instance field.
2. `payments.collect(tenantRef, total, currency)` — outside any transaction.
3. `settleSuccess(invoiceId, reference)` — its own transaction, wrapped in a local `withConcurrencyRetry` (5 attempts), idempotent no-op if a racer already settled it.
4. `financeLedger.postSettlement(...)` — also outside any transaction (A.14 flagged it as part of the same violation, not separate), now **best-effort** (try/catch, doesn't fail the collection) — see §4.1 for why this is a required, not cosmetic, change.
5. On PSP failure: `settleFailure(invoiceId)` — its own transaction, `markFailed()` only if the invoice is still `issued` (never reached if `markPaid` already committed).

### 4.1 Latent bug fixed as a direct consequence of this remediation

Pre-fix: `postSettlement()` ran _before_ the enclosing transaction committed. If it threw, the `catch` block called `invoice.markFailed()` on an **in-memory** invoice object whose status was already (uncommitted) `paid`. `Invoice.TRANSITIONS.paid = []` — no outgoing transitions — so `markFailed()` itself threw a _different_ `BusinessRuleError`, which propagated uncaught out of the `catch` block, aborting the transaction and losing the `markPaid` write entirely. **A successfully-collected payment would silently revert to `issued` on any Finance-ledger hiccup.** This is not reachable after the fix: `markPaid` is durably committed in its own transaction before `postSettlement` ever runs, so a ledger-post failure is now correctly treated as a Finance-side reconciliation gap (best-effort, same convention as `CapturePaymentLifecycle.settle`'s `financePort?.recordPaymentEvent`), not a payment failure. This was fixed because the transaction-boundary refactor made it directly unavoidable to touch this exact code path correctly — not scope creep.

### 4.2 A process defect caught and corrected during this fix

The first draft of this fix stashed `{ tenantRef, total, currency }` on `this` (an instance field) to pass data from `precheck()` to `execute()`. Since `CollectInvoice` instances are constructed once via composition and reused across concurrent `execute()` calls, this would have corrupted concurrent requests racing on different invoices. Caught before shipping; rewritten to thread the data as return values/local variables. Flagged explicitly to every subsequent remediation agent in this phase as a known trap — none of the other 5 contexts made this mistake (verified in their reports).

**Tests:** `services/licensing/src/collect-invoice-transaction-boundary.test.ts`, 6 tests. RED (pre-fix shape restored): `openCountAtCall` was 1 not 0 for both `collect()` and `postSettlement()`. GREEN (fix restored): 6/6 pass. Full package suite: 29/29 pass. Typecheck: clean.

**Residual risk (documented, not fixed):** `PaymentsPort.collect()` carries **no idempotency key at all** — unlike every other site in this phase, there is no `<id>:action`-style deterministic identity for the PSP to dedupe against. `precheck()` is a plain read with no reservation write, so two concurrent callers can both pass precheck and both call the PSP — a genuine concurrent-double-charge exposure. **Not a regression**: the pre-fix single-transaction version had the identical exposure (no row lock, no reservation write there either). Closing it needs either a port-signature change (add an idempotency-key parameter) or a new persisted `collecting` status — both out of scope per the brief's "DO NOT change public APIs... DO NOT change database schemas... unless a concrete defect requires it," and this is a pre-existing gap, not one this phase created.

---

## 5. Shipping Remediation

**File:** `services/shipping/src/application/shipment-lifecycle.use-cases.ts`, classes `CreateLabel` and `VoidLabel` — fixed independently, not merged.

**Pattern:** simple precheck/settle (no `label_requested`/`void_requested` intermediate status exists in `Shipment`'s transition table — `created → label_created/voided → ...` is direct).

**Shape (both):** `precheck()` (read-only tx, idempotent short-circuit if already at the target status) → carrier call (`createLabel`/`voidLabel`, both already idempotency-keyed `<shipmentId>:label`/`<shipmentId>:void`) outside any transaction → `settle()` (its own tx, `withConcurrencyRetry`-wrapped, re-reads and no-ops if a racer already got there).

**Tests:** `services/shipping/src/shipment-lifecycle-transaction-boundary.test.ts`, 9 tests. RED (6/9 failed): `openCountAtCall` was 1, idempotent-resume re-invoked the carrier, concurrent calls leaked an uncaught `ConcurrencyError`. GREEN: 9/9. Full suite: 22/22 (including `shipping.e2e.test.ts`, which exercises both fixed use cases through the HTTP controller — no regression). Typecheck: clean.

**Residual risk:** same class as Licensing's — `precheck()` is a plain read, so both racers can call the carrier. Materially smaller here because both calls already carry deterministic idempotency keys (the carrier is expected to dedupe), unlike Licensing's `collect()` which has none. Shipping's own write path stays safe regardless (settle's re-read + retry converge on one row, no lost update).

---

## 6. Fulfillment Remediation

**File 1 — `request-reservation.use-case.ts`, `RequestReservation`:** full reserve → external-call → settle pattern, matching `CapturePaymentLifecycle` — chosen because the domain **already has** a `reservation_requested` intermediate status that the pre-fix code computed in-memory but never durably committed before calling Inventory.

**Shape:** `reserve()` (own tx: `created`/`failed` → `reservation_requested`, committed _before_ Inventory is ever called — this is a genuinely new durable write, not merely a relocated call) → `inventoryPort.reserve()` outside any transaction → `settle()` (own tx, `withConcurrencyRetry`, applies `confirmReservation()`/`failReservation()` based on the port's result).

This is the **strongest fix in the phase**: concurrent duplicate `inventoryPort.reserve()` calls are _provably_ prevented for the lock-step concurrent case (verified: 3 repeated `Promise.all` runs, `inventoryPort.calls` has length exactly 1 each time) — the pre-call reservation write plus attempt-index tracking (a local closure variable distinguishing "I made the transition" from "I observed it already committed") ensures only the optimistic-lock winner calls Inventory. Documented smaller residual gap: a _staggered_ (non-lock-step) late arrival reading an already-`reservation_requested` row cannot be distinguished from a legitimate crash-retry resume and will call Inventory again — closing that fully needs a port-level idempotency key, out of scope (no port signature changed).

**File 2 — `create-shipment.use-case.ts`, `CreateShipment`:** simple precheck/settle pattern (no `shipment_requested` precursor exists between `packing_completed` and `shipment_created`). Same shape as Shipping's `CreateLabel`. Smaller residual race window, mitigated in practice by `ShippingProviderPort.createShipment`'s existing idempotency key.

**Tests:** `create-shipment-transaction-boundary.test.ts` (8 tests), `request-reservation-transaction-boundary.test.ts` (11 tests). RED: `RequestReservation` 7/11 failed (openCount 1, a raw uncaught `ConcurrencyError` under concurrency — exactly the defect this closes); `CreateShipment` 5/8 failed (openCount 1, concurrent calls rejected instead of resolving). GREEN: 11/11 and 8/8. Full suite: 28/28. Typecheck: clean.

---

## 7. Orders Remediation

**File:** `services/orders/src/application/order-lifecycle.use-cases.ts`, classes `RequestPaymentCapture` and `RequestFulfillment` — fixed independently.

Neither has a persistable intermediate status distinct from its post-call target (`payment_requested`/`fulfillment_requested` are both reached _after_ the external call in the pre-fix code) — both use the simple precheck/settle pattern.

**`RequestPaymentCapture`:** precheck (404 / idempotent short-circuit if `paymentRef` already set / `BusinessRuleError` if illegal) → `paymentPort.requestCapture()` outside any tx → settle (retryable). On PSP failure: `Order`'s transition table has no `awaiting_payment → payment_failed` path (only `payment_requested → payment_failed`), so — matching pre-fix behavior exactly, verified by test — there is no legal target to mark a pre-request failure against; the order is left unchanged and the error propagates.

**`RequestFulfillment`:** precheck (keyed on `fulfillmentRef`) → **both** `inventoryPort.requestReservation()` and `shippingPort.requestShipment()` sequentially outside any tx → settle. **Explicitly preserved, not fixed:** if the second call fails after the first succeeded, nothing is persisted locally at all — proven by a dedicated regression test reproducing this exact pre-fix behavior post-fix. The external reservation may now exist with zero local record, and a retry re-requests a second reservation. Closing this needs a new persisted intermediate state per external call (a business-semantics change) — explicitly out of this phase's scope per the task brief ("Do not force every flow into the exact same implementation if business semantics differ" / preserve existing failure behavior, don't improve beyond the transaction-boundary fix).

**Tests:** `request-payment-capture-transaction-boundary.test.ts` (8), `request-fulfillment-transaction-boundary.test.ts` (8). RED: 5/8 failed in both (openCount 1, idempotent-resume re-called the port, concurrent runs threw `ConcurrencyError`). GREEN: 8/8 both. Full suite: 58 passed, 5 skipped (pre-existing DB-only integration tests, unaffected by this fix). Typecheck: clean.

**Residual risk (verified, not assumed):** both use-cases' plain-read prechecks let concurrent racers both call the external port(s) — verified directly in the concurrency tests (both port calls actually fire in every run); only one resulting ref is ever durably persisted (the loser's `settle()` retries, re-reads, finds the ref already set, no-ops). Same pre-existing exposure class as Licensing, not a regression.

---

## 8. Search Remediation

**File:** `services/search/src/application/search.use-cases.ts`, classes `UpsertDocument` and `DeleteDocument`.

Domain check confirmed the simple pattern is correct: `SearchIndex` has only 3 index-level statuses (`active`/`rebuilding`/`disabled`), no per-document intermediate status; `documentCount` is explicitly documented as _approximate_ ("the provider owns the true document set").

**Shape (both):** precheck (404 if missing) → `provider.upsert()`/`provider.delete()` outside any tx → settle (`withConcurrencyRetry`-wrapped, re-validates `active`, applies `recordDocumentUpserted`/`Deleted`, saves).

**Idempotency finding:** `IndexProviderPort`'s own doc comment and the use-cases' class doc comments confirm these calls are genuinely idempotent by design (no ack/reference token needed downstream, unlike PSP `collect()`). This makes Search's residual risk the **smallest** of the six contexts: a concurrent duplicate provider call is a safe no-op, not a financial exposure. Remaining gap: if `settle()`'s retry is exhausted under sustained contention, the provider-side write already happened but the local `documentCount`/event is never recorded — an under-count, self-healing on the next upsert/rebuild given the count is already documented as approximate. Not fixed — matches existing design intent, no schema/API change justified.

**Tests:** `upsert-document-transaction-boundary.test.ts` (6), `delete-document-transaction-boundary.test.ts` (6). RED: 4/6 failed in both (openCount 1; 3 concurrency runs each hit an uncaught `ConcurrencyError`). GREEN: 6/6 both. Full suite: 23/23. Typecheck: clean.

---

## 9. Notifications Remediation

**File:** `services/notifications/src/application/notification-lifecycle.use-cases.ts`, class `SendNotification` — A.14's "most load-sensitive instance."

**Shape:** `precheck()` (own tx: reads notification, computes `channel`/`rendered`/`idempotencyKey` = `<id>:attempt:<attempts.length>` **once**, threaded as return values, never on `this`) → `sendViaChannel()` (provider `.send()`, outside any tx — `in_app` makes no external call, handled as before) → `settleSuccess()`/`settleFailure()` (own tx each, `withConcurrencyRetry`-wrapped), mirroring how `RefundPaymentLifecycle` branches its own `settle(..., outcome)`.

### 9.1 Pre-existing defect found, confirmed, and deliberately NOT fixed

Empirically verified against the **unmodified** code before writing any fix: `notification-status.ts`'s `TRANSITIONS` table only allows `"failed"` to be reached from `"sent"` (`queued: ["sent","cancelled"]`, `retrying: ["sent","dead_letter","expired"]` — neither lists `"failed"`). `SendNotification` only ever runs from `queued`/`retrying`, so its failure branch's `markFailed()` call has always thrown `BusinessRuleError` — the catch converts it to `err(...)`, not the `ok({status:"failed"})` the code's shape (and this phase's own brief) assumed. Preserved exactly, pre- and post-fix (verified by test) — fixing the FSM is a business-semantics change out of this phase's scope.

**Tests:** `send-notification-transaction-boundary.test.ts`, 11 tests. RED (5/11 failed): openCount 1; a retry-after-settle-commit test showed the idempotency key correctly changes (not a bug, see below); 3 concurrency runs leaked uncaught `ConcurrencyError`. GREEN: 11/11. Full suite: 23/23 (`RetryNotification` and webhook/callback use cases unaffected). Typecheck: clean.

**Idempotency-key stability (verified honestly, not assumed):** stable across a crash between provider-success and settle-commit (retry re-derives the identical key, since nothing committed) and across genuine concurrency (all racers precheck-read the same `attempts.length`, present the same key, losers no-op against the already-`sent` row). **Not stable** across a blind retry of `execute()` on an already-`sent` notification — `attempts.length` has advanced, so a second call computes a different key and genuinely re-sends. Unchanged from pre-fix (no "already sent" precheck existed before this fix either) — documented as a residual risk, not fixed, since adding that guard would be a small behavior change beyond the transaction-boundary scope.

---

## 10. Finance N+1 Remediation

**File:** `services/finance/src/infrastructure/prisma-finance-repositories.ts`, `PrismaJournalRepository.findBySourceRef`.

**Before:** `for (const row of rows) { await db.ledgerEntry.findMany({ where: { journalId: row.id } }) }` — one query per journal row.
**After:** single `db.ledgerEntry.findMany({ where: { journalId: { in: rows.map(r => r.id) } } })`, grouped back per-journal via a `Map` built in one pass.

**Test:** `services/finance/src/infrastructure/journal-repository-n-plus-one.test.ts`, 3 tests, asserting exact query-call counts via a counting fake `Database`. RED (pre-fix loop temporarily restored): `expected 5 to be 1` (5 journals → 5 calls) and a related failure from the fake's `{journalId: row.id}` vs `{journalId: {in:[...]}}` shape mismatch. GREEN (fix restored): 3/3 pass. Full Finance suite: 25/25. Typecheck: clean (after fixing an `OutboxWriter<TransactionClient>` fake-typing gap the test surfaced — see §17).

No schema change; no API change. `findById` (single-journal lookup) was already correct and untouched.

---

## 11. Before/After Transaction Diagrams

**Full reserve → external → settle** (Fulfillment's `RequestReservation` — the one genuinely new durable-state case):

```
BEFORE:                                    AFTER:
BEGIN tx                                   BEGIN tx (reserve)
  find order                                 find order
  requestReservation()  [in-memory only]     requestReservation() → save   COMMIT
  inventoryPort.reserve()  ← network, tx OPEN
  confirmReservation()/failReservation()     inventoryPort.reserve()   ← no tx open
  save                                      BEGIN tx (settle, retry-wrapped)
COMMIT                                        confirm/failReservation() → save   COMMIT
```

**Simple precheck → external → settle** (Licensing, Shipping, Fulfillment's `CreateShipment`, Orders, Search, Notifications):

```
BEFORE:                                    AFTER:
BEGIN tx                                   BEGIN tx (precheck)
  find aggregate                             find aggregate, validate/short-circuit   COMMIT
  externalCall()  ← network, tx OPEN
  applyTransition()                          externalCall()   ← no tx open
  save                                      BEGIN tx (settle, retry-wrapped)
COMMIT                                        re-find, applyTransition(), save   COMMIT
```

Where a flow's business semantics genuinely differ (Orders' `RequestFulfillment` two-call partial-failure behavior; Notifications' success/failure branching; Licensing's best-effort ledger post), the diagram above is the skeleton — see each section above for the documented deviation.

---

## 12. Idempotency Analysis (cross-context summary)

| Context/Use-case                                    | External call has its own idempotency key?                    | Concurrent duplicate-call risk after this fix                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Fulfillment `RequestReservation`                    | N/A — protected by durable pre-call reservation write instead | **Provably prevented** (lock-step case); staggered-arrival edge case remains, documented                           |
| Search `UpsertDocument`/`DeleteDocument`            | Provider calls are idempotent by design                       | Smallest residual — duplicate call is a safe no-op                                                                 |
| Shipping `CreateLabel`/`VoidLabel`                  | Yes (`<id>:label`/`<id>:void`)                                | Present but mitigated by carrier-side idempotency key                                                              |
| Fulfillment `CreateShipment`                        | Yes (`<id>:shipment`)                                         | Present but mitigated by carrier-side idempotency key                                                              |
| Orders `RequestPaymentCapture`/`RequestFulfillment` | No                                                            | Present, verified (both racers do call the port), pre-existing not phase-introduced                                |
| Notifications `SendNotification`                    | Yes, but only stable within one "attempt slot"                | Present across genuine concurrency is closed (verified); NOT closed across a blind retry after send — pre-existing |
| Licensing `CollectInvoice`                          | **No idempotency key of any kind**                            | **Largest residual** — documented in code and here                                                                 |

No second idempotency system was invented anywhere; every fix reuses whatever mechanism (deterministic key, durable reservation, or provider-side idempotence) already existed for that call site.

---

## 13. Concurrency Results

Every new test file includes a `Promise.all`-based concurrent-call test, run 3 times in a loop where the fix's own report claims determinism (Fulfillment `RequestReservation`, Licensing, Shipping, Search, Orders, Notifications). Consistent findings across all 6 contexts:

- **No uncaught `ConcurrencyError` leaks to the caller** in any fixed flow (this was the RED-phase failure mode in every single context — confirms the fixes address a real, reproducible defect class, not a theoretical one).
- **No lost updates** — every settle step is `withConcurrencyRetry`-wrapped and idempotently no-ops against a row a racer already advanced.
- **No duplicate Finance/notification entries** — verified per-context (Notifications: exactly one `sent` attempt recorded across racers; Licensing: one persisted row, not a duplicate/corrupted write).
- Duplicate **external port/PSP calls** are prevented only where a durable pre-call write exists (Fulfillment `RequestReservation`) or the provider itself is idempotent (Search); everywhere else this remains a documented, pre-existing, not-phase-introduced residual risk (§12).

---

## 14. Failure Matrix

| Failure point                                              | DB state                                                                                                                                          | External state             | Retry-safe?                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before precheck/reserve                                    | unchanged                                                                                                                                         | unchanged                  | yes                                                                                                                                                                                                                                                                                                                                      |
| Precheck/reserve fails (validation)                        | unchanged                                                                                                                                         | unchanged                  | yes                                                                                                                                                                                                                                                                                                                                      |
| External call throws                                       | precheck-only contexts: unchanged (nothing was written yet); Fulfillment `RequestReservation`: left at durable `reservation_requested`, resumable | no external success        | yes (verified per-context)                                                                                                                                                                                                                                                                                                               |
| External call succeeds                                     | pending settlement                                                                                                                                | external success           | must be recoverable — settle step exists for exactly this in every fix                                                                                                                                                                                                                                                                   |
| Settle fails (e.g. concurrency exhaustion)                 | prior state remains, recoverable via retry                                                                                                        | external already succeeded | yes, bounded by `withConcurrencyRetry`'s attempt cap (5, matching Payments' precedent)                                                                                                                                                                                                                                                   |
| Process crash after external success, before settle commit | recoverable local state (nothing corrupted)                                                                                                       | external success           | yes for Shipping/Fulfillment `CreateShipment` (deterministic idempotency key re-presents identically); **narrower** for Licensing (no key at all — a crash-then-retry could re-charge); Notifications (key advances only after a commit, so a crash-before-commit retry is stable, but a retry after a _successful_ send is not, see §9) |

No crash-recovery window was silently assumed safe; every asymmetry above is called out in its context section.

---

## 15. Outbox/Event Analysis

No event contract or payload was changed anywhere in this phase. No new outbox mechanism was introduced. `notifyBestEffort`-style side effects (Orders/Shipping/Fulfillment's cross-context notify calls) remain exactly where they were — inside the settle transaction, best-effort, matching the established Payments precedent (`CapturePaymentLifecycle.settle`'s `financePort?.recordPaymentEvent`) that A.14 already reviewed and found safe. Security's `outbox.publish()` calls (§3) were re-confirmed safe-by-design and untouched.

---

## 16. Security Review

For every fixed call: authorization is unchanged (all fixes preserve the exact `NotFoundError`/`BusinessRuleError`/`ValidationError` shapes the pre-fix code returned, at the same point in the flow relative to any state mutation). Tenant isolation: untouched — no fix reads/writes outside the tenant scope the original repository calls already enforced. Idempotency scoping: unchanged per-context (§12). No sensitive data newly logged or exposed; no external identifier validation was weakened. No internal DB error is newly surfaced to a caller — all `ConcurrencyError`s that used to leak uncaught (the RED-phase failure mode) are now caught by `withConcurrencyRetry` before reaching the `Result`/thrown-error boundary callers see.

---

## 17. Repository-Wide Final Sweep

Re-ran the §3 sweep after all fixes. Result: **zero unexplained genuine external-call-inside-transaction violations remain.**

- All 9 A.14 sites: confirmed fixed (external call now runs between two committed transactions, verified both by direct source reading — see §5-9 code excerpts each agent captured — and by the `openCountAtCall === 0` regression tests).
- One incidental issue surfaced and fixed while verifying: the Finance N+1 regression test's fake `outbox` object didn't satisfy `OutboxWriter<TransactionClient>`'s full shape, failing repo-wide `pnpm typecheck` (not a violation of the phase's actual subject matter — a test-fixture typing gap). Fixed by casting the fake to the correct type; re-verified green.
- No new violations were introduced by any of the 6 fixes (confirmed by the same repo-wide grep pattern from §3, re-run post-fix, returning the identical 13-line result set — all 13 matches are calls now correctly positioned _outside_ their transactions per the diagrams in §11, i.e. `carrierProvider`/`shippingProvider`/`paymentPort`/`inventoryPort`/`shippingPort` calls in the fixed use-cases, plus Payments' and Returns' already-audited call sites, unchanged).

Classification of the one residual pattern found repo-wide (not a violation, but worth naming): Security's `outbox.publish()` calls remain inside their transactions — **Safe by design**, this is the transactional-outbox pattern's entire purpose.

---

## 18. Quality Gate Results

| Gate                                                | Result                                                                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (repo root, `turbo run typecheck`) | ✅ 78/78 tasks (69 cached, 9 fresh incl. all 6 touched packages)                                                                                                     |
| `pnpm lint`                                         | ✅ clean, exit 0                                                                                                                                                     |
| `pnpm test` (repo root)                             | ✅ 78/78 tasks, all green (incl. every new A.15 test file, all previously-hardened Payments/Returns/Admin/Runtime suites)                                            |
| `pnpm arch` (dependency-cruiser)                    | ✅ 0 violations, 1565 modules, 6788 dependencies (unchanged from A.14 — this phase added test files and modified application logic only, no new architectural edges) |
| `prisma validate`                                   | ✅ clean (`packages/db/prisma/schema`)                                                                                                                               |
| `prisma migrate status`                             | ❌ `P1001` — expected, no live DB reachable                                                                                                                          |

Individually re-verified (not just trusted from the root run): Payments 81/81, Returns 23/23, Admin 123/123, Runtime 174/174, plus each of the 6 fixed packages' own full suites (Licensing 29/29, Shipping 22/22, Fulfillment 28/28, Orders 58 passed/5 skipped, Search 23/23, Notifications 23/23, Finance 25/25).

---

## 19. Environment Limitations

**Real PostgreSQL load testing remains an A.14 environment blocker.** Per this phase's explicit constraint, no new remediation or load-test attempt was made. Current-state check only: `docker info` did not respond within 15 seconds and was left running in the background rather than chased further (no additional remediation attempted, per the brief's "DO NOT attempt another PostgreSQL load test in this phase"). `prisma migrate status` independently confirms the same `P1001` unreachable-database result A.14 documented. This is consistent with A.14's diagnosis (corrupted Docker Desktop AF_UNIX socket reparse point) — not re-diagnosed further, and not represented as newly investigated.

---

## 20. Remaining Risks

1. **Licensing's `collect()` has no idempotency key at all** — the largest residual concurrency exposure in this phase, pre-existing, documented in-code and in §4.1/§12. Recommended follow-up: thread an idempotency-key parameter through `PaymentsPort.collect()` (a port-signature change, deliberately not made in this phase).
2. **Orders' `RequestFulfillment` partial-failure orphan-reservation gap** — pre-existing, preserved exactly, documented in §7.
3. **Notifications' retry-after-successful-send re-send gap** — pre-existing, preserved exactly, documented in §9.
4. **Notifications' FSM defect** (`§9.1`) — `markFailed()` from `queued`/`retrying` always throws — pre-existing, unrelated to this phase's remediation subject, confirmed and left alone per the brief's "only fix if directly required."
5. **Fulfillment `RequestReservation`'s staggered-arrival duplicate-call edge case** (§6) — smaller, documented residual.
6. TLS-unenforced/RLS-absent/dead least-privilege-role findings from A.7/A.12/A.13/A.14 are unchanged — out of this phase's scope, not re-touched.
7. Real PostgreSQL capacity/concurrency/lock-contention/crash-recovery behavior remains completely unvalidated (§19) — every conclusion in this report about load-bearing behavior is necessarily provisional, exactly as A.14 stated.

---

## 21. Production Readiness Verdict

**Verdict: CONDITIONALLY PRODUCTION READY**

Reasoning: all 9 genuine transaction-boundary violations A.14 found are now closed, each with an independently-proven RED→GREEN regression test, and the repository-wide sweep found no new or missed violations. Concurrency behavior is deterministic everywhere (no uncaught `ConcurrencyError`, no lost updates, no duplicate Finance/notification records) even where duplicate _external_ calls remain possible. The Finance N+1 is closed. All previously-hardened flows (Payments A.4-A.11, Returns A.13.1) remain green — no regression. Repository-wide quality gates are entirely green.

This is an upgrade from A.14's **NOT PRODUCTION READY**, whose stated blocker was precisely "9 new, unremediated instances of [the long-transaction] anti-pattern" — now zero. It stays at _conditional_, not full, readiness because: (a) real PostgreSQL load/concurrency/lock-contention/crash-recovery evidence still does not exist for any context (§19, an environment limitation, not a code defect this phase could close); (b) several genuine, pre-existing concurrency/idempotency gaps remain open by design, documented in §20, most notably Licensing's keyless `collect()`; (c) the TLS/RLS/least-privilege-role gaps from A.7 persist untouched, as they have across five phases now.

---

## 22. Files Changed

**Modified (8 files, 1215 insertions / 261 deletions across application-layer use-cases + one infrastructure repository):**

- `services/licensing/src/application/billing.use-cases.ts`
- `services/shipping/src/application/shipment-lifecycle.use-cases.ts`
- `services/fulfillment/src/application/create-shipment.use-case.ts`
- `services/fulfillment/src/application/request-reservation.use-case.ts`
- `services/orders/src/application/order-lifecycle.use-cases.ts`
- `services/search/src/application/search.use-cases.ts`
- `services/notifications/src/application/notification-lifecycle.use-cases.ts`
- `services/finance/src/infrastructure/prisma-finance-repositories.ts`

**Added (9 test files, 76 new tests):**

- `services/licensing/src/collect-invoice-transaction-boundary.test.ts` (6)
- `services/shipping/src/shipment-lifecycle-transaction-boundary.test.ts` (9)
- `services/fulfillment/src/create-shipment-transaction-boundary.test.ts` (8)
- `services/fulfillment/src/request-reservation-transaction-boundary.test.ts` (11)
- `services/orders/src/request-payment-capture-transaction-boundary.test.ts` (8)
- `services/orders/src/request-fulfillment-transaction-boundary.test.ts` (8)
- `services/search/src/upsert-document-transaction-boundary.test.ts` (6)
- `services/search/src/delete-document-transaction-boundary.test.ts` (6)
- `services/notifications/src/send-notification-transaction-boundary.test.ts` (11)
- `services/finance/src/infrastructure/journal-repository-n-plus-one.test.ts` (3)

No file outside these 17 was touched by this phase's remediation work. (Separate, unrelated, pre-existing uncommitted changes under `services/orders/` from an earlier "Dashboard Orders Productization" sprint — `list-orders.use-case.ts`, `composition.ts`, `order.controller.ts`, `order-repository.ts`, etc. — predate this phase, confirmed by filesystem timestamps of 2026-08-09 vs. this phase's 2026-08-12, and were left untouched.)

No schema, migration, public API, or event-contract changes anywhere in this phase.

---

## 23. Tests Added

76 new tests across 9 files (§22), every one following the exploit-proof shape established by Payments' `create-intent-transaction-boundary.test.ts` (Phase A.13): a `TrackingUnitOfWork` counting currently-open `run()` calls, and a `PostgresLike...Repository` fake reproducing each aggregate's real optimistic-lock (`ConcurrencyError`) contract. Every fix's tests were proven RED against a temporarily-restored pre-fix implementation, then GREEN after restoring the fix — the causality the brief's Task 10 requires, not merely "tests that pass after the change."

---

## 24. Fixes Intentionally Rejected / Deferred

| Finding                                                                      | Why deferred                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Licensing `collect()` has no idempotency key                                 | Closing it needs a `PaymentsPort` signature change or a new persisted `Invoice` status — both explicitly out of scope absent a concrete defect requiring them; this is pre-existing, not phase-introduced                                                                  |
| Orders `RequestFulfillment` partial-failure orphan-reservation gap           | Needs a new persisted intermediate state per external call — a business-semantics change out of scope; behavior preserved exactly, not worsened                                                                                                                            |
| Notifications retry-after-successful-send re-send gap                        | Needs an "already sent" precheck guard — a small behavior addition beyond the transaction-boundary fix's scope; preserved exactly                                                                                                                                          |
| Notifications FSM defect (`markFailed` unreachable from `queued`/`retrying`) | Unrelated pre-existing defect surfaced incidentally; fixing the transition table is a business-semantics change explicitly out of this phase's remediation subject                                                                                                         |
| Fulfillment `RequestReservation` staggered-arrival duplicate-call edge case  | Needs a port-level idempotency key or lease; port signature intentionally unchanged                                                                                                                                                                                        |
| TLS enforcement, live DB least-privilege role wiring, RLS                    | Multi-phase-old (A.7-origin) structural gaps, explicitly out of this phase's "DO NOT introduce security architecture changes unless explicitly required by an actual finding" — none of this phase's findings are new enough in kind to justify overriding that constraint |
| Real PostgreSQL load/capacity/lock-contention/crash-recovery measurement     | Explicitly out of scope for this phase ("Do NOT attempt another PostgreSQL load test") — environment remains blocked per §19                                                                                                                                               |

---

## 25. Sprint Isolation

Per this project's standing sprint-isolation discipline: only the 17 files listed in §22 were changed by this phase's work. `git status --short` and `git diff --stat` were reviewed before finalizing this report to confirm no unrelated formatting changes, no dependency/lockfile churn, and no generated garbage were introduced. **Nothing was committed.**
