# Finance M2 — Production Persistence Wiring — Report

**Status:** Complete. First milestone of the forward-development phase (post-reconstruction).

**Scope note (read before comparing to any older memory or document):** in the archived
reconstruction session, "Finance M2" referred to an unevidenced dirty-tree file-layout reorg
(`domain/services/*.ts` → top-level `services/*.ts`, consolidated read-models) with zero primary
source anywhere in this repo (`FINAL_RECOVERABLE_SUBSYSTEMS_DECLARATION.md`) — that work was
explicitly declined and remains untouched. Per this session's explicit redirection ("this is no
longer history reconstruction, this is forward platform development"), "Finance M2" is redefined
here as the second forward-looking Finance milestone (M1 being the original T1-Core build), scoped
from direct investigation of the current canonical code, not from the old dirty-tree tag.

---

## 1. Investigation

Direct inspection of `services/finance/src/` found a real, concrete, evidence-backed gap: a
complete, correct, already-written Prisma persistence layer
(`infrastructure/prisma-finance-repositories.ts`, 10 repository classes: Journal, Account,
CostCenter, ExpenseCategory, Expense, Budget, ExchangeRate, FiscalPeriod, TaxProfile,
CogsSnapshot — ADR-0003 same-transaction-outbox compliant, tenant-scoped, optimistic-locked)
existed but was **never wired into `wireFinance()`** — the composition root only ever built the
in-memory branch. Confirmed by direct code read, not assumption: `FinanceWiringDeps` had no
`prisma`/`tenantId` fields, and no `Prisma*Repository` import appeared anywhere in
`composition.ts` before this milestone.

