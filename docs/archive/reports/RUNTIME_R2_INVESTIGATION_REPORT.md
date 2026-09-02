# Runtime Additions / R2 (Purchase Saga) Investigation Report

**Status: Nothing landed. Full investigation, attempted commit, then fully reverted after
discovering the real blocker was broader than expected.** `apps/runtime` remains exactly as
committed by R1/R3/P3/P4 (`git status --short apps/runtime` clean, `pnpm --filter @platform/runtime
typecheck` green, unchanged from before this investigation).

## What's new in `apps/runtime` vs. `lumo-platform-recovery` (79 files)

| Cluster                                                                                                                                                                | Files | Verdict                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purchase saga core (`purchase-saga-activities.ts`+e2e test, `purchase/*`)                                                                                              | 5     | **Blocked** — see below                                                                                                                                                                                                 |
| Fulfillment/Finance/Shipment-notification runtime wiring (new `composition.ts` functions + `notifications/shipment-shipped.consumer.ts`)                               | 3     | **Blocked** — see below (newly discovered; initially believed committable)                                                                                                                                              |
| `tracking/*` (M6 tracking engine runtime wiring)                                                                                                                       | 12    | Blocked on K7 remainder (`runtime/replay-runtime.ts`, `runtime/telemetry.ts`, `definitions/{event-definition,parameter}.ts`, `inspector/timeline.ts` — all still zero-evidence per `K7_FINAL_RECONCILIATION_REPORT.md`) |
| Phase 4B module framework (`module.ts`+test, `platform.ts`+test, `modules/*` — 51 files, `diagnostics.ts`, `jobs.ts`, `health-server.ts`, `metrics.ts`, `shutdown.ts`) | 58    | Blocked — no primary evidence anywhere; `R1_MILESTONE_REPORT.md`/`R1_PRE_FLIGHT_REPORT.md` already explicitly deferred this exact file list as Unknown, unchanged by this pass                                          |
| `entitlement/*`, `security/*`                                                                                                                                          | 57    | Already fully committed (P1.1/P2.0.1-3) — not part of this investigation                                                                                                                                                |

## R2 (Purchase Saga) — real evidence exists, but it's not committable as-is

Two rounds of research found genuine primary-source evidence this time, correcting the prior
`RECONCILIATION_REPORT_2026-08-02.md` verdict ("no dedicated evidence report exists anywhere"):
`docs/architecture/adr/0012-purchase-saga-and-psp.md` and `docs/DECISIONS.md` D-049 (both already
committed) prescribe exactly the deterministic-core-plus-thin-Temporal-adapter pattern
`purchase-saga-activities.ts` implements, and the already-committed
`docs/implementation/ARCHITECTURE_REMEDIATION_PLAN.md`/`IMPLEMENTATION_DEPENDENCY_GRAPH.md` treat
`apps/runtime/src/purchase-saga-activities.ts` and `purchase/purchase-saga-routes.ts` as existing,
already-audited files (SAGA-1 through SAGA-11 findings match the current code line-for-line).

**What actually blocks it is not missing evidence — it's type-level API drift.**
`purchase-saga-activities.ts` imports named use-case classes directly from package barrels —
`ValidateCheckout`, `GenerateOrderDraft`, `GeneratePaymentIntentRequest`, `CompleteCheckout`,
`FailCheckout` from `@platform/checkout`; `GetProduct` from `@platform/catalog`; `CapturePayment`,
`CreatePaymentIntent`, `FailPayment`, `GetPaymentIntent`, `RefundPayment` from `@platform/payments`;
`AdvanceOrder`, `CreateOrderFromCheckout` from `@platform/orders`; `CreateNotification` from
`@platform/notifications` — **none of which are exported under those names by the currently-committed
versions of those packages** (verified directly against each package's `src/index.ts`).
`purchase-saga-test-fixture.ts` additionally expects `CheckoutController` methods (`setBilling`,
`requestTax`, `selectShippingMethod`, `recalculate`, etc.) that don't exist on the committed
`CheckoutController` (which has `selectShipping`/`selectPayment`/`requestShippingQuote` instead).

This means `checkout`, `catalog`, `payments`, `orders`, and `notifications` all evolved a richer,
differently-shaped composition surface in `lumo-platform`'s working tree, past what C1-C12
committed — not a small drift, a real additional layer of use-case-level exports and controller
methods across five packages simultaneously.

## Fulfillment/Finance/Shipment-notification — same class of problem, discovered mid-attempt

These three were initially assessed (correctly, on their own composition.ts usage) as self-contained
and committable — `composition.ts`'s own new functions typechecked clean on the first pass. But the
underlying packages they call into have the identical drift:

- `@platform/fulfillment`'s committed barrel has no `CreateFulfillment`, `FulfillmentEventTranslator`,
  `InMemoryNotificationPort`, `OrderPaymentReceivedConsumer`, or `OrderPaymentReceivedPayload` export
  (confirmed: `services/fulfillment/src/index.ts` doesn't list them).
- `@platform/finance`'s committed `WiredFinance`/`FinanceWiringDeps` has no `.activities` and no
  `prisma` input field, and no `OrderPaymentReceivedConsumer`/`OrderPaymentReceivedPayload` export
  (confirmed directly: `services/finance/src/index.ts` exports `wireFinance`/`WiredFinance`/
  `FinanceWiringDeps` in a materially simpler shape).
- `@platform/notifications`'s committed `WiredNotifications` has no `.activities`, and no
  `CreateNotification` named export.
- `@platform/orders`'s committed `WiredOrders` has no `.queries`, and no `GetOrder` named export.

This was caught empirically by this session's own typecheck run, not predicted by the initial
research pass (which correctly checked `composition.ts`'s _own_ imports but the two-hop dependency —
does the _committed_ version of the package it calls into actually have the shape the new code
expects — required an actual compile to surface, the same category of gap `K7_FINAL_STATUS.md`
documented for the tracking package's barrel).

## Bottom line

**Nothing in the "new `apps/runtime`" surface is committable right now without first reconstructing
a broad, cross-package evolution** spanning at minimum `checkout`, `catalog`, `payments`, `orders`,
`notifications`, `finance`, and `fulfillment` — each needs additional use-case-level barrel exports
and/or a reshaped `Wired*` composition return type (`.activities`/`.queries` namespacing) added on
top of what C1-C12/T1-Core/G1 committed. This is materially larger than "land the purchase saga" —
it's closer in kind to the Finance `ShippingRateCard`/`QuoteShippingRates` deferred-cluster gap
(a separate, already-identified milestone, see the Finance investigation), except here it spans
seven packages instead of one, and no single Sprint Report documents it as one coherent unit.

**Recommendation:** treat this as a new, larger, not-yet-scoped milestone (tentatively "Phase 7 —
Cross-Context Activity Surface," pending a name grounded in whatever primary source, if any, actually
describes it) rather than attempting to patch it file-by-file inside this runtime-wiring pass. No
code changed as a result of this investigation; `apps/runtime` is unchanged from R1/R3/P3/P4.
