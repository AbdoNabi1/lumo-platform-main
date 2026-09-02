# Integration Sprint — Explicit Evidence Exception

**This is the only named exception to this recovery's standing evidence-sourcing methodology
(`RECOVERY_IMPLEMENTATION_METHODOLOGY.md`). Every other milestone in this history — K1 through A1,
K7-partial, Customer-360 — was reconstructed only where sources 1-5 of the methodology's precedence
(Recovery Plan, Sprint Reports, ADRs, architecture docs, existing committed history) provided
primary evidence. This one milestone is reconstructed on tier-6 evidence (the dirty working tree
itself) alone, by explicit user authorization, because no source at tiers 1-5 names it.**

## Why this milestone doesn't meet the normal bar

`COMPOSITION_SURFACE_RECONCILIATION_REPORT.md` (committed `99d2c0e`) found that twelve packages —
`checkout`, `catalog`, `payments`, `orders`, `notifications`, `finance`, `fulfillment`, `promotions`,
`coupons`, `cart`, `pricing`, `inventory` — and both app composition roots (`apps/admin`,
`apps/runtime`) carry a coherent, internally-consistent, self-cited body of work referring to itself
as the **"Integration Sprint"**, with one explicit architecture correction dated **2026-07-26**
("Shipping owns all carrier integration; Fulfillment only requests a shipment," repeated verbatim
across 3+ files). No `docs/implementation/SPRINT_*_REPORT.md`, no `docs/DECISIONS.md` entry, no
`docs/architecture/adr/*.md` names this work as a unit, or names any of its new symbols
individually. A direct grep for the literal string "Integration Sprint" and a filename glob for
`*INTEGRATION*` across the entire `lumo-platform` working tree — including its ~30 root-level
recovery-planning documents — found nothing beyond the self-citing docstrings themselves.

## Every source actually used

Because tiers 1-5 are silent, this milestone's reconstruction rests entirely on:

1. **The dirty working tree in `lumo-platform`** — the source code itself, read in full for every
   changed file across all twelve packages plus both composition roots. This is normally
   verification-only evidence (tier 6); here it is the origin.
2. **Self-citing docstrings inside that same dirty tree** — e.g. `apps/runtime/src/composition.ts`'s
   "Production Fulfillment slice for the worker (Integration Sprint — Customer Purchase Flow)",
   `services/fulfillment/src/domain/value-objects/fulfillment-refs.ts`'s "Integration Sprint
   architecture correction, 2026-07-26," `services/finance/src/interfaces/order-payment-received.consumer.ts`'s
   "Customer Purchase Flow (Integration Sprint — Finance leg)." These are the code's own claims
   about itself, not an external record.
3. **Two already-committed documents used only as partial, indirect corroboration, never as a
   specification**: ADR-0012 (purchase saga & PSP, Accepted, Sprint 2.8) legitimizes the general
   five-step orchestration shape this surface implements; D-050 (runtime composition conventions,
   Sprint 2.9) establishes the general "activities compose against application layers" principle
   the `.activities`/`.queries` pattern follows. Neither names a single one of this milestone's new
   classes.
4. **Already-committed audit findings** (`ARCHITECTURE_REMEDIATION_PLAN.md`,
   `IMPLEMENTATION_DEPENDENCY_GRAPH.md`, `ARCHITECTURE_EXECUTION_MATRIX.md`) — these independently
   confirm several of this surface's files already exist in this exact shape and already carry known
   defects (SAGA-1 through SAGA-11, PAY-1 through PAY-6). This corroborates scope and file location,
   never exact signatures, and it is itself an audit of the artifact, not a build specification for it.
5. **Dependency-graph / static analysis performed this session** — confirming the twelve packages'
   new symbols never import each other directly (every cross-context call is mediated by a
   locally-defined port + an adapter in `apps/admin/src/infrastructure/cross-context-ports.ts` or
   `apps/runtime/src/composition.ts`), and confirming which already-committed services would or
   would not break if these packages' composition shapes changed.
6. **Runtime wiring verification** — `pnpm typecheck`/`test`/`lint`/`arch` run against the actual
   reconstructed code, the same gate every other milestone in this history must pass.