This is the same "written but orphaned" shape independently confirmed for 3 other contexts
(`services/feature-registry`, `services/security`, `services/customer-360`), each of which already
uses an identical `prisma?: Database` / `tenantId?: string` optional-presence branch in their own
`wireX()` — confirmed by direct grep (`services/feature-registry/src/composition.ts` was read in
full and used as the template). Finance was the 4th context with this exact gap and the largest
(10 repositories vs. feature-registry's 2).

**Explicitly separate, deliberately not touched by this milestone** (real, also-evidenced gaps
found during investigation, left for a future milestone since they are a different unit of work):
`services/finance/src/interfaces/finance-consumers.ts` defines 6 real `EventHandler` classes
(order-paid, payment-captured, refund, return-accepted, inventory-adjustment, marketing-spend —
all fully implemented, not stubs) that are registered nowhere — not in `wireFinance()`, not
exported from the package's public `index.ts`, not referenced anywhere under `apps/runtime`. Wiring
these into the production Kafka runtime is a distinct concern (event-driven runtime registration,
touching `apps/runtime`, not `services/finance`'s own composition root) and was left out of this
milestone's scope to keep the change isolated and additive.

---

## 2. Implementation plan (as explained before implementing)

Add `prisma?: Database` / `tenantId?: string` to `FinanceWiringDeps`, mirroring
`wireFeatureRegistry`'s exact convention (throw if `prisma` is present without `tenantId`, per
ADR-0008). Branch `wireFinance()`: Prisma branch builds all 10 `Prisma*Repository` instances +
`PrismaOutboxStore` + `PrismaUnitOfWork`, returns `drainOutbox: async () => 0` /
`deliveredEventTypes: []` (Prisma slice is drained by CDC, not this function — same convention as
`wireFeatureRegistry`/`wireCustomer360`); in-memory branch is untouched byte-for-byte in behavior.
Extracted a `buildController()` helper (shared by both branches) to avoid duplicating the 18
use-case construction block, matching `wireFeatureRegistry`'s own `buildController` extraction
pattern. `security`/`forecast`/`readModels` stay in-memory in both branches — no Prisma counterpart
exists for these (Security/AiForecast are stub/policy concerns, not ledger data; the read-model
store's only durable backing is ClickHouse, which is separately gated and untouched here).

No architectural decision was required (this reuses an existing, 3-times-precedented composition
pattern with already-written repository classes), so implementation proceeded without a stop.

---

## 3. Files changed

| File                                  | Change                                                                                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/finance/src/composition.ts` | Added `prisma?`/`tenantId?` to `FinanceWiringDeps`; extracted `buildController()`; added the Prisma branch (10 repos + outbox + unit-of-work); in-memory branch behaviorally unchanged (only refactored to share `buildController`) |

No changes to `services/finance/src/infrastructure/prisma-finance-repositories.ts` (already
correct, zero changes needed), any other file in `services/finance`, any other service, any event
contract, or any public API shape — `FinanceWiringDeps` gained two **optional** fields, so every
existing caller (`apps/admin`, `services/finance`'s own tests) is unaffected and continues to get
the in-memory branch exactly as before.

---

## 4. Quality gates

| Gate                                   | Scope                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck`                            | full monorepo (`turbo run typecheck`) | 76/76 packages, 0 errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `lint`                                 | full monorepo (`turbo run lint`)      | 76/76 packages, 0 errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `test`                                 | full monorepo (`turbo run test`)      | 76/76 packages green; `services/finance` 22/22 unchanged (in-memory branch behavior identical — confirmed byte-for-byte pass, no test modified); `@platform/admin` 32/32 unchanged (admin always uses the in-memory branch, never passes `prisma`)                                                                                                                                                                                                                                                                                                  |
| `arch` (`depcruise packages services`) | full                                  | 0 violations, 1531 modules (unchanged — no new files), 6526 dependencies (+4, the new Prisma-repo/`PrismaOutboxStore`/`PrismaUnitOfWork`/`Database` imports)                                                                                                                                                                                                                                                                                                                                                                                        |
| `governance` (`pnpm governance`)       | —                                     | **Does not exist.** `package.json` has no `governance` script, and `scripts/governance/` contains no runnable source (confirmed by direct inspection — only `.turbo`/`node_modules` cache dirs). This matches an already-documented, pre-existing finding from the reconstruction phase (`morbeh-platform-recovery-state` memory: "the governance suite itself has no primary source for its own creation"). Not a regression introduced by this milestone — flagged here rather than silently skipped, since the workflow calls for it explicitly. |

**No dedicated unit test was added for the new Prisma branch itself** — consistent with the
established precedent: none of the 3 other contexts with this exact pattern
(`feature-registry`/`security`/`customer-360`) have a unit test for their own Prisma branch either
(confirmed by grep — the branch is structurally validated by `tsc` against real Prisma-generated
types, not exercised against a live database in a unit test). Adding one here would be inventing a
new testing convention this milestone wasn't asked to establish.

---

## 5. Architecture impact

None. No new abstractions, no changed public contracts, no new bounded context. Reuses an
already-established, 3-times-precedented composition pattern and already-written repository
classes verbatim.

---

## 6. Deviations

None from the plan as explained. One pre-existing inaccuracy noted in passing (not corrected, out
of scope): `services/customer-360/src/composition.ts`'s own doc-comment claims its `prisma?`
pattern "mirrors `wireIdentity`/`wireFinance`'s own prisma-presence branch exactly" — `wireIdentity`
has no such branch at all (confirmed by direct grep, zero matches), and `wireFinance` did not
either until this milestone. Left as-is; not this milestone's file to correct, and now accidentally
true for Finance going forward.

---

## 7. Remaining risks / next steps

- Finance's 6 event consumers (`finance-consumers.ts`) remain unwired into `apps/runtime` — real,
  evidenced gap, left for its own milestone (likely to land naturally when the Purchase Saga
  milestone touches cross-context event wiring).
- No chart-of-accounts seed exists for the new Prisma branch — a production deploy would need one
  before `wireFinance({ prisma, tenantId })` could post real journals against real accounts (same
  `OF-6`-class gap noted in the architecture remediation plan, not addressed here — this milestone
  wired persistence, not data seeding).
- `pnpm governance` is not wired into the toolchain at all — flagged for whoever owns the CI/quality
  gate story, not fixed here (out of this milestone's scope).

**Next:** Analytics V2.
