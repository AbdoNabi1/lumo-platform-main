# Runtime — G-39 Production Persistence Threading — Report

**Status:** Complete. Scoped to the concretely-documented G-39 gap per explicit user redirection,
after investigation found no evidence for a "Runtime Module Framework" (no existing module system
of any kind anywhere in `apps/runtime`, and building one from scratch would be new architecture,
not additive wiring — see §1). No new runtime framework, registration abstraction, or module
system was introduced, as instructed.

---

## 1. Investigation

`apps/runtime/src/` has four deliberately simple, independently hand-wired entrypoints (`api.ts`,
`worker.ts`, `scheduler.ts`, `index.ts`), each calling `buildRuntimeCore(config)` directly — no
`module.ts`/`platform.ts`/`ModuleRegistry`/`modules/*` exists anywhere (confirmed by repo-wide
grep, zero hits). `worker.ts`'s and `scheduler.ts`'s own doc comments describe this as an
intentional style ("a deliberately boring interval-based job runner"; "registering a worker whose
activities cannot exist would be a fake adapter, which this codebase does not do"), not an
oversight. There is no orphaned framework code to wire — building one would mean designing new
runtime architecture from scratch, which the user explicitly declined.

`api.ts`'s own doc comment named a real, concrete, already-self-disclosed gap instead: **"KNOWN GAP
(G-39): `createAdminHttpApi` still composes the Phase-1 IN-MEMORY context slices — the per-context
production wiring (Prisma-backed `wireOrders` etc.) is the next composition seam."** Direct
investigation confirmed this precisely: `createAdminHttpApi` (`apps/admin/src/http/server.ts`)
calls `wireAdmin(deps)`, and `AdminWiringDeps` (`apps/admin/src/composition.ts`) had no
`prisma`/`tenantId` fields at all — so every context wired through the production API, including
the four that (as of Finance M2, this session) have their own Prisma composition branch (Finance,
Feature Registry, Security, Customer 360), ran in-memory regardless.

---

## 2. Implementation plan (as explained before implementing)

Thread `prisma`/`tenantId` from `apps/runtime`'s already-built `RuntimeCore` (`runtime.prisma`,
already a real `Database` handle; `runtime.config.TENANT_DEFAULT_ID`, already configured) through
`apps/admin`'s existing composition root, reusing every composition seam that already exists —
no new one:

1. Add optional `prisma?: Database` / `tenantId?: string` to `AdminWiringDeps`
   (`apps/admin/src/composition.ts`).
2. **No other change needed inside `wireAdmin()`** — every one of the 39 `wireX(deps)` calls
   already receives `deps` (or `{...deps, ...}`) directly, so the four contexts with their own
   `prisma?`-presence branch (`wireFinance`, `wireFeatureRegistry`, `wireSecurity`,
   `wireCustomer360`) pick up the new fields automatically, structurally, with zero code change to
   those call sites. The other 35 contexts have no Prisma branch of their own and are unaffected
   either way.
3. `apps/runtime/src/api.ts` passes `prisma: runtime.prisma, tenantId: runtime.config.TENANT_DEFAULT_ID`
   into `createAdminHttpApi(...)`.

No architectural decision was required for this scoped-down version (reuses four already-existing
composition branches verbatim); implementation proceeded without a further stop.

---

## 3. Files changed

| File                            | Change                                                                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/src/composition.ts` | Added `prisma?: Database` / `tenantId?: string` to `AdminWiringDeps` (2 new optional fields + 1 new type-only import)                                             |
| `apps/admin/package.json`       | Added `@platform/db: workspace:*` dependency (was missing — admin never referenced `Database` before)                                                             |
| `apps/runtime/src/api.ts`       | `startApi` now passes `prisma`/`tenantId` into `createAdminHttpApi`; updated the function's doc comment from "KNOWN GAP (G-39)" to describe the now-partial close |
| `pnpm-lock.yaml`                | Updated via `pnpm install` for the new workspace edge                                                                                                             |

No changes to any of the 39 individual context packages, any `wireX()` composition root body, any
event contract, or any public HTTP contract. `AdminWiringDeps` gained two **optional** fields, so
every existing caller (including every admin test, which never passes `prisma`) is unaffected and
continues to get the in-memory branch exactly as before.

---

## 4. Quality gates

| Gate                                   | Scope                                 | Result                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck`                            | full monorepo (`turbo run typecheck`) | 76/76 packages, 0 errors                                                                                                                                                                                                     |
| `lint`                                 | full monorepo (`turbo run lint`)      | 76/76 packages, 0 errors                                                                                                                                                                                                     |
| `test`                                 | full monorepo (`turbo run test`)      | 76/76 packages green; `@platform/admin` 32/32 unchanged (no existing test passes `prisma`, so the in-memory branch — and every existing assertion — is exercised exactly as before)                                          |
| `arch` (`depcruise packages services`) | full                                  | 0 violations, 1531 modules (unchanged — `apps/*` is outside this gate's scan scope), 6526 dependencies (unchanged from Finance M2 — the new `@platform/db` edge is inside `apps/admin`, also outside this gate's scan scope) |
| `governance` (`pnpm governance`)       | —                                     | Still does not exist (same finding as Finance M2 — no script, no runnable source). Not a regression; flagged, not silently skipped.                                                                                          |

No new test was added: this change has no new behavior a unit test can exercise without a live
Postgres connection (the four contexts' own Prisma branches are already covered, or not, by their
own package's existing test suite — unchanged by this milestone). Same precedent as Finance M2 (no
dedicated Prisma-branch unit test exists for any of the four contexts).

---

## 5. Architecture impact

None. No new abstractions, no new module system, no changed public contracts. Reuses four
already-existing composition branches and the already-built `RuntimeCore.prisma`/`config.TENANT_DEFAULT_ID`
verbatim.

---

## 6. Deviations

None from the plan as explained.

---

## 7. Remaining risks / next steps

- The other 35 wired contexts (everything except Finance/Feature Registry/Security/Customer 360)
  still run in-memory in production via `apps/runtime`'s API — they have no Prisma composition
  branch of their own to thread through yet. Building those branches for each of the 35 remaining
  contexts is real, substantial, per-context work (the same shape as Finance M2, repeated 35 times)
  — explicitly out of this milestone's minimal scope; not invented here.
- `worker.ts`/`scheduler.ts` were not touched — G-39's own text names `createAdminHttpApi` (the API
  entrypoint) specifically; the worker/scheduler entrypoints already build their own bespoke
  Prisma-backed slices directly (e.g. `buildPaymentCapturedRuntime`), not through `wireAdmin()`, so
  G-39 does not apply to them.
- Per explicit user instruction: since no further evidence-backed Runtime work remains at this
  scope, the Runtime milestone is marked **complete for this stage** — no further Runtime-framework
  work should be invented without new evidence.

**Next:** Purchase Saga.
