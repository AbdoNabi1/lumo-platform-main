# M2-3 Remediation Report — Licensing Billing Integrity

**Sprint:** Medium Findings Remediation — M2-3 only.
**Baseline:** `HEAD` `8781f07` (same baseline `MEDIUM_VERIFICATION_REPORT.md` re-verified M2-3 against).
**Source finding:** `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`, re-verified unchanged in `MEDIUM_VERIFICATION_REPORT.md`, scoped in `MEDIUM_REMEDIATION_PLAN.md` §1 ("Licensing billing never moves money").

---

## Root Cause

`services/licensing/src/composition.ts`'s `buildController` hardcoded two collaborators with **no
injection seam at all**:

```ts
const payments = new InMemoryPaymentsAdapter();
const financeLedger = new InMemoryFinanceLedgerAdapter();
```

`InMemoryPaymentsAdapter.collect()` (`services/licensing/src/infrastructure/deferred-billing-adapters.ts`)
always returns a fabricated reference (`psp-ref-${counter}`) and never contacts a PSP.
`InMemoryFinanceLedgerAdapter.postSettlement()` is an unconditional no-op. `CollectInvoice`
(`services/licensing/src/application/billing.use-cases.ts:98-126`) calls both, then marks the
invoice `paid` on whatever `collect()` returned — so `collectInvoice` always succeeds and always
reports `status: 200`, regardless of environment, with zero code path to override either
collaborator. Unlike the sibling M2-2 finding (Media object storage), which at least had a
`deps.objectStorage ?? default` seam, M2-3 had none: there was no way, short of editing
`composition.ts` itself, to back Licensing's billing with anything real.

## Investigation

**Current licensing execution path (before this fix):** `apps/admin/src/composition.ts:343`
calls `wireLicensing(deps)`, passing `AdminWiringDeps` straight through. `wireLicensing`
(`services/licensing/src/composition.ts:180`) builds either a Prisma-backed or in-memory repo set,
then calls `buildController(repos, unitOfWork, deps)`, which is the single site (shared by both
branches) that constructed `payments`/`financeLedger` — always the in-memory stubs, deaf to `deps`.

**Runtime composition:** `wireLicensing` is invoked only from `apps/admin`; `apps/runtime/src/api.ts`
(`startApi`) is the actual process boot path that calls `createAdminHttpApi({...})`, which in turn
composes `apps/admin`. `startApi` already carries the established fail-closed convention for two
sibling gaps of the same shape:

- C2-4 (MFA): inline guard in `startApi`, throws outside `APP_ENV=local` if no real
  `mfaProviders` is configured.
- V-1 (PaymentProvider webhook verification): extracted `assertProductionPaymentProviderConfigured`,
  same throw/warn split, called from `startApi`.

**Persistence model:** unaffected by this finding — `payments`/`financeLedger` are outbound ports
to other bounded contexts (Payments PSP, Finance ledger), not Licensing's own persistence. The
existing Prisma-vs-in-memory repo branch in `wireLicensing` is orthogonal and untouched.

**Transaction boundaries:** `CollectInvoice` runs inside `unitOfWork.run(tx)`; `payments.collect()`
is called first, and the invoice is marked `paid` from its return value _before_ the transaction
commits. This ordering is a separate, pre-existing design characteristic (not part of M2-3's
scope, and not touched here) — flagged only as context: even with a real PSP adapter, a crash
between `collect()` succeeding and the transaction commit would need its own reconciliation story.

**Failure modes (before fix):** none. `collect()` never throws, `postSettlement()` never throws —
`collectInvoice` has no failure path at all today, in any environment, which is itself the defect:
a merchant's invoice cannot fail to collect, because nothing real is ever asked to collect it.

**Financial consistency guarantee (before fix):** none. Verified directly: `services/licensing/src/licensing.e2e.test.ts:92-106` ("creates, issues, and collects an invoice through the Payments/Finance stubs") asserts `collected.status === 200` with zero assertion that any money moved, because none can — the stub makes that structurally impossible to test for.

## Runtime Evidence

Reproduced via the new regression test (`services/licensing/src/billing-adapter-injection.test.ts`,
first test, run against **pre-fix** `composition.ts` before the seam was added): `wireLicensing`
accepted no `payments`/`financeLedger` fields at all — passing them was a TypeScript compile error,
confirming zero injection seam existed. `collectInvoice` unconditionally returned `status: 200` for
every invoice regardless of what a real PSP would have done, in every `APP_ENV` value, since
`buildController` never read `deps.payments`/`deps.financeLedger` in the first place.

