# Phase S1 — Integration Completion — Milestone 2 (Experimentation Admin Wiring) — Report

**Status:** Complete. Second of the 12-item "business admin wiring" batch. Reuses the Coupons
pattern (Milestone 1) unchanged.

**Trigger:** repository audit found the Experimentation bounded context (`@platform/experimentation`,
committed, working `wireExperimentation()` + `ExperimentationController`) had zero admin-app
exposure.

---

## 1. Scope

**In scope:** expose Experimentation's four existing use cases (`create`, `advance`, `recordResult`,
`declareWinner`) through the admin app, replicating the Coupons pattern exactly.

**Explicitly not touched:** `services/experimentation/**`, any other context's wiring,
`apps/runtime`, any public contract/event shape.

---

## 2. Files changed, and why

| File                                                                  | Change                                                                                                                                                                                             | Why                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/admin/src/interfaces/experimentation.admin-controller.ts` (new) | `ExperimentationAdminController` — wraps `ExperimentationController`, authorizes `experiments:create`/`advance`/`record_result`/`declare_winner`                                                   | Same shape as `CouponsAdminController`                                     |
| `apps/admin/src/http/experimentation-routes.ts` (new)                 | `experimentationRoutes(admin)` — 4 routes: `POST /experiments`, `POST /experiments/:experimentId/transitions`, `POST /experiments/:experimentId/results`, `POST /experiments/:experimentId/winner` | Same shape as `coupons-routes.ts`                                          |
| `apps/admin/src/composition.ts`                                       | Added `wireExperimentation` import, `experimentation` field on `WiredAdmin`, wiring call, drain-array entry, controller construction                                                               | Same pattern as Coupons                                                    |
| `apps/admin/src/http/admin-routes.ts`                                 | Added import + spread                                                                                                                                                                              | Exposes the new routes                                                     |
| `apps/admin/package.json`                                             | Added `@platform/experimentation: workspace:*`                                                                                                                                                     | Was missing                                                                |
| `pnpm-lock.yaml`                                                      | Updated via `pnpm install`                                                                                                                                                                         | Mechanical                                                                 |
| `apps/admin/src/admin.e2e.test.ts`                                    | Added one regression test: create → advance(running) → recordResult → advance(completed) → declareWinner                                                                                           | Closes coverage gap; isolated `it()` block, no existing assertions touched |

No changes to `services/experimentation/**`, any other service, any event contract, or any public
API shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors                                           |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 14/14 (was 13/13; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6520 dependencies — unchanged |

---

## 4. Pattern deviation

**None.** The Coupons pattern (Milestone 1) was reused unchanged: same file layout, same
`AdminController` shape, same route-file shape, same composition/package.json/test wiring steps.

---

## 5. Remaining blockers / next steps

Next: Milestone 3 — Promotions. Security remains deferred to S1.5 per standing decision.
