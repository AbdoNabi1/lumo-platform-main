# Lumo Platform — Architecture Remediation Plan

**Status:** Draft, pending approval. No code has been changed to produce this document.
**Source of truth:** `Lumo Platform Architecture Audit` (published artifact, dated 2026-07-26; scope: Catalog → Pricing → Promotions → Inventory → Checkout → Purchase Saga → Payments → Orders → Finance → Fulfillment → Shipping → Returns → Notifications).
**This document's method:** every one of the audit's 55 findings was re-opened and independently re-verified against the current repository (`C:\Users\abdoh\Claude code\Git\lumo-platform`) via 8 separate read-only code investigations, plus a dedicated pass reading the actual ADRs and governance docs the audit cites. Nothing below is taken on the audit's word alone.
**Verification date:** 2026-07-26 (same day as the audit — minimal drift window, but verification was still performed line-by-line, not assumed).

---

## 0. Verification Outcome Summary

| Result                                      | Count                   | Notes                                                                                                     |
| ------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| CONFIRMED (as originally described)         | 48                      |                                                                                                           |
| CONFIRMED, with a scope refinement          | 6                       | Original defect is real; one detail was narrower, mis-cited, or mis-attributed than stated — see §1 notes |
| ALREADY FIXED                               | 0                       |                                                                                                           |
| FALSE POSITIVE                              | 0                       |                                                                                                           |
| Original "Verified Clean" claims re-checked | 2 spot-checked          | 1 held fully clean (double-entry invariant); 1 was itself overstated (Order-row immutability — see §1.4)  |
| Objective gates re-run                      | `pnpm arch`, `pnpm dup` | Both reproduced exactly: 0 violations / 1,526 modules / 6,962 deps; 2.52% / 189 clones / 1,515 files      |

**Headline conclusion, unchanged from the audit:** the domain/persistence layer is genuinely strong (confirmed independently: optimistic locking, double-entry balance, append-only ledger, history-derived order status, tenant scoping, PII minimization, zero illegitimate cross-context imports all hold under direct inspection). **The integration layer connecting contexts together is not production-safe.** Deployment readiness remains **NO** until Phase A closes.

**One correction this re-verification adds that the original audit didn't have:** ADR-0053 (Engine Kernel, ratified 2026-07-19 — after the audit's own Anti-Goal-#10 framing was written but it's in the repo) **explicitly grandfathers** Analytics' hand-rolled expression evaluator as a known, deliberately-deferred fork, not an undiscovered violation. This downgrades one Cross-Cutting High finding to a documentation note (§4, D7). Promotions' and Feature Flags' forks are **not** grandfathered — those remain live findings.

---

## 1. Verified Findings Register

