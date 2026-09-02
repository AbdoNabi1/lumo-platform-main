# Sprint 2.8 Report — Purchase Saga Architecture (Temporal)

> 2026-07-05. Phase A (architecture) THEN Phase B (implementation), as mandated.

## Phase A — ADRs written and frozen

- **ADR-0011 Metafields** (closes G-34 decision): typed definitions-then-values, tenant + app
  (`app--<id>`) namespaces, per-owner-type value tables (no cross-context FKs), append-only
  definition versioning, filterable-fields project into CDC read models, API exposure gated by
  visibility + scopes. No implementation (lands with storefront/read-model phase; additive tables).
- **ADR-0012 Purchase saga & PSP** (closes G-11): Temporal workflow per checkout
  (`purchase:<tenant>:<session>` = natural idempotency); capture truth arrives as a SIGNAL from
  the webhook→outbox event, never an activity return (doc-22 rule holds inside the saga);
  compensation table incl. the money-moved path (refund → release → fail → operator alert) and
  the convergent tail (never auto-unwind a paid order); bounded vs convergent retry policies;
  breaker in activities (not workflows); `manualResolve`/`reconcile` operator surface;
  `PaymentProvider` port with idempotencyKey on every money call, webhook verification, NO SDKs.
- **ADR-0013 Reservation ledger** (closes G-7): immutable append-only `reservation_entries`
  (`reserve|release|commit|expire`, unique `(reservation_id, kind)` = idempotent lifecycle),
  oversell prevention via single-statement conditional counter update (row-lock, not aggregate
  version storms), monthly partitioning, ledger IS the stock audit trail, CDC-fed availability
  read models + reconciliation job. Domain/ports unchanged; adapter-local change as D-042 anticipated.

## Phase B — implemented

- `PaymentProvider` port in contracts (createIntent/capture/cancel/refund + verifyWebhook, all
  idempotency-keyed; tokens only).
- `@platform/temporal`: **deterministic saga core** (`runPurchaseSaga` — pure orchestration: no
  clock, no ids, no I/O; all effects via the `PurchaseSagaActivities` port; compensation exactly
  per the ADR table) · Temporal workflow adapter (`purchaseWorkflow`: proxyActivities with
  bounded + convergent retry profiles, capture signal-or-15m-timeout via `condition`, signal
  dedup, `manualResolve` signal, `reconcile` query) · worker/client factories
  (`createPurchaseWorker` on task queue `purchase-saga`, `startPurchase` with the natural
  workflow id). Supply-chain: `@temporalio/core-bridge` + `@swc/core` added to the D-016
  `allowBuilds` allowlist (the sanctioned mechanism).

## Testing

**7 saga tests, genuinely green offline** — because the core is deterministic by construction:
happy-path exact step sequence; inventory-unavailable (nothing to unwind); PSP-down reverse-order
compensation; payment-failed and capture-timeout paths; the money-moved path
(refund→release→fail→alert); and a REPLAY test proving identical inputs yield byte-identical
decision logs. Honestly gated: live Temporal execution (server container joins compose in the
first live session — engine down; adding unvalidatable YAML would be a fake, same call as 2.7).

## Validation

lint / typecheck / test / build **118/118** ✅ · dependency-cruiser **0 violations (449
modules)** ✅ · nothing faked.

## Deferred

Temporal + Ory containers in compose (first live session) · activity implementations wiring the
contexts' application layers + the payments-captured→signal bridge (worker composition sprint —
needs the runtime to validate) · PSP adapters (`@platform/psp-stripe` first) · reservation-ledger
migration + adapter (next inventory sprint per ADR-0013) · OTel interceptors on worker/client (G-19).
