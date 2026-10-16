# Morbeh Platform — Phase A Production Cutover Plan

**Status:** Validation only. No code was changed to produce this document. This plan is sequencing guidance, not an implementation authorization — implementation begins only after `IMPLEMENTATION_DEPENDENCY_GRAPH.md`'s internal-consistency check (§6 of that document) is reviewed and accepted.
**Inputs:** `ARCHITECTURE_REMEDIATION_PLAN.md`, `ARCHITECTURE_EXECUTION_MATRIX.md`, `IMPLEMENTATION_DEPENDENCY_GRAPH.md`.
**Scope:** all 30 corrected Phase A sub-items, organized into deployment waves derived directly from the dependency graph's required-predecessor edges, not from convenience grouping.

---

## 0. How Waves Were Derived

A wave boundary exists wherever an item has a **hard required predecessor** in another wave. Items with no required predecessors start in Wave 1. Two special non-code phases are inserted where the dependency graph identified calendar-bound (not effort-bound) gates: the **A1 shadow soak** between Wave 2 and Wave 3, and per-channel **PSP/notification sandbox soak** windows inside Wave 2/3 where flagged. Items entirely off the critical path (A9, A8, A10, most of A6) are slotted into the earliest wave their dependencies allow, not delayed artificially — there is no benefit to holding them back.

---

## 1. Deployment Order

### Wave 1 — Foundational, zero dependencies (parallel-safe, all items independent of each other)

| Item  | What ships                                                                   |
| ----- | ---------------------------------------------------------------------------- |
| A6a   | Opt-in atomic-idempotency capability on `EventHandler`                       |
| A1-i  | Order `findByCheckoutRef`-style lookup                                       |
| A9a   | `RealInventoryRestockPort` + idempotency key on `requestRestock`             |
| A8    | Shipping idempotency key + migration + admin-route reconciliation            |
| A10   | Catalog variant-edit upsert fix                                              |
| A4a   | Fail-loud interim PSP guard                                                  |
| A7a-i | `WiredNotifications` activities surface expansion                            |
| A7b-i | Notifications provider-branching fix + Fulfillment `notifications?` override |

**Deploy order within Wave 1:** no item in this wave depends on another, so order is driven purely by the shared-file contention matrix (`IMPLEMENTATION_DEPENDENCY_GRAPH.md` §3), not by correctness:

1. A10 (fully isolated — ship first, zero risk of blocking anything else).
2. A6a (foundational for Wave 2 — ship early so Wave 2 isn't waiting on it).
3. A1-i (foundational for Wave 2's A1-ii — ship early for the same reason).
4. A9a, A8 (independent of each other, low file overlap — order doesn't matter, but do not merge simultaneously since both touch `cross-context-ports.ts`).
5. A4a (small, land before A5a and A7b-i touch the same `services/payments/src/composition.ts` file).
6. A7a-i, A7b-i (land before the Notifications-composition-heavy Wave 2 items).

### Wave 2 — depends only on Wave 1 items

| Item                           | Depends on        |
| ------------------------------ | ----------------- |
| A5a, A5b, A5c, A5d, A5e        | A6a               |
| A6b-i                          | A6a (recommended) |
| A1-ii                          | A1-i              |
| A9b                            | A9a               |
| A4b                            | A4a (recommended) |
| A7a-ii                         | A7a-i             |
| A7b-ii, A7b-iii, A7b-iv, A7b-v | A7b-i             |

**Deploy order within Wave 2:**

1. A5a–e (five independent contexts, deploy in parallel across engineers; internally, land A5e before the A7b channel adapters land in the same wave — see contention matrix).
2. A6b-i (after A5a, since both touch Payments-adjacent code, though not the same file — sequencing avoids simultaneous review load on the same reviewers).
3. A1-ii — **this is a dark-launch/shadow deploy, not a normal release.** Ships flag-disabled by default, then enabled for shadow-mode traffic sampling. See §4 (Verification Order) for what "enabled" means here — it does not mean the saga's direct call is removed; both paths compute outcomes, only the existing direct call actually emits.
4. A9b (after A9a is confirmed stable in Wave 1 — not a hard code gate, but don't deploy the compensation logic before the adapter it depends on has had at least one production cycle to prove itself).
5. A4b — largest single deploy in Wave 2. Deploy behind a flag, start with sandbox/shadow traffic per §1's dark-launch note before full cutover (see Wave-2 sub-phase below).
6. A7a-ii, then A7b-ii through A7b-v (parallel across four engineers if staffed that way — this is the critical-path lever identified in the dependency graph).

**Wave 2 sub-phase — soak periods (not deploys, calendar time):**

- **A1-ii soak:** minimum two full weeks of real production traffic (including at least one weekend, to avoid low-traffic false confidence) with the shadow path's computed outcome logged and compared against the saga's actual direct-call outcome for every purchase. Exit criterion: **zero divergence** across the full sample. Any divergence found resets the soak clock after the divergence's root cause is fixed — do not shorten the window to hit a deadline.
- **A4b soak (if PSP sandbox/shadow-traffic support exists):** a shorter, PSP-integration-dependent window comparing the real adapter's outcome against the trusted-token path for a limited traffic slice before A4c (Wave 4) can begin.
- **A7b-ii..v soak (per channel):** sandbox/test-mode send-and-receive verification before each channel's full cutover — independent per channel, does not block the others.

### Wave 3 — depends on Wave 2 items reaching their _verified_, not just _deployed_, state

| Item        | Depends on                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------- |
| A1-vi       | A1-ii, **verified** (soak complete, zero divergence)                                               |
| A2          | A1-ii, **verified**                                                                                |
| A1-iii      | A1-ii (recommended, not hard)                                                                      |
| A1-iv, A1-v | none (can ship any time; placed here only to close out the A1 cluster together)                    |
| A3          | A1-i (soft, design-only); recommend landing in the same wave as A1-vi given shared-file contention |
| A6c         | A6b-i (recommended pattern)                                                                        |
| A6d         | A6b-i (recommended pattern)                                                                        |

**Deploy order within Wave 3:**

1. A1-vi (the cutover — **this is the single highest-scrutiny deploy in the entire plan**, see §5/§6 for its dedicated monitoring and rollback checkpoints).
2. A1-iii, A1-iv, A1-v (low-risk cleanup, land immediately after or alongside A1-vi).
3. A3 (land after A1-vi to avoid two concurrent large edits to `purchase-saga-activities.ts` — includes its own schema migrations, see §3).
4. A2 (after A1-vi — cleaner single-producer state for the signal source, though not a hard requirement).
5. A6c, A6d (fully independent of the A1 cutover — can deploy any time in this wave or earlier; placed here for narrative grouping only, not a real gate).

### Wave 4 — depends on Wave 2/3 items

| Item | Depends on                                                     |
| ---- | -------------------------------------------------------------- |
| A4c  | A4b (hard); A1-vi, A3 (recommended, file-contention avoidance) |

**Deploy order within Wave 4:**

1. A4c only. This is the last Phase A item to cut the saga's actual money-movement path over to full PSP verification. Deploy with the same shadow-comparison discipline as A1-ii (compare PSP-verified outcome against the trusted-token path before fully retiring the fallback).

---

## 2. Rollback Order

**General principle: rollback order is the reverse of deployment order, wave by wave, with one exception — items that establish a shared foundation (A6a, A1-i, A9a, A7a-i, A7b-i) should be the _last_ things rolled back, since rolling them back while their Wave 2/3 dependents are still deployed breaks those dependents, not just the foundational item itself.**

### If a Wave 4 issue is found (A4c):

Roll back A4c only. A4b (the real adapter) and the rest of Payments stay live — A4c is purely the saga's wiring onto it, reverting it returns the saga to the trusted-token fallback, which is worse (per A1-v's tightening) but not broken.

### If a Wave 3 issue is found:

- **A1-vi divergence discovered post-cutover** (the highest-severity rollback scenario in this plan): re-enable the saga's direct `payment_received` call immediately via the same flag A1-vi's deploy used to disable it (this flag must be kept live and tested, not removed, until a full release cycle after cutover has passed cleanly). Do **not** roll back A1-ii itself — the consumer-driven path can keep running in shadow/logging mode while the direct call resumes as the system of record, exactly reverting to the pre-cutover dual-path state.
- **A3 issue:** roll back A3's dedup-key logic per-activity (the flag from §1's dark-launch table allows this independently of A1-vi/A2 — A3's rollback does not require touching either).
- **A2 issue:** disable the signal-sending toggle; the durable Temporal path reverts to its pre-A2 behavior (15-minute timeout, compensation) — degraded but not broken, and the synchronous HTTP fallback is entirely unaffected.
- **A6c/A6d issue:** unregister the specific consumer; Finance's ledger stops receiving that category of posting again, no data corruption risk since these are purely additive consumers layered on an append-only ledger.

### If a Wave 2 issue is found:

- **A1-ii issue during soak:** disable the shadow-mode flag; the saga's direct call remains the sole system of record throughout, exactly as it is today — zero customer impact, since A1-ii was never the system of record during soak by design.
- **A4b issue:** composition-level swap back to the in-memory PSP adapter, with A4a's fail-loud guard now in place to make any _future_ misconfiguration loud rather than silent (this is exactly why A4a is sequenced before A4b).
- **A5a–e issue (any one context):** revert that context's composition swap back to the in-memory store — fully independent per context, rolling back Payments' store does not affect Fulfillment's.
- **A6b-i issue:** unregister the consumer, same as A6c/A6d above.
- **A9b issue:** revert `AcceptItems`' compensation logic; A9a (the real adapter) stays live and functioning on its own.
- **A7a-ii / A7b-ii..v issue:** disable the specific worker or channel-adapter flag; other channels/workers are unaffected (each is independently toggleable per §1's dark-launch table).

### If a Wave 1 issue is found:

- **A6a issue:** since it's opt-in, existing (non-opted-in) consumers are entirely unaffected by a rollback — only the opted-in consumers (whichever of A5a-e/A6b-i/A7a-ii have shipped and opted in) would need their opt-in flag disabled first, in the reverse order they opted in, before A6a itself is rolled back.
- **A1-i issue:** cannot be rolled back once A1-ii has shipped and is running its soak, since A1-ii's consumer logic depends on the lookup method existing — if a genuine defect is found in A1-i during the soak period, fix forward (patch the lookup method) rather than rolling back, to avoid destabilizing an in-progress soak.
- **A9a, A8, A10, A4a, A7a-i, A7b-i:** each trivially revertible independently, no cross-item impact (confirmed isolated or low-contention in the dependency graph).

---

## 3. Migration Order

Confirmed schema migrations required across Phase A (per `IMPLEMENTATION_DEPENDENCY_GRAPH.md`'s corrected findings):

| Migration                                                                    | Table                   | Item | Wave                                  |
| ---------------------------------------------------------------------------- | ----------------------- | ---- | ------------------------------------- |
| Unique constraint `(tenantId, fulfillmentRef, idempotencyKey)` or equivalent | `Shipment`              | A8   | Wave 1                                |
| Unique constraint on `(tenantId, itemId, reference)`                         | `Reservation`           | A3   | Wave 3                                |
| Unique constraint on an idempotency key                                      | `PaymentIntent`         | A3   | Wave 3                                |
| (Conditional) additive event-payload fields, no DB schema change             | `Order`/`OrderPaidData` | A6d  | Wave 3 (pending stakeholder decision) |

**Migration ordering principle: every migration in this plan is additive (a new constraint on an existing table, or new optional fields on an event payload) — none require a destructive schema change, so the standard expand-contract discipline applies: migration runs and is verified clean _before_ the code that depends on it deploys, never after.**

1. **Before A8's code deploys (Wave 1):** run a pre-migration audit query against `Shipment` for any existing `(tenantId, fulfillmentRef)` duplicates that would violate the new unique constraint. If found, resolve them manually (they represent already-happened duplicate-shipment incidents from the pre-fix bug) before applying the constraint. Apply the constraint. Verify no violations. Only then deploy A8's application code.
2. **Before A3's code deploys (Wave 3):** run the equivalent pre-migration audit against `Reservation` and `PaymentIntent` for existing near-duplicate rows that the new constraints would reject. Apply both constraints (can run in the same migration window, they're on independent tables — no ordering dependency between the two). Verify no violations. Only then deploy A3's application code.
3. **A6d's conditional field addition** (Wave 3, pending the net/tax-split stakeholder decision) is a pure additive change to an event payload, not a database migration — no pre-migration audit needed, but confirm no other consumer of `orders.order.paid` exists that could be broken by new fields (confirmed in the execution matrix: none do today).

**No migration in this plan requires a backfill of historical data as a hard requirement.** Two items (A6c, A6d) have an _optional_ historical-replay decision (should already-accepted returns / already-paid legacy orders be retroactively journaled), which is a business decision to surface to Finance stakeholders, not an engineering default — if approved, it runs as a one-time, out-of-band replay job after the relevant consumer is live and stable, never as part of the cutover critical path itself.

---

## 4. Verification Order

Verification is nested: each wave verifies (a) its own new code, and (b) that no earlier wave's guarantees have regressed.

### Wave 1 verification

- A6a: structural test confirming the 4 external-call-making consumers (`TrackingIngestHandler`, Security's Keto/Kratos consumers) are **not** wrapped in a DB transaction — this is a regression test, not just a feature test, since the entire point of the opt-in correction is that this must never accidentally change.
- A1-i: unit test on the new lookup method against both `PrismaOrderRepository` and `InMemoryOrderRepository`.
- A9a: integration test confirming the real adapter is actually called (not the stub) and that a retried restock request does not double-count on-hand quantity.
- A8: migration-verification (no constraint violations) + unit test for the new idempotency-key parameter.
- A10: the sku-swap-specific test case + a storefront-facing read-path test (not an event-consumption test, per the execution matrix's correction of what the real downstream impact path is).
- A4a: composition test asserting a Prisma-configured environment throws on startup if no real PSP adapter is injected.
- A7a-i, A7b-i: composition tests confirming the new surface/branching exists and behaves correctly in isolation.

### Wave 2 verification

- A5a–e: **first-ever** integration tests against a real/test Postgres instance for each of the five stores (none existed before this wave, per the dependency graph's finding) — specifically including a simulated-crash test between claim-commit and entity-mutation-commit, confirming the new tx-threaded path does not lose the transition.
- A6b-i: integration test posting a real refund event through the corrected payload mapping, asserting a correctly-reversed journal entry.
- **A1-ii — the verification for this item _is_ the soak period itself**, not a pre-deploy test suite alone: continuous, automated comparison of the shadow path's computed outcome against the saga's actual direct-call outcome, for every real purchase, for the full soak window. A dashboard/report showing cumulative divergence count (target: zero) is the actual verification artifact this item produces, not a one-time test run.
- A9b: integration test simulating a restock failure against the now-real A9a adapter, confirming durable retry/compensation actually functions (explicitly noted in the dependency graph as meaningless before A9a existed — now testable for real).
- A4b: PSP sandbox/test-mode integration tests including a forced-failure case; signature-verification tests with valid/forged payloads; the specific `WEBHOOK_TRANSITIONS` "captured" fix test.
- A7a-ii: integration test per new consumer using verified-real event names only (explicit negative test that `inventory.stock.low`/`identity.user.invited` consumers were never attempted).
- A7b-ii..v: sandbox/test-mode send-and-receive test per channel.

### Wave 3 verification

- **A1-vi — the highest-stakes verification gate in the plan.** Preconditions before this deploy is even attempted: (1) A1-ii's soak dashboard shows zero divergence across the full window; (2) a manual sign-off from whoever owns the purchase flow, not just an automated gate, given the financial-critical nature. Post-deploy: the same divergence-monitoring dashboard continues running for a follow-up window (recommend one additional week) with the _roles_ of the two paths now reversed — the consumer-driven path is the system of record, and any manual/support-driven order-paid action is compared against it as a sanity check, not the other way around.
- A2: integration test starting a workflow, publishing a captured event through the now-cutover A1 consumer, asserting completion within the capture window.
- A3: Temporal test-environment replay tests simulating a lost ack on each convergent activity; explicit multi-line partial-failure compensation test.
- A6c, A6d: integration tests per consumer, as scoped in Wave 2's pattern.

### Wave 4 verification

- A4c: shadow-comparison verification (PSP-verified outcome vs. trusted-token outcome) for a limited traffic window before full cutover, mirroring A1-ii's discipline; explicit re-verification of the saga's deterministic core compensation table against the now-real capture step's failure modes.

---

## 5. Monitoring Checkpoints

Checkpoints are what gets watched _during_ and immediately _after_ each deploy — distinct from the verification tests that gate the deploy in the first place.

| Wave | Checkpoint        | Signal to watch                                                                                                                                                                                                                                                                                                                                                                                                                           | Cadence                                                                        |
| ---- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | A6a rollout       | Zero change in latency/error rate for the 4 external-call consumers specifically (confirms they were correctly excluded from atomic wrapping)                                                                                                                                                                                                                                                                                             | Continuous for 48h post-deploy                                                 |
| 1    | A8/A3 migrations  | Constraint-violation rate on writes to `Shipment`/`Reservation`/`PaymentIntent` (should be zero post-migration; any non-zero rate indicates a bug in the deduplication logic being deployed on top of the constraint)                                                                                                                                                                                                                     | Continuous from migration application onward                                   |
| 2    | A1-ii soak        | Divergence-count dashboard (target: zero); saga completion rate and latency (must not regress vs. pre-A1-ii baseline, confirming the shadow computation isn't adding meaningful overhead to the hot path)                                                                                                                                                                                                                                 | Daily review throughout the soak window                                        |
| 2    | A4b rollout       | PSP call error/timeout rate (first time this can be nonzero — establish a baseline, don't assume zero is "correct," a real PSP has real transient failures); the newly-added error-handling paths in `CapturePaymentLifecycle`/`RefundPaymentLifecycle` specifically (watch for unhandled-exception rate, which should now be zero since raw 500s were the pre-fix failure mode)                                                          | Continuous for the first week live                                             |
| 2    | A5a–e rollout     | Webhook/callback claim-then-mutate crash-window incidents (should be exactly zero given the tx-threading fix — any nonzero count is a direct signal the fix has a bug)                                                                                                                                                                                                                                                                    | Continuous, indefinite (this is a correctness invariant, not a one-time check) |
| 2    | A7b-ii..v rollout | Per-channel delivery success rate (email/SMS/push/webhook each independently)                                                                                                                                                                                                                                                                                                                                                             | Continuous per channel from its own cutover                                    |
| 3    | A1-vi cutover     | **The single most important checkpoint in this entire plan.** Order-paid rate for saga-originated purchases (must match pre-cutover baseline within normal variance); Finance/Fulfillment consumer error rate on `orders.order.payment_received` (must not spike); DLQ entry rate for the previously-broken id-correlation path (should drop to its now-expected zero, confirming the root defect is actually closed, not just relocated) | Real-time for the first 24h, then daily for the following week                 |
| 3    | A2 rollout        | Durable-saga completion rate (should rise from its pre-fix near-zero, confirming the signal is actually being received)                                                                                                                                                                                                                                                                                                                   | Daily for two weeks                                                            |
| 3    | A3 rollout        | Duplicate-reservation/duplicate-intent count (should drop to zero); saga infinite-retry-hang count (should drop to zero)                                                                                                                                                                                                                                                                                                                  | Continuous, indefinite                                                         |
| 4    | A4c cutover       | Real-PSP-call rate on the saga's synchronous path specifically (should rise from zero, confirming the rewiring actually took effect and isn't silently falling back to the trusted-token path); capture failure/decline rate on this specific path (first time it can be nonzero)                                                                                                                                                         | Real-time for the first 24h, then daily for the following week                 |

---

## 6. Rollback Checkpoints

The specific trigger conditions that should initiate the rollback procedures in §2, per wave — these are the "if you see X, roll back" thresholds, distinct from the general monitoring in §5.

| Wave | Trigger condition                                                                                                                                                                                                         | Action                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Any constraint-violation-rate above zero sustained for more than a few minutes post-migration (A3/A8)                                                                                                                     | Halt further rollout of the dependent application code; investigate the specific violating rows before proceeding — do not force the migration through.                                                                                                                                                                                                                                                                             |
| 2    | Any divergence detected in A1-ii's shadow comparison                                                                                                                                                                      | **Do not treat as a rollback trigger by itself** — this is expected-and-designed-for during soak (the whole point is to find and fix divergences before cutover). Reset the soak clock after the root cause is fixed. Only escalate to "abandon this design" if divergences recur systematically after multiple fix attempts, which would indicate a deeper architectural problem worth surfacing back to the plan, not just a bug. |
| 2    | A4b: PSP error rate exceeding an agreed threshold (define with the payments team before rollout — this document doesn't set a numeric threshold since it depends on the specific PSP's own SLA)                           | Composition-level rollback to the in-memory adapter (protected by A4a's fail-loud guard against silent misconfiguration on the way back).                                                                                                                                                                                                                                                                                           |
| 2    | A5a–e: any observed claim-then-mutate crash-window incident (target is zero; any occurrence is a bug in the fix itself, not normal operation)                                                                             | Immediate rollback of the specific context's store to in-memory, plus a priority investigation — this failure mode is worse than the pre-fix state if it recurs, since it's silent by nature.                                                                                                                                                                                                                                       |
| 3    | **A1-vi: any of — order-paid rate for saga purchases drops below baseline; Finance/Fulfillment consumer error rate spikes; any manual/support escalation reporting a paid order that never shows as paid, or vice versa** | **Immediate rollback** via the flag re-enabling the saga's direct call (§2's Wave-3 procedure). This is the one checkpoint in the entire plan with a "roll back first, investigate after" posture rather than "investigate, then decide" — the financial-integrity stakes justify the asymmetry.                                                                                                                                    |
| 3    | A2: durable-saga completion rate does not rise as expected within the first week                                                                                                                                          | Not itself a rollback trigger (the synchronous fallback continues serving traffic regardless) — investigate whether the signal is actually firing before assuming a deeper problem.                                                                                                                                                                                                                                                 |
| 3    | A3: any duplicate-reservation or duplicate-intent detected post-deploy                                                                                                                                                    | Disable the specific activity's dedup-key flag (per-activity granularity, per §1's dark-launch table) — does not require rolling back A1-vi or A2, which are independent of A3's specific mechanism.                                                                                                                                                                                                                                |
| 4    | A4c: capture failure rate on the real-PSP path exceeds what A4b's own standalone rollout established as baseline, or any discrepancy between the shadow-comparison's two computed outcomes                                | Rollback to the trusted-token fallback path (A1-v's tightened but still-token-based check) — acceptable as a temporary regression since it's strictly the pre-A4c state, not a new failure mode.                                                                                                                                                                                                                                    |

---

## 7. Summary

Four deployment waves, two calendar-bound soak periods (A1-ii's shadow verification, A4b/A4c's PSP-traffic shadowing), three confirmed schema migrations (all additive), zero required data backfills (two optional, business-decision-gated replays). The highest-scrutiny single event in this entire plan is **A1-vi's cutover** — every other item in Phase A can be rolled back cleanly and independently; this one item's rollback checkpoint is deliberately asymmetric ("roll back first, investigate after") because it sits at the exact point the whole remediation program exists to fix: payment truth. Everything upstream of it (Wave 1, most of Wave 2) exists to make that one cutover safe to perform; everything downstream of it (A2, A4c) exists to build on the correctness it establishes.