Post-fix, the same test file's second case (`RejectingPaymentsAdapter`) proves a real PSP failure
now propagates instead of being silently absorbed by the stub, and `composition.test.ts`'s two new
cases prove `apps/runtime/src/api.ts` now refuses to boot outside `APP_ENV=local` while Licensing
billing is still backed by the in-memory stubs.

## Code Changes

Guardrail-phase fix only, per `MEDIUM_REMEDIATION_PLAN.md` §1 — reuses the codebase's own
`deps.X ?? default` + fail-closed-outside-`local` convention (5+ existing precedents in
`services/security/src/composition.ts`, plus the C2-4/V-1 guards in `apps/runtime/src/api.ts`).
Building the real PSP/Finance-ledger adapters is explicitly out of scope (shared long pole with
the still-open C2-2 Critical finding).

1. **`services/licensing/src/composition.ts`** — added optional `payments?: PaymentsPort` and
   `financeLedger?: FinanceLedgerPort` to `LicensingWiringDeps`; `buildController` now reads
   `deps.payments ?? new InMemoryPaymentsAdapter()` / `deps.financeLedger ?? new InMemoryFinanceLedgerAdapter()`
   instead of constructing the stubs unconditionally.
2. **`services/licensing/src/index.ts`** — exported the `PaymentsPort`/`FinanceLedgerPort` types
   (previously internal to `application/ports.ts`) so callers outside the package can type the new
   seam.
3. **`apps/admin/src/composition.ts`** — added matching optional `payments?`/`financeLedger?`
   fields to `AdminWiringDeps`, passed straight through to `wireLicensing(deps)` (already flows via
   the existing `deps` pass-through at line 343 — same mechanism as `mfaProviders`/`paymentVerification`).
4. **`apps/runtime/src/api.ts`** — added `assertProductionLicensingBillingConfigured(appEnv)`,
   extracted the same way as `assertProductionPaymentProviderConfigured` (throws outside `local`,
   warns in `local`); called from `startApi` alongside the existing MFA/PaymentProvider guards.
5. **`apps/runtime/src/composition.test.ts`** — two new unit tests for the extracted guard,
   mirroring the existing PaymentProvider guard tests exactly.
6. **`services/licensing/src/billing-adapter-injection.test.ts`** (new) — three tests: an injected
   adapter is authoritative and observed by `collectInvoice`; a real adapter's failure propagates;
   the in-memory stub still backs `collectInvoice` unchanged when nothing is injected.

No existing use case, controller, event, or public API signature changed. No new bounded context.
No architecture redesign.

## Production Impact

**Before:** in any environment, including production, a subscription's invoice could be marked
`collected`/`paid` with zero money ever taken from the merchant and zero entry posted to the
Finance ledger — silently, since neither stub can fail. **After:** the process now refuses to boot
outside `APP_ENV=local` while Licensing billing is still backed by the in-memory stubs, converting
a silent financial-integrity gap into a loud boot-time failure — the same disposition already
accepted for the MFA (C2-4) and PaymentProvider-webhook (V-1) gaps. The real PSP/Finance-ledger
adapters still do not exist in this codebase; this fix does not build them (out of scope, shared
with C2-2) — it makes their absence impossible to run past outside local development.

## Regression Risk

**Low.** Both new `LicensingWiringDeps`/`AdminWiringDeps` fields are optional and default to
exactly the prior unconditional construction — no existing caller (`apps/admin` composition,
`services/licensing/src/licensing.e2e.test.ts`, any other `wireLicensing` invocation) passes them,
so behavior is byte-for-byte unchanged for every existing test and environment except the new
`APP_ENV != local` boot path, which previously would have booted silently wrong and now fails
loudly — the intended behavior change.

## Verification Results

All four required gates green, run against the full monorepo after the change:

- `pnpm typecheck` — 76/76 tasks passed (one real failure found and fixed mid-sprint: an unused
  `spec()` test helper in the new test file, `TS6133`).
- `pnpm lint` — 76/76 tasks passed, zero warnings.
- `pnpm test` (serialized, `turbo run test --concurrency=1`, per this host's known parallel-vitest
  flakiness) — 76/76 tasks, 135/135 tests in `@platform/runtime` including the 2 new guard tests,
  all `@platform/licensing` tests including the 3 new injection tests, `@platform/admin`'s 41 tests
  unaffected.
- `pnpm arch` — `✔ no dependency violations found (1531 modules, 6674 dependencies cruised)`.

---

**Scope discipline:** this report and its commit touch only the 6 files listed above. No other
Medium finding (M2-1, M2-2, M2-4 through M2-7) was investigated or modified. Per the sprint's stop
condition, this closes M2-3 only.