Each row: original finding ID (context-group prefix + number, matching the audit's own ordering) → verdict → the remediation item it rolls into (§3). Findings that are literally the same underlying defect surfaced from two contexts are marked "dup of."

### 1.1 Catalog / Pricing / Promotions / Inventory (CPI)

| ID     | Sev  | Finding                                                                                     | Verdict   | → Remediation Item |
| ------ | ---- | ------------------------------------------------------------------------------------------- | --------- | ------------------ |
| CPI-1  | CRIT | Prisma repo silently drops variant price/selection edits (`skipDuplicates` on unchanged PK) | CONFIRMED | A10                |
| CPI-2  | CRIT | Catalog persists its own price, duplicating Pricing's authority                             | CONFIRMED | B2                 |
| CPI-3  | HIGH | Pricing has no invariant against multiple concurrently-published prices                     | CONFIRMED | B8                 |
| CPI-4  | HIGH | Checkout silently zeroes non-cart-scoped promotion rewards                                  | CONFIRMED | B7                 |
| CPI-5  | MED  | No referential integrity Inventory↔Warehouse                                                | CONFIRMED | C2                 |
| CPI-6  | MED  | N+1 query in Inventory CheckAvailability                                                    | CONFIRMED | C1                 |
| CPI-7  | MED  | Promotions' domain authors the wire event-type itself (breaks translator-as-ACL)            | CONFIRMED | B5                 |
| CPI-8  | MED  | PricingRule aggregate built but never consulted for price computation                       | CONFIRMED | D2                 |
| CPI-9  | LOW  | Two stale doc comments (Catalog "immutable", Inventory README "in-memory only")             | CONFIRMED | D1                 |
| CPI-10 | LOW  | Inventory reservation set fully rewritten on every save                                     | CONFIRMED | C3                 |

### 1.2 Cart / Checkout / Purchase Saga (SAGA)

| ID         | Sev  | Finding                                                                                             | Verdict                                                                                                                                                                    | → Remediation Item |
| ---------- | ---- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| SAGA-1     | CRIT | Saga's `placeOrder` force-advances order to paid, bypassing payment-captured consumer               | CONFIRMED                                                                                                                                                                  | A1                 |
| SAGA-2     | CRIT | Durable Temporal path can never complete — zero `.signal()` call sites repo-wide                    | CONFIRMED                                                                                                                                                                  | A2                 |
| SAGA-3     | CRIT | Untrusted client `pspToken` directly captures payment, no PSP verification                          | CONFIRMED                                                                                                                                                                  | A1                 |
| SAGA-4     | CRIT | Saga activities not idempotent under Temporal retry (dup reservations/intents, infinite-retry hang) | CONFIRMED                                                                                                                                                                  | A3                 |
| SAGA-5     | HIGH | `reserveStock` has no partial-failure compensation across lines                                     | CONFIRMED                                                                                                                                                                  | A3                 |
| SAGA-6     | HIGH | No Cart↔Checkout lock coordination                                                                  | **CONFIRMED, narrower** — `Cart.lock()` exists and is reachable via an admin `LockCart` action (tested); the real gap is that `StartCheckout` never calls it automatically | C6                 |
| SAGA-7     | HIGH | No circuit breaker on PSP-facing saga activities (ADR-0012 §3 mandates one)                         | CONFIRMED                                                                                                                                                                  | C4                 |
| SAGA-8     | MED  | No heartbeats; flat 30s timeout instead of differentiated                                           | CONFIRMED                                                                                                                                                                  | C4                 |
| SAGA-9     | MED  | Manual saga reconciliation (`reconcile`/`manualResolve`) defined but operationally unreachable      | CONFIRMED                                                                                                                                                                  | C5                 |
| SAGA-10    | MED  | Saga submittable against an unlocked (still-editable) checkout session                              | CONFIRMED                                                                                                                                                                  | C6                 |
| SAGA-11    | MED  | `cancelPaymentIntent` reuses `FailPayment` as a workaround                                          | CONFIRMED                                                                                                                                                                  | C10                |
| SAGA-clean | —    | "Workflow determinism" (no Date.now/Math.random/I-O in workflow code)                               | CONFIRMED clean                                                                                                                                                            | —                  |

### 1.3 Payments (PAY)

| ID     | Sev  | Finding                                                                                              | Verdict                                                                                                                                                                                                   | → Remediation Item |
| ------ | ---- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| PAY-1  | CRIT | Webhook idempotency never Postgres-backed in production                                              | CONFIRMED                                                                                                                                                                                                 | A5                 |
| PAY-2  | CRIT | No real PSP adapter anywhere, even in "production" composition                                       | CONFIRMED                                                                                                                                                                                                 | A4                 |
| PAY-3  | CRIT | Webhook signature verification defined but never called; only route requires admin RBAC              | CONFIRMED                                                                                                                                                                                                 | A4                 |
| PAY-4  | CRIT | `payment-captured→MarkOrderPaid` consumer keys on an id that's never the order id for saga purchases | **CONFIRMED, with mitigation detail** — the saga itself doesn't hang on this (it force-advances separately, see SAGA-1), but every saga purchase now floods the DLQ with a permanently-unresolvable retry | A1                 |
| PAY-5  | HIGH | `CapturePaymentLifecycle` calls the PSP before the domain validates the transition                   | CONFIRMED                                                                                                                                                                                                 | B3                 |
| PAY-6  | HIGH | Two live, divergent PaymentIntent orchestration paths (legacy vs. explicit lifecycle)                | CONFIRMED                                                                                                                                                                                                 | B3                 |
| PAY-7  | HIGH | Explicit-lifecycle `captured` event has zero consumers anywhere                                      | CONFIRMED                                                                                                                                                                                                 | B3                 |
| PAY-8  | MED  | External PSP network calls execute inside the DB transaction                                         | CONFIRMED                                                                                                                                                                                                 | C7                 |
| PAY-9  | MED  | Legacy `refund()` bypasses the transition table, never reflects partial refunds                      | CONFIRMED                                                                                                                                                                                                 | C8                 |
| PAY-10 | MED  | Legacy `capture()`/`fail()` hand-roll eligibility checks instead of `canTransitionPayment`           | CONFIRMED                                                                                                                                                                                                 | C8                 |
| PAY-11 | MED  | No reconciliation path for admin-HTTP-triggered captures outside the saga                            | CONFIRMED                                                                                                                                                                                                 | C9                 |
| PAY-12 | LOW  | Duplicate parallel "captured" domain events under different type names                               | CONFIRMED                                                                                                                                                                                                 | B3                 |
| PAY-13 | LOW  | Unbounded JSON attempt log rewritten in full on every save                                           | CONFIRMED                                                                                                                                                                                                 | C15                |

### 1.4 Orders / Finance (OF)

| ID         | Sev  | Finding                                                                                            | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | → Remediation Item      |
| ---------- | ---- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| OF-1       | CRIT | Admin `markOrderPaid` accepts an arbitrary caller-supplied reference, no verification              | CONFIRMED — Doc 22 (`docs/architecture/22-context-map.md:57-58`) has **no stated exception**; the in-code comment claiming "sanctioned by doc 22" misquotes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A1                      |
| OF-2       | CRIT | Finance revenue-journal consumer's dedup marker is never atomic with its own ledger write          | CONFIRMED — `recordIfNew`'s optional `tx` param exists (ADR-0005) but is passed at **zero** call sites repo-wide                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A6                      |
| OF-3       | CRIT | Finance never consumes refunds/returns/fees/inventory adjustments — only sales                     | CONFIRMED — translators fully written, zero application-layer wrappers, zero runtime registration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | A6                      |
| OF-4       | HIGH | Parallel legacy lifecycle publishes `orders.order.paid`, which Finance never consumes              | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A6                      |
| OF-5       | HIGH | `orders.order.refunded` published with two incompatible payload schemas at the same `eventVersion` | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | B4                      |
| OF-6       | MED  | Ledger posting and fiscal-period close disagree on whether accounts must pre-exist                 | CONFIRMED — no default chart of accounts is ever seeded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | C11                     |
| OF-7       | MED  | Order carries two parallel status-mutation paths with overlapping vocabulary                       | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | B4                      |
| OF-8       | MED  | Fiscal-period close fully materializes the ledger with no date bound, N round-trips per account    | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | C11                     |
| OF-9       | LOW  | In-code comment misquotes doc 22 to justify the admin markPaid bypass                              | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A1 (fold into A1's fix) |
| OF-10      | LOW  | Every order transition carries the full item-line snapshot                                         | **CONFIRMED, but explicitly a documented intentional tradeoff in-code**, not an oversight                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | D5                      |
| OF-clean-A | —    | Double-entry balance invariant (`Journal.assertValid`)                                             | CONFIRMED clean — no bypass path exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                       |
| OF-clean-B | —    | "Ledger/order-history immutability — create-only, no update path"                                  | **PARTIALLY CONFIRMED — audit's clean claim was itself overstated.** True for the Finance ledger and the `order_events` history log. **False as stated for the Order aggregate's own row**: `PrismaOrderRepository.save()` does an in-place, version-guarded `updateMany` on the parent order row's _reference_ fields (paymentRef, fulfillmentRef, totals, addresses) — `status` itself stays history-derived and is never part of that update, so the core invariant (status is never directly settable) still holds, but "no update path" as a blanket claim does not. No remediation needed; noted for documentation accuracy only (D1). | —                       |

### 1.5 Fulfillment / Shipping / Returns (FSR)

| ID     | Sev  | Finding                                                                                                                                                 | Verdict                                                                                                                                                                                                                                                                                                                                                                                   | → Remediation Item                |
| ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| FSR-1  | CRIT | Fulfillment runs its own independent carrier-webhook receiver, contradicting Shipping's exclusive carrier ownership                                     | CONFIRMED — and the contradiction is visible in the _same file_: `fulfillment-order.ts:27-29`'s own doc comment states Shipping owns carrier integration exclusively, three lines from code that violates it                                                                                                                                                                              | B1                                |
| FSR-2  | CRIT | Carrier/warehouse webhook idempotency hardcoded in-memory in "production" across Fulfillment, Shipping, Returns                                         | CONFIRMED — real unique-constraint tables exist in all three schemas; zero Prisma implementations exist anywhere                                                                                                                                                                                                                                                                          | A5                                |
| FSR-3  | CRIT | Fulfillment manufactures a shipment-creation idempotency key that Shipping's `CreateShipment` silently discards (no parameter exists to receive it)     | CONFIRMED — code contains its own admission: "a pre-existing gap, not introduced here"                                                                                                                                                                                                                                                                                                    | A8                                |
| FSR-4  | CRIT | Returns→Inventory restock request has no compensation on failure and ignores its own success signal                                                     | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                 | A9                                |
| FSR-5  | CRIT | Documented "Finance consumes `returns.items.accepted`" integration is unwired and payload-incompatible                                                  | CONFIRMED — required fields (`refundMinor`, `restockCostMinor`) don't exist in the actual event; only invoked from Finance's own test file                                                                                                                                                                                                                                                | A6                                |
| FSR-6  | HIGH | Shipping's carrier-webhook handler never notifies Fulfillment/Notifications                                                                             | **CONFIRMED, minor naming detail off** — the audit's phrase "the same `announce()` helper every other use case in the file calls" is imprecise (that helper lives in a sibling file, and `record-carrier-webhook.use-case.ts` has no sibling use cases of its own to compare against) — but the substantive defect, that carrier-driven transitions never trigger a notification, is real | B11                               |
| FSR-7  | HIGH | Carrier failure/exception branches (`delivery_failed`, `exception`, `returned`) have no consumer anywhere                                               | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                 | B11                               |
| FSR-8  | HIGH | Generic admin "advance" endpoint can force carrier-owned states with no carrier evidence (Returns has an allowlist, Fulfillment/Shipping don't)         | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                 | B9                                |
| FSR-9  | HIGH | Near-identical carrier-webhook use cases in Fulfillment and Shipping have already drifted (`WEBHOOK_STATUSES` sets differ)                              | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                 | B1 (bundled with FSR-1's removal) |
| FSR-10 | HIGH | Warehouse callback permanently claimed before business validation, stranding legitimate retries — no `release()`/unclaim path exists on the port at all | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                 | C16                               |
| FSR-11 | MED  | Carrier/warehouse webhook routes rely on internal RBAC, not cryptographic proof of carrier origin                                                       | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                 | B10                               |
| FSR-12 | MED  | Typed `destination` field silently dropped across the Fulfillment→Shipping port boundary                                                                | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                 | C17                               |
| FSR-13 | MED  | Two aggregate methods hand-roll transition plumbing instead of the shared `transition()` primitive                                                      | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                 | D3                                |
| FSR-14 | LOW  | Carrier webhook `kind` free-text field persisted unvalidated                                                                                            | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                 | D4                                |

### 1.6 Notifications / Messaging (NOT)

| ID        | Sev  | Finding                                                                                                                                           | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                   | → Remediation Item |
| --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| NOT-1     | CRIT | Notifications never progress past `created` in production — nothing auto-queues/sends                                                             | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                 | A7a                |
| NOT-2     | CRIT | ~20-event documented catalog vs. one real consumer (`shipping.carrier.accepted` only)                                                             | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                 | A7a                |
| NOT-3     | CRIT | Payments, Returns, Fulfillment default to no-op notification stubs even in production composition (Orders is the sole exception, correctly wired) | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                 | A7b                |
| NOT-4     | CRIT | Finance revenue-journal consumer exposed to double-posting on redelivery                                                                          | CONFIRMED — dup of OF-2, same root cause, same fix                                                                                                                                                                                                                                                                                                                                                                                        | A6 (dup of OF-2)   |
| NOT-5     | HIGH | Fulfillment order creation has zero domain-level dedup, relies entirely on the non-atomic inbox marker                                            | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                 | C14                |
| NOT-6     | HIGH | Notification provider-callback idempotency store unconditionally in-memory, including production                                                  | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                 | A5                 |
| NOT-7     | HIGH | All four notification channels (email/SMS/push/webhook) hardcoded in-memory stubs, including production                                           | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                 | A7b                |
| NOT-8     | MED  | No retention/cleanup policy for processed-events inbox or outbox                                                                                  | **CONFIRMED, narrower** — true for the inbox; **false for the outbox**, which already has an hourly `outbox-prune` job wired into the scheduler (`apps/runtime/src/jobs.ts`)                                                                                                                                                                                                                                                              | C12                |
| NOT-9     | MED  | In-code comments claim false idempotency parity with `MarkOrderPaid`'s guard                                                                      | **CONFIRMED on the ADR mis-citation** (cites ADR-0003, transaction-context, when ADR-0005, atomic-consumer-idempotency, is the one that actually governs this); **not confirmed on "false parity claim"** — the Fulfillment consumer's own comment _explicitly disclaims_ parity ("unlike MarkOrderPaid's terminal-state guard, there is no domain-level duplicate detection here"); only Finance's phrasing is loosely worded, not false | D1                 |
| NOT-10    | LOW  | No redrive path exists for the dead-letter queue                                                                                                  | CONFIRMED — a manual runbook exists, no tooling backs it                                                                                                                                                                                                                                                                                                                                                                                  | C13                |
| NOT-clean | —    | "`recordIfNew`'s `tx` param is never passed anywhere" (underpins OF-2/NOT-4/FSR-2/PAY-1 etc.)                                                     | CONFIRMED — repo-wide grep, exactly 3 call sites, zero pass a third argument                                                                                                                                                                                                                                                                                                                                                              | —                  |

### 1.7 Cross-Cutting (XC)

| ID   | Sev  | Finding                                                                                                         | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | → Remediation Item                      |
| ---- | ---- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| XC-1 | HIGH | Analytics forks a second Expression Engine instead of composing `@platform/expression`                          | **CONFIRMED, but material context found**: ADR-0053 (2026-07-19, i.e. already in the repo before this audit) **explicitly names and grandfathers** Analytics' evaluator as a known, deliberately-deferred fork — "this ADR forbids new forks rather than mandating an immediate rewrite." Not an undiscovered violation.                                                                                                                                                                                                                                                                         | D7 (documentation-only, no code action) |
| XC-2 | HIGH | Promotions hand-rolls its own condition evaluator instead of the Rule Engine                                    | CONFIRMED — and unlike Analytics, **not** one of ADR-0053's two grandfathered exceptions; this is a genuine, currently-undocumented third fork                                                                                                                                                                                                                                                                                                                                                                                                                                                   | B6                                      |
| XC-3 | HIGH | Inventory `CheckAvailability` N+1                                                                               | CONFIRMED — dup of CPI-6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | C1 (dup of CPI-6)                       |
| XC-4 | HIGH | Pricing `ValidatePriceLines` N+1                                                                                | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | C1                                      |
| XC-5 | HIGH | Every external-provider port (PSP, carrier, all 4 notification channels) has zero real production adapters      | CONFIRMED — roll-up finding; concrete component items are A4 (PSP) and A7b (notification channels); no separate carrier-adapter item exists because Shipping's carrier port itself isn't in scope for this audit's "adapter" findings beyond the idempotency/boundary issues already covered                                                                                                                                                                                                                                                                                                     | A4 + A7b (roll-up, no separate item)    |
| XC-6 | MED  | Feature Flags reimplements targeting-rule matching outside the Rule Engine — third instance of the same pattern | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | B6                                      |
| XC-7 | MED  | Security's delegation/impersonation use cases have no HTTP route or runtime caller anywhere                     | CONFIRMED — fully built, fully tested, zero production reachability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | C18                                     |
| XC-8 | LOW  | Platform gap register materially understates how much production persistence wiring is already done             | **CONFIRMED, and the correction matters for planning**: direct inspection of all 39 `services/*/src/composition.ts` files shows **35 of 39 already have a working Prisma composition branch** — the register (dated 2026-07-04, largely unrefreshed) claims only Identity/Finance/Customer-360 do. The real remaining gap is narrower and different in kind: external-provider adapters (PSP/carrier/notification channels), not persistence wiring. This directly shapes Phase A scoping below — most of the "hard part" isn't building 35 Prisma adapters, it's the 4-5 external integrations. | D6                                      |

**Gate re-run:** `pnpm arch` reproduced exactly (0 violations, 1,526 modules, 6,962 dependencies). `pnpm dup` reproduced exactly (2.52%, 189 clones, 1,515 files). Governance fitness functions were not independently re-run (would require the full test/build toolchain); no evidence surfaced anywhere in the 8 investigations that contradicts the audit's "19/19 green" claim.

---

## 2. Systemic Themes (carried forward, now evidence-reinforced)

1. **Payment truth has no working enforcement anywhere in the reachable code paths.** Three independent bypasses (SAGA-1, SAGA-3, OF-1) plus the one mechanism that should be authoritative being permanently broken by an id-correlation bug (PAY-4) — all four independently re-confirmed. Doc 22's rule is stated with zero exceptions; no code path is exempt. → **A1 is the single highest-leverage fix in this entire plan.**
2. **Every outbound integration to the real world is a mock, including in "production" wiring.** PSP (PAY-2), all 4 notification channels (NOT-7), re-confirmed independently by the cross-cutting sweep (XC-5). Carrier integration itself was out of this audit's adapter-level scope, but the same shape almost certainly applies — flagged as a Phase A follow-up risk, not yet a filed finding.
3. **ADR-0005's atomic-idempotency mode is defined but has zero real call sites.** Confirmed by direct repo-wide grep in two independent investigations (OF and NOT groups): exactly 3 call sites of `recordIfNew`, none pass `tx`. This is one fix (the consumer-runtime wiring), not three — it just manifests as three separate CRIT findings (OF-2/NOT-4, FSR-2, PAY-1) because the pattern is repeated per-adapter.
4. **The Engine Kernel's "never fork a second condition DSL" rule has been violated twice live, once tracked-and-deferred.** Analytics is grandfathered by ADR-0053 (new information this pass adds). Promotions and Feature Flags are not — two live, undocumented forks remain.
5. **In-code comments assert safety guarantees the code doesn't provide.** Re-confirmed in Catalog (stale "immutable" docstring, contributed to CPI-1 shipping unnoticed), Orders/Finance (OF-9's doc-22 misquote), and Notifications (NOT-9's ADR mis-citation — though the "false parity" half didn't hold up as strongly as originally stated).

---

## 3. Remediation Items — Phase A (Production Blockers)

Every item below is a payment-truth violation, a broken saga/ledger-completion path, a missing webhook/idempotency guarantee, or a genuine data-loss bug — the mission's own Phase A criteria. Architectural-ownership violations (e.g. FSR-1, CPI-2) are deliberately **not** here even where the audit marked them Critical — see §4 for why, and note the sequencing flag on B1 given its real production risk.

### A1 — Enforce payment truth as event-derived only, everywhere

**Findings:** SAGA-1, SAGA-3, PAY-4, OF-1, OF-9
**Root cause:** No single mechanism enforces "order-paid is caused only by a captured-payment event" (doc 22). Three independent code paths currently assert it directly (saga force-advance, unverified client token, admin action), and the one consumer that should be authoritative is broken by an id-correlation bug (`orderRef` seeded with `checkoutSessionId`, never the real order id).
**Business impact:** Orders can be marked paid with zero money having moved — direct revenue-loss and fraud exposure on the platform's primary purchase flow.
**Architecture impact:** None — this _restores_ the already-documented architecture (doc 22, ADR-0012 §1); it does not change it.
**Risk level:** Critical.
**Proposed fix:**

1.  Fix the id-correlation bug: seed `PaymentIntent.orderRef` with the real order id once one exists, or add a `checkoutSessionId`-keyed lookup path to the consumer so it resolves for saga purchases.
2.  Remove the saga's direct `AdvanceOrder(to: "payment_received", ...)` call in `placeOrder`; rely exclusively on the (now-fixed) captured-event consumer.
3.  Require server-side PSP verification (signature or provider round-trip) before `CapturePayment` treats a `pspToken` as truth — this sub-step is blocked on A4 (a real PSP adapter existing) for full closure, but the caller-input check should be tightened immediately regardless.
4.  Remove the admin `markOrderPaid` action, or gate it behind a real verification call against Payments (no bare "non-empty string" check).
5.  Correct the misquoting in-code comment (OF-9) once the actual rule is enforced.
    **Why this preserves existing ADRs:** It implements ADR-0012 §1 and doc 22 exactly as written — no reinterpretation, no carve-out invented. It removes code that violates an already-ratified rule.
    **Public API changes:** The admin `markOrderPaid` HTTP action is removed or its contract changes (now requires a verifiable payment reference, not an arbitrary string) — this is a breaking admin-API change and needs a release note.
    **Event contract changes:** None. `payments.payment_intent.captured` and `orders.order.payment_received` payloads are unchanged; only the consumer's lookup key and the saga's control flow change.
    **Migration requirements:** None for data. Any in-flight saga workflows started before this deploy should be allowed to drain under the old (broken) path or be manually reconciled — coordinate with A2's rollout.
    **Estimated effort:** L (multi-file, cross-context, requires careful sequencing with A2).

### A2 — Make the Temporal saga completable

**Finding:** SAGA-2
**Root cause:** Nothing anywhere calls `handle.signal(paymentCapturedSignal, ...)`. The workflow's 15-minute capture timeout always fires.
**Business impact:** Every durable, Temporal-orchestrated purchase currently times out and compensates (cancels intent, releases reservation, fails checkout) — only the synchronous HTTP fallback can ever complete a sale today.
**Architecture impact:** None — implements the already-designed signal contract (ADR-0012).
**Risk level:** Critical.
**Proposed fix:** Implement a payments-captured consumer that resolves the running workflow's handle (by `checkoutSessionId`, the workflow id) and calls `.signal(paymentCapturedSignal, ...)`. This consumer should be the _same_ fixed consumer from A1, not a second one — reuse, don't fork.
**Why this preserves existing ADRs:** Directly implements ADR-0012's documented signal-based completion design; no design change.
**Public API changes:** None.
**Event contract changes:** None — consumes the existing `payments.payment_intent.captured` event.
**Migration requirements:** None.
**Estimated effort:** M. **Depends on A1** (same consumer, same correlation fix).

### A3 — Saga activity idempotency and partial-failure compensation

**Findings:** SAGA-4, SAGA-5
**Root cause:** `reserveStock`/`createPaymentIntent` mint fresh ids on every call with no dedup key; convergent activities (`commitReservation`, `completeCheckout`, `releaseReservation`) treat "already done" as a permanent business-rule failure, which Temporal retries forever with no DLQ/page. `reserveStock`'s per-line loop has no compensation for already-reserved lines on a mid-loop failure.
**Business impact:** Duplicate stock reservations/payment intents on transient retries; sagas can hang permanently and silently (retrying every 5 minutes forever) after any worker crash, with zero operator visibility; partial-failure checkouts leak reserved stock until TTL reclaim.
**Architecture impact:** None — implements ADR-0012 §2's "every activity independently retryable and idempotent" requirement, already documented.
**Risk level:** Critical.
**Proposed fix:** Key `reserveStock`/`createPaymentIntent` by `checkoutSessionId` for true idempotency (lookup-before-create). Make convergent activities treat "already in target state" as success, not `BusinessRuleError`. Track and release already-reserved lines on any mid-loop `reserveStock` failure before re-throwing.
**Why this preserves existing ADRs:** Implements ADR-0012 §2 exactly as written.
**Public API changes:** None (internal activity contracts only).
**Event contract changes:** None.
**Migration requirements:** None.
**Estimated effort:** L.

### A4 — Real PSP adapter + working webhook signature verification

**Findings:** PAY-2, PAY-3
**Root cause:** `InMemoryPaymentProvider` is hardcoded in both branches of Payments' composition root, including when a real Prisma client is supplied. `verifyWebhook` is defined on the port but has zero call sites. The only webhook route requires an authenticated admin RBAC principal — architecturally impossible for a real PSP to call.
**Business impact:** The platform cannot charge or refund a real customer today, full stop. Even once wired, without signature verification, a forged webhook payload is indistinguishable from a genuine PSP callback.
**Architecture impact:** None — the port is already correctly designed (ADR-0012 §4, "provider choice per tenant is composition/config"); this just builds behind it and fixes the composition seam.
**Risk level:** Critical.
**Proposed fix:**

1.  Build at least one real PSP adapter (Stripe or equivalent) implementing the existing `PaymentProvider` port, config-selectable per ADR-0012 §4.
2.  Build a dedicated, unauthenticated-but-signature-verified public webhook route that calls `psp.verifyWebhook` before `RecordWebhook` runs — separate from the existing admin-RBAC route (which can stay for manual/admin replay use).
3.  Interim mitigation (can ship independently, S effort): make the in-memory provider fail loudly (throw, not silently succeed) when `deps.prisma !== undefined`, so a misconfigured production deploy errors immediately instead of silently no-op'ing.
    **Why this preserves existing ADRs:** Implements ADR-0012 §4 exactly; adds no new architectural concept.
    **Public API changes:** A new public (unauthenticated, signature-gated) HTTP route is added. The existing admin webhook route's meaning should be clarified (manual replay only) in docs.
    **Event contract changes:** None.
    **Migration requirements:** Provider credentials/config need a secrets-management story (env-var/secret-manager, no hardcoding).
    **Estimated effort:** XL for the full real adapter; S for the interim fail-loud mitigation — ship the mitigation first as its own sprint, then the adapter as a larger follow-on.

### A5 — Webhook/callback idempotency stores → Postgres-backed everywhere

**Findings:** PAY-1, FSR-2, NOT-6
**Root cause:** Five separate contexts (Payments, Fulfillment, Shipping, Returns, Notifications) each have a real, unique-constrained Postgres table designed exactly for this purpose, and each one is unconditionally wired to an in-memory store instead — including in every composition root's "production" branch.
**Business impact:** Any restart or horizontally-scaled replica loses all webhook/callback dedup state; a provider's routine at-least-once redelivery gets reprocessed as new, double-recording attempts or double-transitioning aggregates.
**Architecture impact:** None — implements ADR-0005 exactly as designed; tables already exist in every affected schema.
**Risk level:** Critical.
**Proposed fix:** Implement one `Prisma*Store` class per context (5 total, mechanically identical pattern: `INSERT ... ON CONFLICT DO NOTHING` guarded by the existing unique constraint), wire each into its composition root's Prisma branch.
**Why this preserves existing ADRs:** Implements ADR-0005 exactly; the tables and the port contracts were already designed for this.
**Public API changes:** None.
**Event contract changes:** None.
**Migration requirements:** None — tables already exist and are unused, so there's no backfill.
**Estimated effort:** M total (5 small, mechanically similar, independently-releasable changes — see roadmap, sprints A5a–A5e).

### A6 — Finance ledger completeness and atomic idempotency

**Findings:** OF-2, OF-3, NOT-4 (dup of OF-2), FSR-5, OF-4
**Root cause:** (a) The Kafka consumer runtime commits the handler, then separately (non-atomically) records the dedup marker — `recordIfNew`'s `tx` parameter is never passed anywhere in the repo. (b) Refund/return/fee/inventory-adjustment translators are fully written but have no application-layer wrapper or runtime consumer registration. (c) The one returns-integration that is "wired" (`returns.items.accepted`) requires payload fields (`refundMinor`, `restockCostMinor`) that don't exist on the actual event and is only ever invoked from Finance's own test file. (d) The legacy `orders.order.paid` event stream (admin-backoffice orders) is never consumed by Finance at all.
**Business impact:** Revenue is recognized on every sale but never reversed on refund/return — reported revenue and profit are systematically and unboundedly overstated the moment any refund occurs. A crash during redelivery can silently double-post the same sale. Any order placed via the admin backoffice tool never appears in the ledger even when genuinely paid.
**Architecture impact:** None — implements ADR-0024 (Finance is the financial source of truth, fed by orders/payments/inventory/pricing events) and ADR-0005 exactly as designed.
**Risk level:** Critical.
**Proposed fix:**

1.  Wire `tx` through to `recordIfNew` from the Kafka consumer runtime (or add a domain-level duplicate guard on `Journal.append` keyed by source event id) — closes the atomicity gap for every consumer at once, not just Finance's.
2.  Build the missing application-layer use-case wrappers (mirroring `PostOrderPaidJournal`) for refunds, returns, fees, and inventory adjustments; register the corresponding Kafka consumers at the composition root.
3.  Add the missing `refundAmountMinor`/restock-cost data to the `returns.items.accepted` payload (likely sourced from Inventory/Pricing, since Returns doesn't own cost data) — this is an event-contract change, see below — then wire a real `EventHandler` subscription.
4.  Wire a Finance consumer for `orders.order.paid` (legacy path) alongside the existing `orders.order.payment_received` consumer, or retire the legacy path once callers migrate (coordinate with B4).
    **Why this preserves existing ADRs:** All four sub-fixes implement already-ratified ADRs (0005, 0024) and the already-documented event catalog; none require a new ADR.
    **Public API changes:** None.
    **Event contract changes:** **Yes, for step 3** — `returns.items.accepted`'s payload gains fields it currently lacks. This is additive (new optional→required fields need a version bump or careful default handling) and needs coordination with whichever context sources the cost data.
    **Migration requirements:** None for the atomicity fix. Step 2/3 may need a one-time backfill decision (should historical unposted refunds/returns be journaled retroactively, or does the ledger start clean from deploy day?) — **this is a business decision, flag for stakeholder sign-off before implementation, not an engineering default.**
    **Estimated effort:** L (largest single item in Phase A — recommend splitting into sub-sprints, see roadmap A6a–A6d).

### A7a — Notifications auto-progression + missing consumers wired

**Findings:** NOT-1, NOT-2
**Root cause:** `QueueNotification`/`SendNotification` are exposed only as admin-gated HTTP routes; nothing production-side ever calls them. Of ~20 documented event types Notifications should consume, exactly one consumer (`ShipmentShippedConsumer`) is real.
**Business impact:** Every order-confirmation and shipment-notification created through the real purchase flow sits inert in `created` status forever unless an admin manually intervenes per notification — customer communication is effectively non-functional today.
**Architecture impact:** None — implements Notifications' own documented ownership of full delivery orchestration.
**Risk level:** Critical.
**Proposed fix:** Add a worker (event-driven preferred over polling, matching the platform's existing outbox/Kafka pattern) that automatically progresses `created`→`queued`→`sent` for eligible notifications; implement and register the missing event consumers per the documented catalog (return lifecycle, fulfillment/shipping tracking, low-stock, consent, invites), prioritized by the ones tied to the purchase flow first (order fulfilled/shipped, delivery failure).
**Why this preserves existing ADRs:** No new architectural concept — closes a documented-but-unbuilt gap.
**Public API changes:** None.
**Event contract changes:** None — consumes already-existing, already-cataloged events.
**Migration requirements:** None.
**Estimated effort:** M for the auto-progression worker; L for the full consumer catalog (recommend phased delivery — see roadmap A7a-i / A7a-ii).

### A7b — Real notification provider adapters

**Findings:** NOT-3, NOT-7
**Root cause:** All four channels (email/SMS/push/webhook) are hardcoded in-memory stubs in every composition root, including "production." Payments/Returns/Fulfillment additionally default to a no-op `InMemoryNotificationPort` even when Orders (the one correctly-wired context) proves the real pattern exists.
**Business impact:** Even once A7a's orchestration is fixed, no channel actually delivers anything externally — `SendNotification` reports success while doing nothing. Payment-failure and return-decision notifications are silently dropped for three whole contexts.
**Architecture impact:** None.
**Risk level:** Critical.
**Proposed fix:** Build real provider adapters (e.g. SES/SendGrid for email, Twilio for SMS, FCM/APNs for push, a generic signed-webhook sender) behind the existing ports, wired at the composition root. Build `Real{Payments,Returns,Fulfillment}NotificationPort` adapters analogous to Orders' existing one, and wire them at `apps/runtime`'s composition.
**Why this preserves existing ADRs:** No new architecture — extends an already-correct port design.
**Public API changes:** None.
**Event contract changes:** None.
**Migration requirements:** Provider credentials/config, same secrets-management note as A4.
**Estimated effort:** L per channel (recommend phased: wire Payments/Returns/Fulfillment to the _existing_ Orders-pattern port first — S effort, immediate risk reduction — then build real channel adapters one at a time, starting with email as the highest-value channel).

### A8 — Fulfillment→Shipping idempotency key threading

**Finding:** FSR-3
**Root cause:** Fulfillment generates an idempotency key for shipment creation; the port that forwards the request to Shipping never passes it through, and `CreateShipment` has no parameter to receive it at all.
**Business impact:** A timeout/retry on shipment creation — even when the first call already succeeded — creates a second `Shipment` aggregate, and once a real carrier adapter exists (A4/A7b's sibling work), potentially two real carrier labels/bookings.
**Architecture impact:** None — closes an admitted pre-existing gap.
**Risk level:** Critical (compounds directly with any future carrier-adapter work — must close before carrier integration goes live).
**Proposed fix:** Add an idempotency-key parameter to `CreateShipment` (dedup on `fulfillmentRef`+key); thread Fulfillment's already-generated key through the port.
**Why this preserves existing ADRs:** Implements ADR-0005's idempotency pattern at a boundary that currently has none.
**Public API changes:** `CreateShipment`'s input type gains a required field — internal contract change only (not a public HTTP API).
**Event contract changes:** None.
**Migration requirements:** None.
**Estimated effort:** M.

### A9 — Returns→Inventory restock compensation

**Finding:** FSR-4
**Root cause:** `AcceptItems` commits the accept-items transition first; the subsequent `requestRestock` call has no try/catch and its `{accepted: boolean}` result is never inspected.
**Business impact:** Items are marked accepted (customer refunded/replaced) but never restocked, permanently under-counting on-hand inventory with no audit trail of the discrepancy.
**Architecture impact:** None.
**Risk level:** Critical.
**Proposed fix:** Check `.accepted`; on failure, route the restock request through a durable outbox/retry mechanism (matching the pattern already used elsewhere in this codebase for cross-context calls) rather than a fire-and-forget synchronous call after commit.
**Why this preserves existing ADRs:** Uses the platform's existing outbox pattern; no new mechanism invented.
**Public API changes:** None.
**Event contract changes:** Possibly additive — a new "restock failed/pending" internal event may be needed to drive the retry, depending on implementation choice.
**Migration requirements:** None.
**Estimated effort:** M.

### A10 — Catalog variant-edit data-loss fix

**Finding:** CPI-1
**Root cause:** On variant update, `deleteMany(id NOT IN new-ids)` then `createMany({skipDuplicates: true})` — an edited (id-unchanged) variant is neither deleted nor a new PK, so `skipDuplicates` silently skips writing it. Price/currency/selection edits never reach the row; the use case still returns 200 and increments the version.
**Business impact:** An admin editing a variant's price sees success, but the stored price silently reverts on next read — untested code path (only add/remove is covered by the integration suite).
**Architecture impact:** None — pure persistence-adapter bug, domain layer is already correct.
**Risk level:** Critical (silent data loss on a merchant-facing admin action).
**Proposed fix:** Replace delete+createMany with per-variant upsert (or explicit `updateMany`-by-id for surviving variants + `createMany` only for genuinely new ones).
**Why this preserves existing ADRs:** None — pure bugfix, no architectural surface touched.
**Public API changes:** None.
**Event contract changes:** None.
**Migration requirements:** None (no schema change) — but consider a data-audit query to check whether any production variant edits have already silently failed, if this has been live.
**Estimated effort:** S.

---

## 4. Remediation Items — Phase B (Architectural Corrections)

Boundary/ownership violations, duplicate event schemas, and parallel lifecycles — the mission's explicit Phase B category. **Sequencing note:** B1 and B2 were marked Critical by the original audit because they carry real production risk (state divergence, dual price authority) even though their _nature_ is architectural correction, not an operational-safety gap. They are sequenced first within Phase B and should not be deferred as if they were cosmetic.

### B1 — Remove Fulfillment's duplicate carrier-webhook receiver

**Findings:** FSR-1, FSR-9
**Root cause:** Fulfillment independently claims and processes carrier webhooks directly, contradicting the explicit (code-comment-documented, 2026-07-26) architecture correction that Shipping owns all carrier integration exclusively. The two implementations have already drifted (`WEBHOOK_STATUSES` differs).
**Business impact:** A carrier or misconfigured relay posting to Fulfillment's endpoint sets fulfillment status without Shipping ever recording the corresponding fact — the two contexts can silently diverge, corrupting the single source of truth downstream consumers rely on.
**Architecture impact:** This _is_ the fix to a boundary violation — removes a second, unauthorized ingress point for carrier facts.
**Risk level:** High (real production risk despite being classified architectural).
**Proposed fix:** Delete `RecordCarrierWebhook`, its route, and its idempotency store from Fulfillment entirely. Fulfillment should learn shipment facts only via a consumer of Shipping's own carrier events (which needs to exist — see B11, which must land first or alongside this).
**Why this preserves existing ADRs:** It's the literal enforcement of an already-made architecture decision (the 2026-07-26 correction, present in code comments across Fulfillment's `fulfillment-order.ts`, `ports.ts`, and `composition.ts`). **Recommend formalizing this correction as a proper ADR** (it currently exists only as code comments and a sprint report, per the ADR/governance investigation) — this is the one place in this plan where writing a new ADR is justified, precisely because the decision already exists and just needs to be made durable and discoverable the way every other cross-context boundary rule is.
**Public API changes:** The `POST /fulfillments/:id/webhook` admin route is removed — breaking change for any caller (should be none, since it contradicts documented architecture, but verify via access logs before removal).
**Event contract changes:** None to existing events; Fulfillment gains a new _consumer_ of Shipping's existing carrier events (no new event needed if B11 wires `announce()` correctly).
**Migration requirements:** None. Coordinate rollout with B11 so Fulfillment doesn't lose carrier-fact visibility mid-migration.
**Estimated effort:** M.

### B2 — Remove Catalog's duplicated price fields

**Finding:** CPI-2
**Root cause:** Catalog's `Variant` persists `priceAmountMinor`/`currency` alongside `sku`/`selection`, even though Checkout's real pricing-validation path reads exclusively from Pricing's own aggregate and never touches Catalog's copy.
**Business impact:** Two authoritative-looking prices per SKU with no sync mechanism; any future UI/report built against Catalog's variant price (a natural thing to build) will diverge from what Checkout actually charges.
**Architecture impact:** Restores the documented context-map rule ("Pricing is the only legitimate origin of a price," `docs/architecture/22-context-map.md:13`).
**Risk level:** High.
**Proposed fix:** Remove `price`/`priceAmountMinor`/`currency` from Catalog's `Variant`/`ProductVariant` entirely (domain, use cases, schema).
**Why this preserves existing ADRs:** It's the literal enforcement of the context-map's already-stated ownership rule; no new rule invented.
**Public API changes:** Any Catalog API response currently exposing variant price changes shape — audit consumers before removal (likely none real, given Checkout doesn't use it, but verify admin UI doesn't display it as authoritative).
**Event contract changes:** If Catalog's event translator currently includes price in any published event, that field is removed — check `catalog`'s event translator for this before finalizing scope.
**Migration requirements:** Schema migration to drop the columns; run only after confirming zero live readers (grep + a deploy-time feature-flag window is a reasonable safety net, but this doesn't require a new persistent flag/ADR — a short-lived rollout toggle is fine and self-removes).
**Estimated effort:** M.

### B3 — Converge Payments' two parallel PaymentIntent lifecycles

**Findings:** PAY-5, PAY-6, PAY-7, PAY-12
**Root cause:** A "legacy" lifecycle (`capture()`/`fail()`/`refund()`) and an "explicit lifecycle" (`transition()`-based) both operate on the same `PaymentIntent` table with no mutual recognition — the saga drives one, admin-HTTP drives the other. The explicit lifecycle's `captured` event has zero consumers. The PSP is called before domain validation in the lifecycle path.
**Business impact:** Nothing prevents an operator independently capturing/advancing an intent the saga is also driving; an admin-initiated capture via the "new" lifecycle has no real integration path to Orders/Finance at all (event nobody consumes).
**Architecture impact:** Consolidates onto one lifecycle — this _is_ the "parallel lifecycles" correction the mission names as a Phase B example.
**Risk level:** High.
**Proposed fix:** Pick the transition-table-based explicit lifecycle as canonical (it's the more complete/correct one — validated transitions, partial-refund status support). Migrate the saga's activities onto it. Retire the legacy `capture()`/`fail()`/`refund()` methods and their bespoke event types. As part of this, fix PAY-5 (validate transition before calling PSP) since it's touching the same code either way.
**Why this preserves existing ADRs:** No ADR mandates two lifecycles — this converges onto the one that already correctly implements ADR-0012's transition-table pattern.
**Public API changes:** None to public HTTP surface (admin routes already target the explicit lifecycle); the saga's internal activity calls change.
**Event contract changes:** **Yes** — `payments.payment_intent.captured` (legacy) and `payments.intent.captured` (explicit) converge onto one canonical event. This is the audit's own PAY-12 finding resolving itself as a side effect. Needs a deprecation window if any external consumer depends on the legacy event name (grep confirms only Orders' now-being-fixed consumer does, per A1).
**Migration requirements:** Coordinate tightly with A1 (same consumer, same event) — **do not schedule B3 before A1 lands**, since A1 needs the "current" consumer working first, and B3 changes what that consumer listens to.
**Estimated effort:** L. **Sequencing:** after A1/A2, since it touches the exact consumer those fixes just stabilized.

### B4 — Converge Orders' two parallel status-mutation paths

**Findings:** OF-5, OF-7
**Root cause:** A legacy `place()`/`markPaid()`/`refund()` path and a generic `transition()`-based checkout-lifecycle path both live on `Order`, both able to reach "refunded" — and do, via two structurally incompatible event payloads (`order-refunded.event.ts` lacks `orderId`; `order-transitioned.event.ts` has it) published to the identical wire topic at the same `eventVersion`.
**Business impact:** Any future consumer of `orders.order.refunded` intermittently receives a payload missing `orderId`/`items`/`netMinor` depending on which lifecycle produced it — crash or silently wrong postings. Already directly caused the schema-collision finding.
**Architecture impact:** Consolidates onto one status-mutation mechanism — the mission's "parallel lifecycles" Phase B category, and also resolves the "duplicate event schemas" category (OF-5) as one fix.
**Risk level:** High.
**Proposed fix:** Migrate `place`/`markPaid`/`refunded` onto the generic `transition()` mechanism; delete the bespoke methods and event classes. Coordinate with A6 (Finance's consumer for `orders.order.paid`) — once the legacy path is retired, that consumer becomes unnecessary rather than needing to be added, which changes A6's step 4 scope if sequenced after B4.
**Why this preserves existing ADRs:** No ADR mandates two lifecycles; this converges onto the already-correct generic pattern.
**Public API changes:** None.
**Event contract changes:** **Yes** — `orders.order.refunded`'s legacy schema (no `orderId`) is retired; only the checkout-lifecycle schema remains. Needs a version bump or a deprecation window for any external consumer of the legacy shape.
**Migration requirements:** None for data (append-only event log is unaffected retroactively).
**Estimated effort:** M. **Sequencing:** Recommend doing this _before_ A6 step 4 (the "wire a consumer for orders.order.paid" sub-step) — if B4 retires the legacy path first, A6 doesn't need to build a consumer for an event that's about to disappear. Flagging this dependency explicitly in the roadmap.

### B5 — Promotions: move wire-event-type authorship from domain to translator

**Finding:** CPI-7
**Root cause:** Promotions' domain aggregate authors the final wire event-type string itself (`data.event` field), instead of only the translator assigning it — the one context where the domain layer directly encodes the wire contract.
**Business impact:** Low today, but any future wire-contract versioning independent of the domain concept requires touching domain code, and nothing prevents a silent contract change.
**Architecture impact:** Restores the "translators are the ACL" rule (`docs/architecture/22-context-map.md:62-64`, reinforced by ADR-0006).
**Risk level:** Medium.
**Proposed fix:** Give `Promotion` plain domain event classes per transition (matching every other context's pattern); have the translator map them to `promotions.promotion.*` wire types explicitly.
**Why this preserves existing ADRs:** Implements ADR-0006's already-stated ACL boundary exactly.
**Public API changes:** None (wire event types stay the same strings, just relocated in authorship).
**Event contract changes:** None in payload/shape — purely an internal refactor.
**Migration requirements:** None.
**Estimated effort:** M.

### B6 — Promotions & Feature Flags: migrate onto the Rule/Expression Engine

**Findings:** XC-2, XC-6
**Root cause:** Both contexts hand-roll a closed-enum condition/targeting switch instead of composing `@platform/rules`/`@platform/expression`, violating ADR-0053's Anti-Goal #10 ("never fork a second condition DSL"). Unlike Analytics, neither is grandfathered.
**Business impact:** Every new promotion condition type or flag-targeting rule requires a code deploy instead of data configuration; no explainability ("why did this promo apply") for support/audit — Customer-360's Segmentation Engine proves the correct composed pattern was known and available.
**Architecture impact:** Closes two of the three live Anti-Goal-#10 violations (the third, Analytics, is intentionally deferred per ADR-0053 — see D7).
**Risk level:** Medium (High business value, but no active production-safety bug).
**Proposed fix:** Migrate `PromotionCondition` onto `@platform/rules`' `RuleSet` with `@platform/expression` as the condition language. Fold Feature Flags' targeting into the same migration or explicitly document the exemption if targeting truly is closer to a technical gate than a business rule (the audit itself notes this nuance — a documented exemption is an acceptable outcome for Feature Flags specifically, a full migration is not optional for Promotions given ADR-0053's explicit consumer list).
**Why this preserves existing ADRs:** Implements ADR-0053 exactly as ratified; ADR-0053 already names Promotions as an intended consumer.
**Public API changes:** None expected (internal evaluation mechanism swap).
**Event contract changes:** None.
**Migration requirements:** Existing promotion/flag condition data needs a one-time transform into the new rule representation — real migration work, not just code.
**Estimated effort:** M–L for Promotions; S (to document the exemption) or M (to migrate) for Feature Flags — recommend documenting the Feature Flags exemption now and revisiting migration only if/when flag-targeting complexity grows, since the audit itself judges this the weaker case of the two.

### B7 — Promotions/Checkout: fail closed on unsupported reward types

**Finding:** CPI-4
**Root cause:** Checkout's `sumCartRewardDiscount` only sums `cart`-scoped `percentage`/`fixed` rewards; product/category/shipping-scope and `free_shipping`/`buy_x_get_y` silently contribute $0 while the port still reports `valid: true`. Promotions' creation API allows configuring these reward types today with no guard.
**Business impact:** A merchant configures "20% off Product X" or a BOGO promotion; a customer applies it, sees it accepted, and gets a $0 discount at checkout — a broken-promotion incident with no error surfaced anywhere.
**Architecture impact:** None — this is a completeness gap in the cross-context port, not an ownership violation.
**Risk level:** High (silent customer-facing pricing bug).
**Proposed fix:** Reject unsupported reward scope/kind at `CreatePromotion` time (fail closed) until the port is extended to carry per-line detail for all reward shapes. Extending the port to actually support the missing reward types is a larger follow-on, not required to close the immediate risk.
**Why this preserves existing ADRs:** No ADR governs this; pure defensive-validation fix.
**Public API changes:** `CreatePromotion` now rejects previously-silently-accepted inputs — behavior change, needs a release note for merchant-facing tooling.
**Event contract changes:** None.
**Migration requirements:** Audit any already-created promotions using unsupported reward types before this ships; they'll need to be fixed or explicitly grandfathered.
**Estimated effort:** M.

### B8 — Pricing: enforce single-published-price invariant

**Finding:** CPI-3
**Root cause:** No unique constraint or transactional unpublish-on-publish exists for product+currency; `ValidatePriceLines` takes the first match from an unordered query result with no `ORDER BY` guarantee.
**Business impact:** A retried/duplicate `CreatePrice` call creates two published prices; which one Checkout validates against becomes nondeterministic across requests — a customer could be charged a stale or wrong amount.
**Architecture impact:** None — implements the determinism implied by "Pricing is the only legitimate origin of a price," doesn't change ownership.
**Risk level:** High.
**Proposed fix:** `publish()` transactionally unpublishes any prior published price for the same product+currency; add a partial unique index as a backstop.
**Why this preserves existing ADRs:** Strengthens the already-stated context-map rule; no new rule.
**Public API changes:** None.
**Event contract changes:** None.
**Migration requirements:** A data-cleanup pass may be needed if any product+currency already has multiple published prices in production — check before adding the unique index (it will fail to apply otherwise).
**Estimated effort:** M.

### B9 — Restrict generic admin "advance" endpoints from carrier-owned states

**Finding:** FSR-8
**Root cause:** `AdvanceFulfillment`/`AdvanceShipment` accept any target state with no allowlist; Returns has an `ADVANCE_STATUSES` allowlist protecting exactly this class of state.
**Business impact:** A compromised or misused admin credential can mark any fulfillment/shipment "delivered" with no actual delivery — e.g. to fraudulently close an order or suppress a delivery-failure investigation.
**Architecture impact:** Restores consistency with Returns' already-correct pattern — not a new architectural rule, an existing one applied unevenly.
**Risk level:** High.
**Proposed fix:** Add an allowlist to `AdvanceFulfillment`/`AdvanceShipment` mirroring Returns' `ADVANCE_STATUSES`, restricting admin-forced targets to non-carrier-sourced states.
**Why this preserves existing ADRs:** Matches an already-correct sibling implementation; no new rule.
**Public API changes:** The admin "advance" endpoint now rejects previously-accepted target states — behavior change, needs a release note.
**Event contract changes:** None.
**Migration requirements:** None.
**Estimated effort:** S.

### B10 — Carrier/warehouse webhook authentication: HMAC instead of RBAC-only

**Finding:** FSR-11
**Root cause:** Carrier/warehouse webhook routes use the same internal `AdminGuard` permission check as every other admin action — no cryptographic proof the request actually came from the named carrier.
**Business impact:** Anyone holding (or having stolen) an internal webhook-scoped credential can forge arbitrary carrier state transitions.
**Architecture impact:** None.
**Risk level:** Medium (compounds with A4/A7b — once real carrier/PSP integration exists, this becomes higher-severity).
**Proposed fix:** Add carrier-specific HMAC/signature verification as a distinct middleware before these use cases run, matching the same pattern recommended for A4's PSP webhook.
**Why this preserves existing ADRs:** None governs this specifically; standard security hardening.
**Public API changes:** None to the route shape; adds a required header/signature.
**Event contract changes:** None.
**Migration requirements:** Coordinate secret provisioning with whichever real carrier adapter eventually lands.
**Estimated effort:** M.

### B11 — Wire Shipping's carrier-webhook handler to actually notify downstream

**Findings:** FSR-6, FSR-7
**Root cause:** Shipping's `RecordCarrierWebhook` ends with a bare `ok()` instead of calling the notification-fan-out helper other lifecycle use cases use. Only one consumer (`ShipmentShippedConsumer`, `shipping.carrier.accepted` only) exists anywhere — failure/exception/returned branches have zero consumers.
**Business impact:** Customers never get shipped/delivered/delivery-failed notifications from actual carrier events (the dominant, realistic path vs. manual admin advance); Fulfillment's shipment-outcome record goes stale; a failed delivery or lost package raises an event nothing consumes — no customer notification, no automatic Returns/refund trigger, no ops alert.
**Architecture impact:** This is the prerequisite for B1 (Fulfillment can only safely lose its own carrier-webhook receiver once it can actually learn carrier facts from Shipping).
**Risk level:** High.
**Proposed fix:** Wire the same notification-fan-out call from `RecordCarrierWebhook` that other Shipping use cases already use. Add consumers for the failure/exception shipment events that notify the customer and/or open an exception workflow.
**Why this preserves existing ADRs:** No new architecture — completes an already-designed fan-out pattern.
**Public API changes:** None.
**Event contract changes:** None — consumes/reacts to already-existing events.
**Migration requirements:** None.
**Estimated effort:** M. **Sequencing:** land before or alongside B1.

---

## 5. Remediation Items — Phase C (Reliability Improvements)

Performance, replay safety, reconciliation, circuit breakers, and operational-memory items. Presented as a table (all ten required fields per item) given the lower individual stakes relative to Phase A/B.

| Item                                                                                   | Findings                                  | Root cause                                                                                                                                                      | Business impact                                                                                                                                                                                | Risk                                                                                                  | Proposed fix                                                                                                                                                                                        | ADR-safe?                                       | Public API Δ                         | Event contract Δ                                                     | Migration                                            | Effort                                                                                                 |
| -------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **C1** — Batch cart-line N+1 queries                                                   | CPI-6, XC-3, XC-4                         | Inventory `CheckAvailability` and Pricing `ValidatePriceLines` both issue one sequential query per cart line on the Checkout hot path                           | Checkout latency scales linearly with cart size — the most likely first bottleneck under load; 2N sequential queries per checkout                                                              | Med                                                                                                   | Add `findByProducts`/batched query methods to both ports/adapters                                                                                                                                   | Yes, no ADR involved                            | None                                 | None                                                                 | None                                                 | S (both, same sprint — same pattern)                                                                   |
| **C2** — Inventory↔Warehouse referential integrity                                     | CPI-5                                     | `ReceiveStock`/`ReserveStock` never check warehouse existence/active status; `DeactivateWarehouse` never checks for open stock                                  | Stock received/reserved against a deactivated or typo'd warehouse silently succeeds — phantom inventory                                                                                        | Med                                                                                                   | Look up Warehouse and reject if missing/inactive on receive/reserve/adjust/transfer; block deactivation while open stock/reservations exist                                                         | Yes                                             | None                                 | None                                                                 | None                                                 | M                                                                                                      |
| **C3** — Inventory reservation write amplification                                     | CPI-10                                    | Full delete+recreate of reservation set on every save, even when only counters changed                                                                          | Extra write load/lock contention as concurrent reservation volume grows — already acknowledged in-code as deferred to the tracked ADR-0013/G-7 redesign                                        | Low                                                                                                   | Diff and touch only changed rows, or land the already-designed G-7 ledger redesign (ADR-0013 is frozen, implementation is the next inventory sprint per the gap register)                           | Yes — implements ADR-0013                       | None                                 | None                                                                 | Additive migration (ADR-0013 already specifies this) | M                                                                                                      |
| **C4** — Saga: circuit breaker + heartbeats + differentiated timeouts                  | SAGA-7, SAGA-8                            | PSP-facing activities have no breaker; flat 30s timeout, no heartbeats                                                                                          | A PSP outage causes every in-flight saga to hammer the provider instead of failing fast; a stuck call is invisible until the blunt timeout fires                                               | Med                                                                                                   | Wrap PSP-facing activities with a breaker (5 consecutive failures → open, 30s half-open probe, per ADR-0012 §3); add heartbeat calls and split timeout config per activity type                     | Yes — implements ADR-0012 §3 exactly            | None                                 | None                                                                 | None                                                 | M                                                                                                      |
| **C5** — Reachable saga reconciliation tooling                                         | SAGA-9                                    | `reconcile` query / `manualResolve` signal exist only inside the workflow, no external caller                                                                   | A genuinely stuck saga (compounded by A3's fix landing) has no reachable operator remedy without this                                                                                          | Med                                                                                                   | Add an admin route/CLI that queries `reconcile` and sends `manualResolve` for a given workflow id                                                                                                   | Yes — implements ADR-0012 §3                    | New admin route (additive)           | None                                                                 | None                                                 | S                                                                                                      |
| **C6** — Auto-lock cart on checkout start; require locked session for saga submit      | SAGA-6, SAGA-10                           | `StartCheckout` never calls Cart's existing `lock()`; saga accepts submits against still-editable sessions                                                      | Double reservation/payment-intent/order risk from double-submit (two tabs, naive retry); a concurrent address/payment edit could race the saga's own reads                                     | Med                                                                                                   | Call `cart.lock()` from `StartCheckout`; require and verify `state === "locked"` before accepting a saga submit                                                                                     | Yes                                             | None                                 | None                                                                 | None                                                 | M                                                                                                      |
| **C7** — Move PSP calls outside the DB transaction                                     | PAY-8                                     | `psp.capture()`/`psp.refund()` execute inside `unitOfWork.run(...)`                                                                                             | Holds a DB lock open across an external call (up to 30s PSP timeout); dual-write hazard if commit fails after PSP call succeeds                                                                | Med                                                                                                   | Call PSP first, then persist the confirmed outcome in a short transaction                                                                                                                           | Yes                                             | None                                 | None                                                                 | None                                                 | M                                                                                                      |
| **C8** — Route legacy Payments methods through the transition table                    | PAY-9, PAY-10                             | Legacy `capture()`/`fail()`/`refund()` hand-roll eligibility checks and never set `partially_refunded`                                                          | Silent-drift risk on future `TRANSITIONS` table edits; dashboards misreport partially-refunded intents as fully captured                                                                       | Med                                                                                                   | Route legacy methods through `canTransitionPayment`; set `partially_refunded` when applicable                                                                                                       | Yes                                             | None                                 | None                                                                 | None                                                 | S — **superseded by B3 if sequenced after it; do this only if B3 is deferred past this item's sprint** |
| **C9** — Reconciliation job for admin-HTTP-triggered captures                          | PAY-11                                    | ADR-0012's reconcile/manualResolve only exists for the Temporal path, not admin-HTTP captures                                                                   | An intent can sit indefinitely in `capture_requested`/`processing` with no automated detection                                                                                                 | Med                                                                                                   | Add a scheduled job querying stale in-flight intents against the PSP                                                                                                                                | Yes, extends ADR-0012's intent to a second path | None                                 | None                                                                 | None                                                 | M — **depends on A4** (needs a real PSP to query against)                                              |
| **C10** — Dedicated CancelPaymentIntent use case                                       | SAGA-11                                   | `cancelPaymentIntent` reuses `FailPayment` as an admitted workaround                                                                                            | Financial reporting/reconciliation cannot distinguish customer-declined from platform-initiated cancellation                                                                                   | Low                                                                                                   | Add a real `CancelPaymentIntent` use case in Payments, distinct from `FailPayment`                                                                                                                  | Yes                                             | None                                 | Possibly additive (new terminal status/event distinct from "failed") | None                                                 | M                                                                                                      |
| **C11** — Finance: seed chart of accounts, batch account lookups, bound ledger listing | OF-6, OF-8                                | No default `Account` rows are ever seeded; fiscal close does sequential per-account lookups and unbounded ledger materialization                                | First `CloseFiscalPeriod` call fails outright on a fresh deployment, discovered only at period-close, potentially months after go-live; latency/memory grow unbounded with transaction history | High (business-continuity risk at first period close, even though not a Phase-A-style live-money bug) | Validate account existence at posting time or seed the default chart of accounts before any consumer starts; scope `listEntries` by fiscal-period date range; batch account lookups with `findMany` | Yes                                             | None                                 | None                                                                 | Seed data / one-time setup step                      | M                                                                                                      |
| **C12** — Processed-events inbox retention/cleanup job                                 | NOT-8 (narrowed — outbox already has one) | Inbox docstring requires a TTL/cleanup policy; none exists (outbox's equivalent job already exists and is correctly scheduled)                                  | Inbox table grows unbounded, degrading query/index performance over time                                                                                                                       | Low                                                                                                   | A scheduled job pruning inbox rows past the broker's max redelivery window, mirroring the existing `outbox-prune` job's shape                                                                       | Yes                                             | None                                 | None                                                                 | None                                                 | S                                                                                                      |
| **C13** — DLQ redrive tooling                                                          | NOT-10                                    | No script/CLI/admin action replays a dead-lettered message; only a manual runbook exists                                                                        | Recovering from a poison-message incident requires ad hoc engineering work under pressure                                                                                                      | Low                                                                                                   | A small CLI/admin action that reads a `dead_letters` row and republishes its original bytes/headers                                                                                                 | Yes                                             | New CLI/admin action (additive)      | None                                                                 | None                                                 | S                                                                                                      |
| **C14** — Fulfillment order-creation domain-level dedup                                | NOT-5                                     | `CreateFulfillment` mints a new id unconditionally, no lookup-by-`orderRef` first — relies entirely on the (still being fixed by A5/A6) non-atomic inbox marker | A crash between fulfillment-order creation and the inbox marker commit creates a duplicate fulfillment order for the same purchase                                                             | Med                                                                                                   | Add a uniqueness guard on `orderRef` in the repository/use case, mirroring `MarkOrderPaid`'s domain-level duplicate handling                                                                        | Yes                                             | None                                 | None                                                                 | None                                                 | S                                                                                                      |
| **C15** — Bound Payments' JSON attempt log                                             | PAY-13                                    | Full `attempts` array serialized on every save                                                                                                                  | Degraded write latency and row bloat for long-lived intents with many retry/webhook attempts                                                                                                   | Low                                                                                                   | Move `attempts` to its own append-only table if volume becomes material (not urgent at current scale per the audit's own assessment)                                                                | Yes                                             | None                                 | None                                                                 | Additive migration if implemented                    | M                                                                                                      |
| **C16** — Warehouse callback: claim only after success, or add release()               | FSR-10                                    | `claim()` succeeds and permanently marks processed before business validation runs; no `release()`/unclaim path exists on the port                              | A transient failure permanently locks that specific warehouse callback out of ever being reprocessed, stranding the return                                                                     | Med                                                                                                   | Claim only after a fully successful outcome, or add a compensating `release()` on business-rule failure                                                                                             | Yes                                             | None                                 | None                                                                 | None                                                 | S                                                                                                      |
| **C17** — Stop dropping the `destination` field at the Fulfillment→Shipping boundary   | FSR-12                                    | `RealShippingRequestPort.createShipment` receives `destination` but never forwards it                                                                           | Low today, but a future caller relying on the type signature gets silently incorrect behavior with no compiler/runtime warning                                                                 | Low                                                                                                   | Remove `destination` from the port's input type if genuinely unused at this stage, or thread it through to `Shipment.create`                                                                        | Yes                                             | Internal port type change only       | None                                                                 | None                                                 | S                                                                                                      |
| **C18** — Wire or explicitly defer Security's delegation/impersonation use cases       | XC-7                                      | `GrantDelegation`/`RevokeDelegation`/`StartImpersonation` are fully built and tested but have zero HTTP route or runtime caller                                 | A false sense of capability — audited impersonation/access delegation is inert in production despite being fully built                                                                         | Low                                                                                                   | Wire admin endpoints for these three use cases, or mark them clearly deferred in the gap register (either is an acceptable close)                                                                   | Yes                                             | New admin routes if wired (additive) | None                                                                 | None                                                 | S                                                                                                      |

---

## 6. Remediation Items — Phase D (Cleanup)

| Item                                                                                                       | Findings                                                                   | Description                                                                                                                                                                                                                                                                                                         | Effort        |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **D1** — Correct stale/misleading doc comments and docstrings                                              | CPI-9, OF-9 (comment half, folds into A1's ship), NOT-9 (ADR mis-citation) | Fix Catalog's "variants immutable" docstring, Inventory README's "in-memory only" claim, Orders/Finance's doc-22 misquote, and Notifications/Finance's ADR-0003→ADR-0005 mis-citation                                                                                                                               | S             |
| **D2** — Wire PricingRule into price computation, or mark it explicitly unimplemented                      | CPI-8                                                                      | A documented domain capability ("discount policy, applied by priority") has no execution path — inert CRUD masquerading as business logic; either wire it or label it clearly as not-yet-active                                                                                                                     | M             |
| **D3** — Route Fulfillment's `createShipment`/`assignTracking` through the shared `transition()` primitive | FSR-13                                                                     | No current bug (both correctly guard via `canTransitionFulfillment`), but the invariant-check gate is only accidentally uniform, not structurally enforced                                                                                                                                                          | S             |
| **D4** — Validate carrier webhook `kind` against a known vocabulary                                        | FSR-14                                                                     | Cosmetic/log-quality issue — junk values pollute the audit log; the transition itself remains correctly gated regardless                                                                                                                                                                                            | S             |
| **D5** — Document the item-line-snapshot tradeoff explicitly                                               | OF-10                                                                      | Already an intentional, in-code-explained tradeoff (avoids a synchronous read-back) — no code change needed, just make sure it's referenced from the architecture docs so it isn't mistaken for an oversight in a future audit                                                                                      | S (docs only) |
| **D6** — Correct the platform gap register                                                                 | XC-8                                                                       | Update `docs/architecture/23-platform-gap-register.md` (dated 2026-07-04, stale) to reflect that 35 of 39 contexts already have a working Prisma composition branch — the real remaining gap is external-provider adapters, not persistence wiring. This directly affects how future work is prioritized/estimated. | S             |
| **D7** — Cross-reference Analytics' Expression Engine fork to ADR-0053                                     | XC-1                                                                       | No code action needed — ADR-0053 already grandfathers this as deliberately deferred debt. Add a pointer comment in `expression-evaluator.ts` referencing ADR-0053 so a future auditor doesn't re-flag it as an undiscovered violation.                                                                              | S (docs only) |

---

## 7. Sprint Roadmap

Sprints are deliberately small and single-concern per the mission's instruction ("never mix unrelated architectural concerns in one sprint; prefer many small independent sprints"). Each is independently releasable. Dependencies are called out explicitly — most Phase A/B sprints have real ordering constraints; Phase C/D sprints are almost all independent of everything.

### Phase A sequence (must complete before production cutover)

**Sprint A.1 — Fix payment-truth id-correlation + remove caller-asserted paths**

- Goals: close SAGA-1, SAGA-3, PAY-4, OF-1, OF-9 (item A1)
- Files: `apps/runtime/src/purchase-saga-activities.ts`, `services/orders/src/interfaces/payment-captured.consumer.ts`, `services/orders/src/application/mark-order-paid.use-case.ts`, `apps/admin/src/interfaces/orders.admin-controller.ts`, `services/payments/src/application/capture-payment.use-case.ts`
- Dependencies: none (first sprint)
- Risk: High (touches the primary purchase flow's payment-truth path)
- Rollback: feature-flag the new consumer-lookup logic; keep old `AdvanceOrder` call path dark but present for one release in case of rollback need, remove in a follow-up cleanup sprint
- Validation: existing saga e2e tests must pass with the id-correlation fix; add a new test asserting a saga purchase's captured event correctly resolves via the consumer; add a test asserting `markOrderPaid` now rejects an unverified reference
- Acceptance criteria: zero code paths can mark an order paid without a real captured-payment event; DLQ flood from PAY-4 stops in staging soak test

**Sprint A.2 — Wire Temporal saga completion signal**

- Goals: close SAGA-2 (item A2)
- Files: `apps/runtime/src/purchase-saga-activities.ts` (or wherever the new consumer lands), `packages/temporal/src/runtime.ts`
- Dependencies: **A.1** (same consumer)
- Risk: Medium
- Rollback: the synchronous HTTP fallback path remains available throughout; disabling the signal wiring reverts to current (broken-but-known) behavior
- Validation: integration test that starts a workflow, publishes a captured event, and asserts the workflow completes within the capture window instead of timing out
- Acceptance criteria: a durable Temporal-orchestrated purchase completes end-to-end in a test environment without hitting the 15-minute timeout

**Sprint A.3 — Saga activity idempotency + partial-failure compensation**

- Goals: close SAGA-4, SAGA-5 (item A3)
- Files: `apps/runtime/src/purchase-saga-activities.ts`, `services/inventory/src/application/reserve-stock.use-case.ts`, `services/payments/src/application/create-payment-intent.use-case.ts`
- Dependencies: none (parallelizable with A.1/A.2, touches different code paths within the same files — coordinate merge order)
- Risk: High (retry semantics are subtle; needs careful test coverage)
- Rollback: revert to prior activity behavior; the "hangs forever" failure mode is bad but not silently corrupting, so rollback safety is acceptable
- Validation: Temporal test-environment replay tests simulating a lost ack on each convergent activity, asserting "already done" is treated as success, not infinite retry
- Acceptance criteria: no saga activity duplicates a reservation/intent on retry; a mid-loop `reserveStock` failure releases already-reserved lines

**Sprint A.4a — Fail loudly instead of silently no-op on missing PSP adapter**

- Goals: interim mitigation half of item A4 (PAY-2)
- Files: `services/payments/src/composition.ts`
- Dependencies: none
- Risk: Low
- Rollback: trivial revert
- Validation: composition test asserting a Prisma-configured environment throws on startup if no real PSP adapter is injected
- Acceptance criteria: a misconfigured production deploy fails fast and loud, not silently

**Sprint A.4b — Real PSP adapter + public signature-verified webhook route**

- Goals: full item A4 (PAY-2, PAY-3)
- Files: new `packages/psp-*` adapter package, `services/payments/src/composition.ts`, new public webhook route in `apps/admin/src/http/`
- Dependencies: **A.4a** (as a safety net during rollout)
- Risk: High (external dependency, financial-transaction-critical)
- Rollback: composition-level provider swap back to in-memory (with A.4a's fail-loud guard now protecting against silent misuse) if the real adapter has issues
- Validation: PSP sandbox/test-mode integration tests; signature-verification unit tests with valid/forged payloads
- Acceptance criteria: a test charge completes through the real adapter in sandbox mode; a forged webhook payload is rejected

**Sprint A.5a/b/c/d/e — Postgres-backed webhook idempotency stores (Payments, Fulfillment, Shipping, Returns, Notifications)**

- Goals: item A5, one sub-sprint per context (5 total) — mechanically identical pattern, disjoint files, safe to parallelize across engineers
- Files: one new `Prisma*Store` class + composition-root wiring per context
- Dependencies: none, fully parallelizable
- Risk: Low (additive, existing tables, existing unique constraints)
- Rollback: trivial per-context revert
- Validation: unit test asserting a duplicate `claim()`/`recordIfNew()` call returns false/no-op on the second call
- Acceptance criteria: a replayed webhook is provably not reprocessed after a simulated process restart (integration test with a fresh store instance)

**Sprint A.6a — Atomic consumer idempotency (fix at the source)**

- Goals: the `tx`-threading half of item A6 (OF-2/NOT-4's root cause) — this one fix closes the atomicity gap for every consumer platform-wide, not just Finance
- Files: `packages/kafka/src/consumer-runtime.ts`, `packages/messaging/src/consumer/event-consumer.ts`, `packages/tracking/src/delivery/delivery-pipeline.ts`
- Dependencies: none
- Risk: Medium (touches the shared consumer runtime used by every context)
- Rollback: revert to non-atomic recording; the pre-existing exposure returns but nothing new breaks
- Validation: integration test simulating a crash between handler-commit and marker-write, asserting the atomic path prevents double-processing on redelivery
- Acceptance criteria: no consumer in the platform can double-process a redelivered message when the handler and marker share a transaction

**Sprint A.6b — Finance: wire missing refund/return/fee/inventory-adjustment consumers**

- Goals: OF-3 half of item A6
- Files: `services/finance/src/interfaces/*.consumer.ts` (new), `apps/runtime/src/composition.ts`
- Dependencies: **A.6a** (new consumers should be built atomic from day one)
- Risk: Medium
- Rollback: consumers can be unregistered independently without affecting the sales-journal path
- Validation: event-driven integration tests per new consumer, each posting a correctly-balanced journal entry
- Acceptance criteria: a refund/return/fee/inventory-adjustment event correctly posts to the ledger within test environment

**Sprint A.6c — Finance/Returns: fix `returns.items.accepted` payload + wire the consumer**

- Goals: FSR-5 half of item A6 — **event contract change**, needs sourcing decision for cost data
- Files: `services/returns/src/domain/events/return-transitioned.event.ts`, `services/finance/src/events/consumers.ts`, new consumer registration
- Dependencies: **A.6a, A.6b**; requires a stakeholder decision on where restock-cost data is sourced from (Inventory or Pricing) before implementation starts
- Risk: Medium
- Rollback: consumer can stay unregistered if the payload fix isn't ready; no regression from current (already-broken) state
- Validation: integration test asserting an accepted return posts a correctly-reversed journal entry
- Acceptance criteria: returns visibly affect the Finance ledger in a test environment

**Sprint A.6d — Wire Finance consumer for legacy `orders.order.paid`**

- Goals: OF-4 half of item A6
- Files: `services/finance/src/interfaces/order-paid-legacy.consumer.ts` (new)
- Dependencies: **check against B.4's schedule first** — if B4 (retiring the legacy Order lifecycle) is scheduled within the same release window, skip this sprint entirely and let B4 make it moot; otherwise implement it
- Risk: Low
- Rollback: trivial
- Validation: integration test posting a legacy-path paid order to the ledger
- Acceptance criteria: admin-backoffice-placed orders appear in the Finance ledger

**Sprint A.7a-i — Notifications auto-progression worker**

- Goals: NOT-1 half of item A7a
- Files: new worker in `apps/runtime/src/notifications/`, `services/notifications/src/application/`
- Dependencies: none
- Risk: Medium
- Rollback: worker can be disabled via its own toggle without affecting manual admin queue/send
- Validation: integration test asserting a created notification auto-progresses to sent within the worker's polling/trigger window
- Acceptance criteria: an order-confirmation notification created through the real purchase flow is delivered (to the in-memory/stub channel, pending A.7b) without any admin action

**Sprint A.7a-ii — Wire missing Notifications event consumers (purchase-flow-priority subset first)**

- Goals: NOT-2 half of item A7a, phased — start with order-fulfilled/shipped, delivery-failure; defer low-stock/consent/invites to a follow-up sprint
- Files: new consumer classes in `apps/runtime/src/notifications/`
- Dependencies: **A.7a-i**
- Risk: Medium
- Rollback: per-consumer, independently
- Validation: integration test per consumer
- Acceptance criteria: a shipped/delivered/delivery-failed carrier event produces a queued customer notification

**Sprint A.7b-i — Wire Payments/Returns/Fulfillment to the real notification port pattern**

- Goals: NOT-3 (composition-wiring half of item A7b) — reuse Orders' already-correct pattern, no new channel adapters needed yet
- Files: `services/payments/src/composition.ts`, `services/returns/src/composition.ts`, `services/fulfillment/src/composition.ts`, `apps/runtime/src/composition.ts`
- Dependencies: none (can run in parallel with A.7a)
- Risk: Low
- Rollback: trivial per-context revert
- Validation: composition test confirming a real port (not in-memory) is wired when `deps.prisma` is supplied
- Acceptance criteria: payment-failure and return-decision notifications reach the same delivery path Orders' notifications already use

**Sprint A.7b-ii — Real email provider adapter (highest-value channel first)**

- Goals: NOT-7 (channel-adapter half of item A7b), email only
- Files: new `packages/notifications-email-*` adapter, `services/notifications/src/composition.ts`
- Dependencies: **A.7a-i, A.7b-i**
- Risk: Medium (external dependency)
- Rollback: composition-level swap back to in-memory
- Validation: sandbox/test-mode send-and-receive integration test
- Acceptance criteria: a real email is delivered end-to-end in a staging environment

**Sprint A.7b-iii/iv/v — Real SMS / push / webhook provider adapters**

- Goals: remainder of NOT-7, one channel per sprint, same shape as A.7b-ii
- Dependencies: **A.7b-ii** (establishes the pattern), otherwise parallelizable across channels
- Risk: Medium each
- Effort: L each — **note: these are the largest remaining line items in the entire plan; sequence by actual business priority (which channels the product actually needs live first), not by finding order**

**Sprint A.8 — Fulfillment→Shipping idempotency key threading**

- Goals: item A8 (FSR-3)
- Files: `apps/admin/src/infrastructure/cross-context-ports.ts`, `services/shipping/src/application/create-shipment.use-case.ts`
- Dependencies: none
- Risk: Medium
- Rollback: trivial revert
- Validation: test asserting a retried `createShipment` call with the same key returns the existing shipment, not a new one
- Acceptance criteria: no duplicate `Shipment` aggregate is created on a simulated retry

**Sprint A.9 — Returns→Inventory restock compensation**

- Goals: item A9 (FSR-4)
- Files: `services/returns/src/application/return-lifecycle.use-cases.ts`
- Dependencies: none
- Risk: Medium
- Rollback: trivial revert
- Validation: test simulating a restock failure, asserting a durable retry/outbox entry is created and inventory eventually reconciles
- Acceptance criteria: no accepted-return silently fails to restock without a trace

**Sprint A.10 — Catalog variant-edit fix**

- Goals: item A10 (CPI-1)
- Files: `services/catalog/src/infrastructure/prisma-catalog-repositories.ts`
- Dependencies: none
- Risk: Low
- Rollback: trivial revert
- Validation: new integration test covering edit-in-place (not just add/remove), asserting a price/selection edit persists correctly
- Acceptance criteria: editing an existing variant's price via the admin action actually changes the stored value

### Phase B sequence

**Sprint B.11 — Wire Shipping's carrier-webhook fan-out + failure/exception consumers** _(numbered to land before B.1 despite the numbering gap — see dependency note)_

- Goals: item B11 (FSR-6, FSR-7)
- Files: `services/shipping/src/application/record-carrier-webhook.use-case.ts`, new consumer classes
- Dependencies: none
- Risk: Medium
- Rollback: trivial revert
- Validation: test asserting a carrier webhook triggers the same fan-out other Shipping use cases produce; new consumer tests for failure/exception branches
- Acceptance criteria: a carrier delivery event visibly reaches Notifications/Fulfillment in a test environment

**Sprint B.1 — Remove Fulfillment's duplicate carrier-webhook receiver**

- Goals: item B1 (FSR-1, FSR-9)
- Files: delete `services/fulfillment/src/application/record-carrier-webhook.use-case.ts` and its route; add a consumer of Shipping's carrier events to Fulfillment
- Dependencies: **B.11** (Fulfillment must have another way to learn carrier facts before losing its own receiver)
- Risk: High (removes a currently-functioning, if architecturally wrong, code path)
- Rollback: keep the old route dark (not deleted) for one release behind a flag before hard-deleting, in case B.11's consumer has gaps
- Validation: end-to-end test confirming Fulfillment's shipment-outcome record still updates correctly via the new consumer path
- Acceptance criteria: zero direct carrier-webhook ingress remains in Fulfillment; Shipping is the sole carrier-fact source of truth
- **Recommend formalizing the existing 2026-07-26 code-comment correction as an actual ADR as part of this sprint** — see item B1's ADR note.

**Sprint B.2 — Remove Catalog's duplicated price fields**

- Goals: item B2 (CPI-2)
- Files: `services/catalog/src/domain/variant.ts`, `add-variant.use-case.ts`, `update-variant.use-case.ts`, `catalog.prisma`
- Dependencies: none (can run in parallel with B.1)
- Risk: Medium (schema migration)
- Rollback: schema migration should be additive-then-subtractive across two deploys (stop writing, verify, then drop columns) rather than one atomic change
- Validation: confirm zero live readers of the field via query-log audit before dropping columns
- Acceptance criteria: Catalog no longer stores or exposes a price; Pricing is confirmed the sole source in all environments

**Sprint B.3 — Converge Payments' two PaymentIntent lifecycles**

- Goals: item B3 (PAY-5, PAY-6, PAY-7, PAY-12)
- Files: `services/payments/src/domain/payment-intent.ts`, `payment-lifecycle.use-cases.ts`, `payment-event-translator.ts`, `apps/runtime/src/purchase-saga-activities.ts`
- Dependencies: **A.1, A.2** (must not destabilize the just-fixed payment-truth consumer)
- Risk: High
- Rollback: this is the highest-risk single sprint in the plan given how central PaymentIntent is — recommend a feature-flagged dual-write/shadow-read period before fully retiring the legacy path
- Validation: full saga e2e regression suite plus new tests for the converged transition table
- Acceptance criteria: saga-driven and admin-HTTP-driven captures both flow through one lifecycle, one event stream

**Sprint B.4 — Converge Orders' two status-mutation paths**

- Goals: item B4 (OF-5, OF-7)
- Files: `services/orders/src/domain/order.ts`, `order-event.ts`, event class files
- Dependencies: **A.1** (payment-truth consumer stability); **coordinate with A.6d** (may make it moot — see A.6d's note)
- Risk: High
- Rollback: same shadow-period recommendation as B.3
- Validation: full order lifecycle regression suite
- Acceptance criteria: `orders.order.refunded` has exactly one payload schema; both admin-backoffice and checkout-driven orders share one status-mutation mechanism

**Sprint B.5 — Promotions: translator-owns-wire-type refactor**

- Goals: item B5 (CPI-7)
- Files: `services/promotions/src/domain/promotion.ts`, `promotions-event-translator.ts`
- Dependencies: none
- Risk: Low
- Rollback: trivial revert
- Validation: existing Promotions event tests must pass unchanged (wire types don't change, only authorship location)
- Acceptance criteria: domain layer no longer authors wire-type strings

**Sprint B.6 — Migrate Promotions onto the Rule Engine**

- Goals: item B6, Promotions half (XC-2)
- Files: `services/promotions/src/domain/promotion.ts`, `promotion-rule.ts`, new `@platform/rules` integration
- Dependencies: none, but benefits from following B.5 (cleaner event authorship first)
- Risk: Medium
- Rollback: keep the old switch-based evaluator behind a flag during rollout, compare outputs before fully cutting over
- Validation: shadow-mode comparison test — run both evaluators against production-shaped condition data, assert identical results before cutover
- Acceptance criteria: Promotions' condition evaluation runs entirely through `@platform/rules`/`@platform/expression`, zero hand-rolled switch remains

**Sprint B.6b — Document Feature Flags' evaluator exemption (or migrate)**

- Goals: item B6, Feature Flags half (XC-6) — default to documenting the exemption per the audit's own judgment that this is the weaker case
- Files: `services/feature-flags/src/domain/value-objects/feature-rule.ts` (doc comment only, or full migration if product decides otherwise)
- Dependencies: none
- Risk: Low
- Effort: S (document) — this is a decision point, flag for a quick product/architecture call rather than defaulting to a full migration

**Sprint B.7 — Fail closed on unsupported promotion reward types**

- Goals: item B7 (CPI-4)
- Files: `services/promotions/src/application/create-promotion.use-case.ts` (or wherever reward validation belongs), `apps/admin/src/infrastructure/cross-context-ports.ts`
- Dependencies: none
- Risk: Medium (behavior change for merchant-facing tooling)
- Rollback: trivial revert
- Validation: test asserting creation of a product/category/shipping-scoped or BOGO/free-shipping promotion is rejected until the port supports it
- Acceptance criteria: no promotion can be created today that would silently discount $0 at checkout

**Sprint B.8 — Pricing: single-published-price invariant**

- Goals: item B8 (CPI-3)
- Files: `services/pricing/src/application/publish-price.use-case.ts`, `pricing.prisma`
- Dependencies: none
- Risk: Medium (unique index may fail to apply if production data already violates it — audit first)
- Rollback: index can be dropped if it causes unexpected publish failures; investigate root cause before re-adding
- Validation: test asserting publishing a new price for an already-published product+currency correctly unpublishes the prior one
- Acceptance criteria: at most one published price exists per product+currency at any time, enforced at the DB level

**Sprint B.9 — Restrict generic admin advance endpoints**

- Goals: item B9 (FSR-8)
- Files: `services/fulfillment/src/application/fulfillment-lifecycle.use-cases.ts`, `services/shipping/src/application/shipment-lifecycle.use-cases.ts`
- Dependencies: none
- Risk: Low
- Rollback: trivial revert
- Validation: test asserting a carrier-owned target state is rejected via the admin advance endpoint
- Acceptance criteria: Fulfillment/Shipping match Returns' existing allowlist pattern

**Sprint B.10 — HMAC verification for carrier/warehouse webhooks**

- Goals: item B10 (FSR-11)
- Files: new middleware in `apps/admin/src/http/`, applied to `fulfillment-routes.ts`, `shipping-routes.ts`
- Dependencies: none (independent of A.4/A.7b's PSP/carrier adapter work, though ideally lands before any real carrier adapter goes live)
- Risk: Medium
- Rollback: middleware can be disabled via config flag if it blocks legitimate traffic unexpectedly
- Validation: test asserting a request with an invalid signature is rejected, valid signature passes
- Acceptance criteria: carrier/warehouse webhook routes verify cryptographic origin, not just RBAC

### Phase C sequence

All Phase C sprints (C.1 through C.18, one per item in §5's table) are independent of each other and of Phase B, with three noted exceptions: **C.8 should be skipped/merged if B.3 lands first** (B.3 supersedes it), **C.9 depends on A.4** (needs a real PSP to reconcile against), and **C.4/C.10 touch the same saga-activities file as A.1/A.3** (coordinate merge order, no hard dependency). Recommend running Phase C sprints opportunistically alongside Phase B rather than strictly sequenced after it — none of them block production readiness.

Each Phase C sprint follows the same card shape as Phase A/B (goals = the item's findings, files = as listed in §5, dependencies = as noted above or none, risk = as rated in §5's table, rollback = trivial revert for all except C.2/C.11/C.16 which touch validation logic and warrant a staged rollout, validation = a new test asserting the specific defect is closed, acceptance criteria = the "Business impact" row in §5 no longer reproduces). Given the mechanical similarity, individual cards are not repeated here — §5's table is the authoritative per-item breakdown.

### Phase D sequence

All Phase D sprints (D.1 through D.7) are documentation-only or trivial, fully independent, zero production risk, and can be picked up opportunistically by any engineer between higher-priority sprints. No dedicated scheduling needed beyond a backlog entry each.

---

## 8. Deployment Order & Dependency Graph

```
A.1 (payment-truth consumer fix)
 ├─→ A.2 (saga signal wiring)
 └─→ B.3 (Payments lifecycle convergence) ──┐
                                              │
A.3 (saga idempotency)  [parallel to A.1/A.2, coordinate merges]
                                              │
A.4a (fail-loud PSP guard) → A.4b (real PSP adapter) → C.9 (admin reconciliation job)
                                              │
A.5a..e (webhook idempotency stores)  [fully parallel]
                                              │
A.6a (atomic consumer idempotency) → A.6b (Finance consumers) → A.6c (returns payload fix)
                                        └──→ A.6d (legacy orders.paid consumer) ←── check against B.4
                                              │
A.7a-i (auto-progression) → A.7a-ii (missing consumers)
A.7b-i (port wiring) → A.7b-ii (email) → A.7b-iii/iv/v (SMS/push/webhook)
                                              │
A.8, A.9, A.10  [fully independent]
                                              │
────────────────── Phase A gate ──────────────────
                                              │
B.11 (Shipping fan-out) → B.1 (remove Fulfillment carrier receiver)
B.2 (Catalog price removal)  [parallel]
B.4 (Orders lifecycle convergence)  [after A.1, check vs A.6d]
B.5 → B.6 (Promotions rule-engine migration)
B.6b (Feature Flags — decision point)
B.7, B.8, B.9, B.10  [independent]
                                              │
Phase C (C.1–C.18) — opportunistic, mostly independent, run alongside B
Phase D (D.1–D.7) — opportunistic, zero-risk backlog items
```

**Phase A must fully close before any real-money production traffic is accepted.** Phase B should close before the next major merchant-facing feature push (boundary violations compound the longer they're load-bearing). Phase C/D have no hard deadline but should not be indefinitely deferred — several (C.11 especially) become business-continuity risks at specific future milestones (first fiscal close, first scale-driven latency incident).

---

## 9. Final Production Readiness Assessment

**Verdict: NOT production-ready, unchanged from the original audit — and this re-verification found no evidence to soften that conclusion.** Every one of the audit's original 10 headline blockers re-confirmed against current code with zero false positives across 55 total findings.

**What must be true before a "yes":**

1. All of Phase A closes (§7's Phase A sequence) — this is the actual gate. Phase A represents genuine inability to safely take payment, complete a purchase, or notify a customer today, not stylistic debt.
2. At minimum, B.1 and B.11 close alongside Phase A — the Fulfillment/Shipping carrier-boundary violation carries live production-divergence risk that a strict "Phase A only" reading would leave open on day one.
3. A.4b and at least A.7b-ii (email) represent the two largest remaining efforts (XL and L respectively) and are the true long poles — everything else in Phase A is collectively smaller than these two items. **Realistic sequencing should treat "build a real PSP adapter" and "build a real email adapter" as the two workstreams that determine the actual go-live date**, with every other Phase A sprint completing well before them.

**What is already genuinely solid** (re-confirmed, not assumed): optimistic locking across every sampled aggregate, the CDC-backed outbox pattern, double-entry ledger balance, append-only ledger/order-history, history-derived order status, snapshot anti-corruption points, tenant scoping, PII minimization on the wire, zero illegitimate cross-context imports, DLQ/retry mechanics, workflow determinism, and — confirmed by this pass's independent gate re-run — the dependency-graph and duplication metrics (`pnpm arch`: 0 violations; `pnpm dup`: 2.52%). **The foundation this needs to be built on is real; what's missing is specifically the wiring between contexts and the connections to the outside world.**

**One planning correction this pass surfaces that the original audit didn't have:** the platform gap register's claim that most contexts are still in-memory is stale and wrong — 35 of 39 already have working Prisma composition. The actual remaining work is narrower and more concentrated than a naive reading of existing docs would suggest: it's the external-provider adapters (PSP, notification channels, and by extension likely carrier) plus the cross-context wiring bugs cataloged here, not a broad persistence-layer buildout.
