# Phase S1 — Integration Completion — Milestone 8 (Reviews Admin Wiring) — Report

**Status:** Complete. Eighth of the 12-item "business admin wiring" batch. Reuses the Coupons
pattern (Milestone 1) unchanged.

**Trigger:** repository audit found the Reviews bounded context (`@platform/reviews`, committed,
working `wireReviews()` + `ReviewsController`) had zero admin-app exposure.

---

## 1. Scope

**In scope:** expose Reviews' six existing use cases (`create`, `advance`, `vote`, `report`,
`respond`, `moderate`) through the admin app, replicating the Coupons pattern exactly.

**Explicitly not touched:** `services/reviews/**`, any other context's wiring, `apps/runtime`, any
public contract/event shape.

---

## 2. Files changed, and why

| File                                                          | Change                                                                                                                           | Why                                        |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/admin/src/interfaces/reviews.admin-controller.ts` (new) | `ReviewsAdminController` — wraps `ReviewsController`, authorizes `reviews:create`/`advance`/`vote`/`report`/`respond`/`moderate` | Same shape as `CouponsAdminController`     |
| `apps/admin/src/http/reviews-routes.ts` (new)                 | `reviewsRoutes(admin)` — 6 routes covering create/transition/vote/report/respond/moderate                                        | Same shape as `coupons-routes.ts`          |
| `apps/admin/src/composition.ts`                               | Added `wireReviews` import, `reviews` field on `WiredAdmin`, wiring call, drain-array entry, controller construction             | Same pattern as Coupons                    |
| `apps/admin/src/http/admin-routes.ts`                         | Added import + spread                                                                                                            | Exposes the new routes                     |
| `apps/admin/package.json`                                     | Added `@platform/reviews: workspace:*`                                                                                           | Was missing                                |
| `pnpm-lock.yaml`                                              | Updated via `pnpm install`                                                                                                       | Mechanical                                 |
| `apps/admin/src/admin.e2e.test.ts`                            | Added one regression test: create → vote → report → respond → advance(published) → moderate(flag)                                | Closes coverage gap; isolated `it()` block |

No changes to `services/reviews/**`, any other service, any event contract, or any public API
shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors                                           |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 20/20 (was 19/19; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6520 dependencies — unchanged |

---

## 4. Pattern deviation

**None.** The Coupons pattern was reused unchanged; this milestone's test needed no domain-order
fixes on first attempt (verified `report()` only auto-flags when already `published` and
`moderate("flag")` maps to `published → flagged`, so the test sequences `advance(published)`
before `moderate`).

---

## 5. Remaining blockers / next steps

Next: Milestone 9 — Loyalty. Security remains deferred to S1.5.
