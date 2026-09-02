# Phase S1 — Integration Completion — Milestone 1 (Coupons Admin Wiring) — Report

**Status:** Complete. First of the 12-item "business admin wiring" batch scoped in the S1 audit
(`AUDIT` message, this session). Validates the replication pattern end-to-end on the smallest
candidate before applying it to the remaining 11. Security is explicitly out of this batch — see
"S1.5" below.

**Trigger:** repository audit found the Coupons bounded context (`@platform/coupons`, committed,
working `wireCoupons()` + `CouponsController`) had zero admin-app exposure — no admin controller,
no `composition.ts` entry, no HTTP route — despite 24 other contexts already following this exact
pattern. This is a pure additive wiring gap, not a design or contract change.

---

## 1. Scope

**In scope:** expose Coupons' three existing use cases (`create`, `advance`, `redeem`) through the
admin app, replicating the established `*AdminController` → `composition.ts` → `*-routes.ts` →
`admin-routes.ts` pattern used by all 24 already-wired contexts (e.g. `ContentAdminController`).

**Explicitly not touched:** `services/coupons/**` (the context itself — already correct, zero
changes needed), any other context's wiring, `apps/runtime`, any public contract/event shape,
`purchase-saga-activities.ts`/`purchase-saga-routes.ts` (excluded per standing rule).

---

## 2. Files changed, and why

| File                                                          | Change                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/src/interfaces/coupons.admin-controller.ts` (new) | `CouponsAdminController` — thin wrapper over `CouponsController`, authorizes `coupons:create`/`coupons:advance`/`coupons:redeem` via `AdminGuard` before delegating                                    | Same shape as every existing `*AdminController` (e.g. `ContentAdminController`) — pure delegation, no business logic                                                                                                                                                                                           |
| `apps/admin/src/http/coupons-routes.ts` (new)                 | `couponsRoutes(admin)` — 3 routes: `POST /coupons`, `POST /coupons/:couponId/transitions`, `POST /coupons/redeem`                                                                                      | Same shape as `content-routes.ts`; zod validates the boundary only                                                                                                                                                                                                                                             |
| `apps/admin/src/composition.ts`                               | Added `wireCoupons` import, `coupons: CouponsAdminController` field on `WiredAdmin`, `wireCoupons(deps)` call, added to the `contexts` drain array, constructed `CouponsAdminController` in the return | Wires Coupons into the admin composition root exactly like the other 24                                                                                                                                                                                                                                        |
| `apps/admin/src/http/admin-routes.ts`                         | Added `couponsRoutes` import + spread into the aggregated route list                                                                                                                                   | Exposes the new routes on the admin HTTP surface                                                                                                                                                                                                                                                               |
| `apps/admin/package.json`                                     | Added `@platform/coupons: workspace:*` dependency                                                                                                                                                      | Was missing — Coupons was never a dependency of the admin app before this                                                                                                                                                                                                                                      |
| `pnpm-lock.yaml`                                              | Updated via `pnpm install` for the new workspace edge                                                                                                                                                  | Mechanical                                                                                                                                                                                                                                                                                                     |
| `apps/admin/src/admin.e2e.test.ts`                            | Added one regression test: create → redeem (idempotent, `duplicate: false`) → advance to `disabled`                                                                                                    | Closes the coverage gap the audit found; follows the same per-screen assertion style already in this file. Kept as an isolated `it()` block rather than folded into the existing "drives each frozen Phase-1 screen" test, so the pre-existing exact event-count assertion (`published === 6`) stays untouched |

No changes to `services/coupons/**`, any other service, any event contract, or any public API
shape outside `apps/admin`.

---

## 3. Quality gates

| Gate                                   | Scope                                 | Result                                                                                                                                                           |
| -------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck`                            | full monorepo (`turbo run typecheck`) | 76/76 packages, 0 errors                                                                                                                                         |
| `lint`                                 | full monorepo (`turbo run lint`)      | 76/76 packages, 0 errors                                                                                                                                         |
| `test`                                 | full monorepo (`turbo run test`)      | 76/76 packages green, incl. `@platform/admin` 13/13 (was 12/12; +1 new)                                                                                          |
| `arch` (`depcruise packages services`) | full                                  | 0 violations, 1531 modules, 6520 dependencies — identical module count to the pre-milestone baseline (`bc6fba8`'s revert report), confirming no structural drift |

---

## 4. Architecture impact

None. This is a pure composition-root wiring addition following an existing, established pattern —
no new abstractions, no changed contracts, no cross-context coupling (Coupons' admin controller
depends only on Coupons' own `CouponsController`, same as every sibling admin controller).

---

## 5. Remaining blockers / next steps

- 11 more contexts remain in the same S1 "business admin wiring" batch, ranked smallest/lowest-risk
  first: `experimentation`, `promotions`, `recommendations` (36 lines) → `automation`,
  `feature-flags`, `reporting` (36–42) → `reviews`, `loyalty` (48–52) → `analytics`, `search`
  (53–59) → `feature-registry` (112, largest of this batch).
- **Security is explicitly deferred to its own milestone (S1.5)** per user decision — 536-line
  controller crossing Identity/Authentication/Authorization/Secrets/Incidents/Audit; scope limited
  to controller registration, composition wiring, runtime registration, HTTP exposure,
  permission/RBAC validation, and existing audit integration only — no new features, no redesigns,
  no public-contract changes.
- The unrelated, already-known gap from the prior session (`INTEGRATION_SPRINT_APP_WIRING_STATUS.md`
  — the reverted cross-context composition reshaping for Checkout/Payments/Orders/etc.) remains
  untouched and out of scope for this batch; not to be conflated with it.
