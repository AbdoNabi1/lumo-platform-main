# Phase S1 — Integration Completion — Milestone 9 (Loyalty Admin Wiring) — Report

**Status:** Complete. Ninth of the 12-item "business admin wiring" batch. Reuses the Coupons
pattern (Milestone 1) unchanged.

**Trigger:** repository audit found the Loyalty bounded context (`@platform/loyalty`, committed,
working `wireLoyalty()` + `LoyaltyController`) had zero admin-app exposure.

---

## 1. Scope

**In scope:** expose Loyalty's seven existing use cases (`open`, `advance`, `earn`, `spend`,
`cashback`, `redeem`, `referral`) through the admin app, replicating the Coupons pattern exactly.

**Explicitly not touched:** `services/loyalty/**`, any other context's wiring, `apps/runtime`, any
public contract/event shape.

---

## 2. Files changed, and why

| File                                                          | Change                                                                                                                                              | Why                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/admin/src/interfaces/loyalty.admin-controller.ts` (new) | `LoyaltyAdminController` — wraps `LoyaltyController`, authorizes `loyalty:open`/`advance`/`earn`/`spend`/`cashback`/`redeem`/`referral`             | Same shape as `CouponsAdminController`     |
| `apps/admin/src/http/loyalty-routes.ts` (new)                 | `loyaltyRoutes(admin)` — 7 routes covering open/transition/earn/spend/cashback/redeem/referral                                                      | Same shape as `coupons-routes.ts`          |
| `apps/admin/src/composition.ts`                               | Added `wireLoyalty` import, `loyalty` field on `WiredAdmin`, wiring call, drain-array entry, controller construction                                | Same pattern as Coupons                    |
| `apps/admin/src/http/admin-routes.ts`                         | Added import + spread                                                                                                                               | Exposes the new routes                     |
| `apps/admin/package.json`                                     | Added `@platform/loyalty: workspace:*`                                                                                                              | Was missing                                |
| `pnpm-lock.yaml`                                              | Updated via `pnpm install`                                                                                                                          | Mechanical                                 |
| `apps/admin/src/admin.e2e.test.ts`                            | Added one regression test: open → earn(1000) → spend(200) → cashback(50) → redeem → referral → advance(suspended), asserting running point balances | Closes coverage gap; isolated `it()` block |

No changes to `services/loyalty/**`, any other service, any event contract, or any public API
shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors                                           |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 21/21 (was 20/20; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6520 dependencies — unchanged |

---

## 4. Pattern deviation

**None.** The Coupons pattern was reused unchanged. Verified `LoyaltyAccount.earn`/`spend`/
`cashback`/`redeemReward`/`completeReferral` all `requireActive()` and new accounts open `active`
by default, so the test's ledger operations run before the final `advance(suspended)` call — no
ordering fix needed, first attempt passed.

---

## 5. Remaining blockers / next steps

Next: Milestone 10 — Analytics. Security remains deferred to S1.5.
