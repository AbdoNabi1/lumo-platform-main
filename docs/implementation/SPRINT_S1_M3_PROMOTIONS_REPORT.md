# Phase S1 — Integration Completion — Milestone 3 (Promotions Admin Wiring) — Report

**Status:** Complete. Third of the 12-item "business admin wiring" batch. Reuses the Coupons
pattern (Milestone 1) unchanged.

**Trigger:** repository audit found the Promotions bounded context (`@platform/promotions`,
committed, working `wirePromotions()` + `PromotionsController`) had zero admin-app exposure.

---

## 1. Scope

**In scope:** expose Promotions' four existing use cases (`create`, `advance`, `evaluate`,
`recordUsage`) through the admin app, replicating the Coupons pattern exactly.

**Explicitly not touched:** `services/promotions/**`, any other context's wiring, `apps/runtime`,
any public contract/event shape.

---

## 2. Files changed, and why

| File                                                             | Change                                                                                                                                                                           | Why                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/admin/src/interfaces/promotions.admin-controller.ts` (new) | `PromotionsAdminController` — wraps `PromotionsController`, authorizes `promotions:create`/`advance`/`evaluate`/`record_usage`                                                   | Same shape as `CouponsAdminController`     |
| `apps/admin/src/http/promotions-routes.ts` (new)                 | `promotionsRoutes(admin)` — 4 routes: `POST /promotions`, `POST /promotions/:promotionId/transitions`, `POST /promotions/evaluate`, `POST /promotions/:promotionId/record-usage` | Same shape as `coupons-routes.ts`          |
| `apps/admin/src/composition.ts`                                  | Added `wirePromotions` import, `promotions` field on `WiredAdmin`, wiring call, drain-array entry, controller construction                                                       | Same pattern as Coupons                    |
| `apps/admin/src/http/admin-routes.ts`                            | Added import + spread                                                                                                                                                            | Exposes the new routes                     |
| `apps/admin/package.json`                                        | Added `@platform/promotions: workspace:*`                                                                                                                                        | Was missing                                |
| `pnpm-lock.yaml`                                                 | Updated via `pnpm install`                                                                                                                                                       | Mechanical                                 |
| `apps/admin/src/admin.e2e.test.ts`                               | Added one regression test: create → advance(active) → evaluate (asserts one determination against a matching cart) → recordUsage                                                 | Closes coverage gap; isolated `it()` block |

No changes to `services/promotions/**`, any other service, any event contract, or any public API
shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors                                           |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 15/15 (was 14/14; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6520 dependencies — unchanged |

---

## 4. Pattern deviation

**None.** The Coupons pattern (Milestone 1) was reused unchanged.

---

## 5. Remaining blockers / next steps

Next: Milestone 4 — Recommendations. Security remains deferred to S1.5.
