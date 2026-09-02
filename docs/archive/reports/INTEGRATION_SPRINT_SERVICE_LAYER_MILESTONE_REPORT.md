# Integration Sprint — Service-Layer Composition Surface (Milestone Report)

**STATUS: NOT MERGED.** This work was fully reconstructed, gate-verified in isolation, and briefly
committed (`44be526`), then **reverted by explicit user decision** after it was discovered to break
`apps/admin`'s typecheck (which was 74/74 green before this milestone, 74/76 after — `apps/admin`'s
controllers for checkout/payments/orders/fulfillment reference pre-reshape method names and cannot
be patched narrowly; fixing them cascades into the same ~40-package admin-wiring entanglement
already documented in `INTEGRATION_SPRINT_APP_WIRING_STATUS.md` as its own separate, deferred
effort). The canonical branch must never carry a known typecheck regression, so this milestone is
kept as **fully investigated and partially reconstructable evidence**, not as landed history. It
should be re-attempted only together with (i.e. in the same change as, or strictly after) the
admin-wiring milestone, so the two land in a mutually consistent, fully-green state.

**Evidence basis: see `INTEGRATION_SPRINT_EXCEPTION.md`.** Everything below describes the
reconstruction as it was verified in isolation (all 11 packages' own gates green) — it does not
describe the current state of `recovery/history-reconstruction`, which has this work reverted.

## What landed

Full `src/` tree updated to match `lumo-platform`'s current state for eleven packages:
`checkout`, `payments`, `orders`, `notifications`, `fulfillment`, `promotions`, `coupons`, `cart`,
`pricing`, `inventory`, plus a single-line surgical addition to `catalog` (the `GetProduct`/
`GetProductInput` barrel export — the underlying use-case file already existed, byte-similar, in
the prior commit; only the export was missing).

Each of the ten full-tree packages gains the same idiom: new `application`-layer use-case classes
wired into `Wired*.activities`/`Wired*.queries`, and — for `checkout`/`payments`/`cart` — a new
`prisma` composition branch that didn't exist before (these contexts previously had in-memory-only
composition roots). `catalog`'s `Wired*` shape and Prisma schema were **not** touched — its own
broader domain-model diff (`product.ts`, `product.test.ts`) is unrelated to the `GetProduct` export
gap and remains an explicitly open, uninvestigated item (see `COMPOSITION_SURFACE_RECONCILIATION_REPORT.md` §5).

**Prisma schemas updated to match**: `cart.prisma`, `checkout.prisma`, `orders.prisma`,
`payments.prisma`, `notifications.prisma`, `fulfillment.prisma`, `promotions.prisma`,
`coupons.prisma`, `pricing.prisma`, `inventory.prisma` (catalog's schema was reverted after an
initial copy attempt broke typecheck — see below). **No migration exists for any of these schema
changes** in either repository; this is a real, separate gap (Database Readiness, out of scope for
this milestone, to be picked up by the Final Operational Readiness Sprint's DB-audit task).

## Corrections made during reconstruction (not part of the original diff)

- **`services/fulfillment/src/application/{create-shipment,request-reservation}.use-case.ts`** —
  these two files exist only in the prior commit; `lumo-platform` consolidated their logic into
  `fulfillment-lifecycle.use-cases.ts` (confirmed: `composition.ts` wires `CreateShipment`/
  `RequestReservation` from the consolidated file, with matching class implementations). Removed
  the two stale standalone files rather than leaving orphaned, non-compiling duplicates.
- **`services/orders/src/domain/value-objects/order-totals-snapshot.ts`** — same situation;
  `lumo-platform` inlines `OrderTotalsSnapshot` directly into `domain/order.ts`, and
  `infrastructure/order.mapper.ts` was confirmed to import it from there, not the old value-object
  path. Removed the stale file.
- **`packages/db/prisma/schema/catalog.prisma`** — initially copied from `lumo-platform` alongside
  the other ten schemas, but this broke `@platform/catalog`'s typecheck (`Collection` model gained
  a `publishState` field that `prisma-catalog-repositories.ts` — untouched, since catalog's broader
  diff is out of scope — doesn't know about). Reverted to the prior commit's schema; only the
  `GetProduct` export was authorized for catalog, not its Prisma model.
- **Three pre-existing lint violations**, caught by this milestone's own gate run: `services/notifications/src/domain/notification.ts` line 6 (`NotificationChannel` import, type-only usage → `import type`), `services/payments/src/composition.ts` and `services/checkout/src/composition.ts` (both had an inline `import("@platform/db").TransactionClient` type annotation → hoisted to a top-level `import type { TransactionClient }`).

## What did NOT land (explicitly, per the exception's scope)

- **Finance** — deferred entirely. Its Integration-Sprint-cited symbols (`OrderPaymentReceivedConsumer`,
  `post-order-paid-journal.use-case.ts`, the `ShippingRateCard`/`QuoteShippingRates` cluster)
  themselves import from Finance's M2-reorg infrastructure (`events/consumers.ts`,
  `events/inbound-contracts.ts`, a consolidated `domain/repositories.ts`) — verified directly by
  reading their import statements. This contradicts `COMPOSITION_SURFACE_RECONCILIATION_REPORT.md`'s
  working assumption that Finance's Integration-Sprint cluster was separable from its M2 reorg; in
  practice they are not. Since the M2 reorg itself has no primary evidence and is explicitly outside
  this exception's scope, all of Finance is deferred rather than landing a subset that would need to
  silently absorb the M2 reorg to compile. This is a new finding beyond what the reconciliation
  report anticipated — flagged here for whoever picks up Finance next.
- **`apps/admin`, `apps/runtime` composition wiring** — the second commit this exception authorizes;
  not part of this one. `apps/admin` currently fails typecheck against this commit alone (its
  `payments.admin-controller.ts` already expects `PaymentController.captureLifecycle`/
  `refundLifecycle`/`getPaymentIntent`, which `wirePayments`'s new activities do provide — the
  controller and the composition wiring must land together).
- **The purchase saga** (`purchase-saga-activities.ts`, `purchase-saga-routes.ts`) — permanently
  excluded per `INTEGRATION_SPRINT_EXCEPTION.md`, not part of any commit under this exception.
- **Five additional touched packages** identified in `COMPOSITION_SURFACE_RECONCILIATION_REPORT.md`
  §4 (promotions/coupons/cart/pricing/inventory) — these were included in this commit's ten-package
  set (they were part of the original seven-plus-five list); confirmed here for clarity since §4's
  framing described them as "outside the original seven."

## Verification

`pnpm --filter <each of the 11> typecheck/test/lint`: all green (exact test counts per package
available via `pnpm test` output; no failures). `pnpm arch`: 0 violations (1530 modules, up from
1531 after Customer-360 — the one-file decrease reflects the two removed stale files net of new
ones). Full monorepo `pnpm typecheck`: 73/75 tasks green; the two expected failures
(`apps/admin`, tracked separately) are exactly the app-composition-wiring dependency this milestone
report names above, not a regression.
