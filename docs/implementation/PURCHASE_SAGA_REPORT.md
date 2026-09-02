# Purchase Saga — Payment Verification Gate — Report

**Status:** Complete. Scoped down from "Purchase Saga" (no such thing exists in canonical, and
correctly so — see §1) to the one concrete, evidenced, additive gap: gating the admin backoffice
`markOrderPaid` action behind a real Payments verification check, per explicit user decision.

---

## 1. Investigation

No Temporal/saga orchestration code exists anywhere in `apps/runtime` (confirmed by grep — zero
hits for `purchase`, `saga`, `PlaceOrder` workflow patterns). This is correct, not a gap: the
reconstruction phase's own `FINAL_RECOVERABLE_SUBSYSTEMS_DECLARATION.md` explicitly marked
`purchase-saga-activities.ts`/`purchase/*` **"permanently excluded"** — the only version that ever
existed was independently documented as defective (`RUNTIME_R2_INVESTIGATION_REPORT.md`,
`ARCHITECTURE_REMEDIATION_PLAN.md`'s SAGA-1 through SAGA-11) — reconstructing it would have
enshrined known bugs as history. There is nothing to build here; building a Temporal saga fresh
would be new architecture, correctly declined.

The real purchase flow that exists today: Checkout creates the order (`CreateOrderFromCheckout`)
→ Payments captures → the event-driven `PaymentCapturedConsumer` calls `MarkOrderPaid` — "the ONE
authoritative payment-completion path," per its own doc comment, already substantially hardened by
an earlier commit (`942fb03`, "A1 payment truth foundation"): it unified the legacy/saga
completion paths and blocked the generic admin `/orders/:orderId/advance` route from asserting
`paid`/`payment_received` directly.

**One real, still-open gap remained**, matching the remediation plan's A1 sub-step 4: the admin
backoffice `POST /orders/:orderId/mark-paid` route accepted `paymentRef` as an arbitrary non-empty
string (`Guard.againstEmpty`, nothing more) — no check that a captured payment with that reference
actually existed. Confirmed directly in `mark-order-paid.use-case.ts` before this milestone.

---

## 2. Implementation plan (as explained before implementing, per explicit user decision)

Add a minimal, read-only Orders → Payments verification port answering exactly one question:
"does a captured payment with this reference exist for this order?" — reusing Payments' existing
read model (the `payment_intents` table, already written by `PrismaPaymentIntentRepository`), gated
only onto the admin-asserted path, with no change to the already-trustworthy event-driven path.

1. `services/orders/src/application/ports.ts`: add `PaymentVerificationPort.hasCapturedPayment(orderId, paymentRef): Promise<boolean>` — same shape/naming convention as `services/returns`' own precedent (`ShippingPort.verifyReturnShipment`).
2. `mark-order-paid.use-case.ts`: add optional `paymentVerification?: PaymentVerificationPort` to `MarkOrderPaidDeps` (same "optional, unwired ⇒ unchanged behavior" convention as the existing `shadow?`). When present, checked **before** `unitOfWork.run(...)` starts (never inside the transaction — avoids the PAY-8-class anti-pattern of a cross-context call inside a DB transaction); on failure, returns the existing `ValidationError` model (same family `Guard.againstEmpty` already used for this exact field) — no new error type.
3. `InMemoryPaymentVerificationAdapter` (always verifies) added to `services/orders/src/infrastructure/in-memory-port-adapters.ts`, matching `InMemoryShippingAdapter.verifyReturnShipment`'s exact "offline stub, no-op passthrough" precedent — default behavior for every existing caller/test is unchanged.
4. `services/orders/src/composition.ts`: `OrdersWiringDeps` gains optional `paymentVerification?`, defaulting to the in-memory adapter, threaded only into the admin-facing `MarkOrderPaid` construction (the event-consumer path is built entirely separately in `apps/runtime/src/composition.ts`'s `buildPaymentCapturedRuntime` and is untouched).
5. `apps/admin/src/composition.ts`: `AdminWiringDeps` gains `paymentVerification?` — flows through to `wireOrders(deps)` automatically (same passthrough mechanism used for `prisma`/`tenantId` in the Runtime G-39 milestone).
6. Real adapter (`PrismaPaymentVerificationAdapter`, `apps/runtime/src/composition.ts`): queries `prisma.paymentIntent.findFirst({ where: { id: paymentRef, orderRef: orderId, tenantId, status: "captured" } })` directly — the exact same schema/table `PrismaPaymentIntentRepository` already writes to, reused, not duplicated. Never imports `@platform/payments` (Orders/Payments stay code-decoupled, same convention as every other cross-context port in this codebase).
7. `apps/runtime/src/api.ts` wires the real adapter into `createAdminHttpApi(...)`.

No architectural decision was required for this scoped-down plan (mirrors three already-established
patterns: the `shadow?`-style optional port, Returns' `verifyX(): Promise<boolean>` cross-context
port shape, and G-39's `deps`-passthrough composition wiring); implementation proceeded without a
further stop, per the user's explicit sign-off on this exact plan.

---

## 3. Files changed

| File                                                               | Change                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `services/orders/src/application/ports.ts`                         | Added `PaymentVerificationPort`                                                                                                |
| `services/orders/src/application/mark-order-paid.use-case.ts`      | Added optional `paymentVerification?` dep; pre-transaction check; rejects with the existing `ValidationError` model on failure |
| `services/orders/src/infrastructure/in-memory-port-adapters.ts`    | Added `InMemoryPaymentVerificationAdapter` (always verifies)                                                                   |
| `services/orders/src/composition.ts`                               | `OrdersWiringDeps` gained `paymentVerification?`; wired into the admin-facing `MarkOrderPaid` instance only                    |
| `services/orders/src/index.ts`                                     | Exported `PaymentVerificationPort` type (needed by `apps/runtime`'s real adapter)                                              |
| `apps/admin/src/composition.ts`                                    | `AdminWiringDeps` gained `paymentVerification?`, passed straight through to `wireOrders(deps)`                                 |
| `apps/runtime/src/composition.ts`                                  | Added `PrismaPaymentVerificationAdapter` (real, Prisma-backed)                                                                 |
| `apps/runtime/src/api.ts`                                          | Wires the real adapter into `createAdminHttpApi(...)`; updated doc comment                                                     |
| `services/orders/src/application/mark-order-paid.use-case.test.ts` | 4 new tests: default-unwired no-op, confirms-and-succeeds, rejects-and-never-touches-order, passes-correct-arguments           |

No changes to `Order`'s domain layer, `PaymentCapturedConsumer` (event-driven path, untouched —
confirmed by its own test suite passing unmodified), any event contract, or any existing public
HTTP contract (`POST /orders/:orderId/mark-paid`'s request/response shape is unchanged; only its
internal verification behavior is stricter when a real adapter is wired).

---

## 4. Quality gates

| Gate                                   | Scope                                 | Result                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck`                            | full monorepo (`turbo run typecheck`) | 76/76 packages, 0 errors                                                                                                                                                                                                                                                                                                                                               |
| `lint`                                 | full monorepo (`turbo run lint`)      | 76/76 packages, 0 errors                                                                                                                                                                                                                                                                                                                                               |
| `test`                                 | full monorepo (`turbo run test`)      | 76/76 packages green; `services/orders` +4 new tests, all passing (37 passed/3 pre-existing DB-gated skipped, was 33/3); `@platform/admin` 32/32 **unchanged** — the existing "marks an order paid through the dedicated mark-paid route (Sprint A1)" e2e test still passes with status 200, confirming the default in-memory adapter preserves prior behavior exactly |
| `arch` (`depcruise packages services`) | full                                  | 0 violations, 1531 modules (unchanged), 6529 dependencies (+3, the new port/type)                                                                                                                                                                                                                                                                                      |
| `governance` (`pnpm governance`)       | —                                     | Still does not exist (same finding as every prior milestone this session). Not a regression; flagged, not silently skipped.                                                                                                                                                                                                                                            |

---

## 5. Architecture impact

None. No new bounded context, no new abstraction beyond one small port interface following an
already-precedented shape (Returns' `ShippingPort.verifyReturnShipment`), no changed public
contracts, no synchronous orchestration introduced (the check is a single read-only query, not a
new call chain — Orders still never calls Payments' application layer, only reads the same
Postgres schema Payments already writes to, exactly as every other Prisma-backed context in this
codebase already does for its own data).

---

## 6. Deviations

None from the plan as explained and approved.

---

## 7. Remaining risks / next steps

- The verification query reads `payment_intents` directly rather than through `@platform/payments`'
  own repository class — a deliberate choice (avoids a package dependency between Orders and
  Payments, matching how every other cross-schema read in this codebase already works) but worth
  noting explicitly: if `payment_intents`' schema/status vocabulary changes, this adapter must be
  updated in lockstep, with no compiler help across the package boundary (only a shared Prisma
  client). Same tradeoff already accepted elsewhere in this codebase for read-only cross-schema
  queries; not a new risk class introduced here.
- Per explicit user instruction: this closes Purchase Saga for the current platform stage — the
  saga itself remains correctly absent (known-defective code stays excluded), and A1's payment-truth
  foundation is now complete with this last gap closed. No further Purchase Saga work should be
  invented without new evidence.

**Next:** Production Readiness Audit (per explicit user instruction — comprehensive, covering the
entire platform, code quality over speed).