## Confidence level: explicitly lower than every other milestone in this history

Every other committed milestone (K1-A1, K7-partial, Customer-360) has at least Medium confidence
tied to a named primary source. This milestone's confidence is:

- **Medium** for the general shape, file scope, and existence of the reshaping (self-citation is
  consistent, dated, and cross-file-corroborated).
- **Low** for the exact signatures of individual new classes/methods (no source beyond the dirty
  tree itself confirms method names, parameter shapes, or field names are "correct" in any sense
  beyond "this is what the working tree currently contains").
- **Unknown, and explicitly NOT part of this exception**, for Finance's separately-tagged "M2"
  domain-services/read-model reorg (a different self-citation, no matching source found) and for
  Catalog's larger, un-cited `product.ts`/`product.test.ts` diff beyond the single `GetProduct`
  export gap. Neither is reconstructed under this exception; both remain open gaps.

This lower confidence tier is recorded here, in this one file, precisely so it is never confused
with the higher-confidence bar every other commit in this history met.

## Explicit, permanent exclusion: the Purchase Saga stays out of scope

**`apps/runtime/src/purchase-saga-activities.ts`, `apps/runtime/src/purchase/purchase-saga-routes.ts`,
`apps/runtime/src/purchase/purchase-saga-test-fixture.ts`, and `apps/runtime/src/modules/purchase-saga.module.ts`
are NOT reconstructed under this exception, or at all, by this milestone.** This is a deliberate,
separate decision from the composition-surface question this exception covers:

- The already-committed `ARCHITECTURE_REMEDIATION_PLAN.md` documents this exact file
  (`purchase-saga-activities.ts`) as carrying eleven confirmed defects (SAGA-1 through SAGA-11),
  including a payment-truth bypass (`placeOrder` force-advances to paid without real payment
  verification) and non-idempotent activities. Reconstructing known-defective code and presenting it
  as historical fact would not be reconstruction — it would be committing a bug under the guise of
  history.
- This exclusion is **not lifted** by anything in this exception. The Integration Sprint exception
  covers only: the twelve packages' shared application-layer composition surface (§below) and the
  app-composition wiring for Fulfillment/Finance/Shipping→Notifications. It does not cover, and does
  not authorize, any reconstruction of the saga orchestration code itself.
- **Future sessions: if you are extending this recovery and considering landing the purchase saga,
  this file's exclusion is not an oversight — re-read `RUNTIME_R2_INVESTIGATION_REPORT.md` and this
  section before reintroducing `purchase-saga-activities.ts`/`purchase-saga-routes.ts` in any form.**
  Fixing SAGA-1 through SAGA-11 first, as its own explicitly-scoped remediation, is a prerequisite,
  not something this exception grants by extension.

## What this exception actually authorizes

Two commits, in this order, covering only the shared composition surface and its wiring — never the
saga itself:

1. **Service-layer application surface** — new use-case classes/methods and `Wired*` shape changes
   in `checkout`, `catalog` (the `GetProduct` export gap only), `payments`, `orders`,
   `notifications`, `finance` (Integration-Sprint-cited symbols only — `OrderPaymentReceivedConsumer`,
   `post-order-paid-journal.use-case.ts`, the `ShippingRateCard`/`QuoteShippingRates` cluster — NOT
   the separately-tagged "M2" reorg), `fulfillment`, `promotions`, `coupons`, `cart`, `pricing`,
   `inventory`.
2. **App-composition wiring** — `apps/admin/src/infrastructure/cross-context-ports.ts`,
   `apps/admin/src/composition.ts`, and `apps/runtime/src/composition.ts`'s Fulfillment/Finance/
   Shipping→Notifications runtime slices (`buildFulfillmentTriggerRuntime`,
   `buildFinanceLedgerRuntime`, `buildShipmentNotificationRuntime`, and the `notifications/
shipment-shipped.consumer.ts` file they depend on) — explicitly excluding
   `wirePurchaseSagaContexts`/`buildPurchaseSagaActivities`/`buildPurchaseSagaTrigger`/
   `PurchaseSagaTrigger` and everything under `apps/runtime/src/purchase/`.
