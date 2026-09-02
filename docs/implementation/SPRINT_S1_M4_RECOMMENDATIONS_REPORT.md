# Phase S1 — Integration Completion — Milestone 4 (Recommendations Admin Wiring) — Report

**Status:** Complete. Fourth of the 12-item "business admin wiring" batch. Reuses the Coupons
pattern (Milestone 1) unchanged.

**Trigger:** repository audit found the Recommendations bounded context (`@platform/recommendations`,
committed, working `wireRecommendations()` + `RecommendationsController`) had zero admin-app
exposure.

---

## 1. Scope

**In scope:** expose Recommendations' four existing use cases (`create`, `advance`, `generate`,
`regenerate`) through the admin app, replicating the Coupons pattern exactly.

**Explicitly not touched:** `services/recommendations/**`, any other context's wiring,
`apps/runtime`, any public contract/event shape.

---

## 2. Files changed, and why

| File                                                                  | Change                                                                                                                                                                                                                           | Why                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/admin/src/interfaces/recommendations.admin-controller.ts` (new) | `RecommendationsAdminController` — wraps `RecommendationsController`, authorizes `recommendations:create`/`advance`/`generate`/`regenerate`                                                                                      | Same shape as `CouponsAdminController`     |
| `apps/admin/src/http/recommendations-routes.ts` (new)                 | `recommendationsRoutes(admin)` — 4 routes: `POST /recommendation-models`, `POST /recommendation-models/:modelId/transitions`, `POST /recommendation-models/:modelId/generate`, `POST /recommendation-models/:modelId/regenerate` | Same shape as `coupons-routes.ts`          |
| `apps/admin/src/composition.ts`                                       | Added `wireRecommendations` import, `recommendations` field on `WiredAdmin`, wiring call, drain-array entry, controller construction                                                                                             | Same pattern as Coupons                    |
| `apps/admin/src/http/admin-routes.ts`                                 | Added import + spread                                                                                                                                                                                                            | Exposes the new routes                     |
| `apps/admin/package.json`                                             | Added `@platform/recommendations: workspace:*`                                                                                                                                                                                   | Was missing                                |
| `pnpm-lock.yaml`                                                      | Updated via `pnpm install`                                                                                                                                                                                                       | Mechanical                                 |
| `apps/admin/src/admin.e2e.test.ts`                                    | Added one regression test: create → advance(training) → advance(active) → generate (asserts `setCount === 1`) → regenerate                                                                                                       | Closes coverage gap; isolated `it()` block |

No changes to `services/recommendations/**`, any other service, any event contract, or any public
API shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors                                           |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 16/16 (was 15/15; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6520 dependencies — unchanged |

---

## 4. Pattern deviation

**Wiring pattern: none** — same file layout, same `AdminController`/route-file/composition shape as
Coupons/Experimentation/Promotions.

**Test-writing nuance (not a wiring-pattern break):** the first draft of the regression test
assumed a direct `draft → active` transition (as Coupons/Promotions allow in one hop) and failed
with `409` — Recommendations' `ModelStatusValue` transition table requires an intermediate hop
(`draft → training → active`; see `services/recommendations/src/domain/value-objects/model-status.ts`).
Fixed by adding the `training` transition step before `active`. No wiring code was affected; this is
recorded because each context's own transition table must be checked when writing its regression
test, same as Coupons'/Promotions' simpler 2-state-reachable tables.

---

## 5. Remaining blockers / next steps

Next: Milestone 5 — Automation. Security remains deferred to S1.5.
