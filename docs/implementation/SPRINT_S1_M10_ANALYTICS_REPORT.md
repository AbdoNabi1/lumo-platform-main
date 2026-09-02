# Phase S1 — Integration Completion — Milestone 10 (Analytics Admin Wiring) — Report

**Status:** Complete, after an explicit user decision on a mid-milestone structural blocker (see
§4). First milestone in this batch that required touching a file inside the target service
package itself.

**Trigger:** repository audit found the Analytics bounded context (`@platform/analytics`) had zero
admin-app exposure. Unlike every prior milestone, the composition root existed but was **not
reachable from outside the package at all** — see §4.

---

## 1. Scope

**In scope:** expose Analytics' read-only semantic-layer catalog (`listMetrics`, `getMetric`,
`listDimensions`, `getDimension`) through the admin app.

**Touched inside the service, by explicit user authorization (see §4):**
`services/analytics/src/index.ts` — two additive export lines only. No other file under
`services/analytics/**` was touched; `wireAnalytics()`'s and `AnalyticsConsoleController`'s
implementations are byte-for-byte unchanged.

**Explicitly not touched otherwise:** any other context's wiring, `apps/runtime`, any public
contract/event shape, the semantic registry's actual metric/dimension definitions.

---

## 2. Files changed, and why

| File                                                            | Change                                                                                                                                                                                        | Why                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `services/analytics/src/index.ts`                               | Added `export { wireAnalytics, type WiredAnalytics } from "./composition";` and `export { AnalyticsConsoleController } from "./interfaces/analytics-console.controller";`                     | Additive re-export only — see §4 for why this was required and how it was authorized |
| `apps/admin/src/interfaces/analytics.admin-controller.ts` (new) | `AnalyticsAdminController` — wraps `AnalyticsConsoleController`, authorizes `analytics:read` for all 4 read methods                                                                           | Same shape as `CouponsAdminController`, all-read (no mutating use cases exist here)  |
| `apps/admin/src/http/analytics-routes.ts` (new)                 | `analyticsRoutes(admin)` — 4 `GET` routes                                                                                                                                                     | Same shape as `coupons-routes.ts`; see §4 for a route-definition gotcha found here   |
| `apps/admin/src/composition.ts`                                 | Added `wireAnalytics` import, `analytics` field on `WiredAdmin`, `wireAnalytics()` call (no deps — see §4), controller construction. **Not added to the `contexts` drain array** (see §4)     | Same pattern as Coupons, adapted for Analytics' no-deps/no-outbox shape              |
| `apps/admin/src/http/admin-routes.ts`                           | Added import + spread                                                                                                                                                                         | Exposes the new routes                                                               |
| `apps/admin/package.json`                                       | Added `@platform/analytics: workspace:*`                                                                                                                                                      | Was missing                                                                          |
| `pnpm-lock.yaml`                                                | Updated via `pnpm install`                                                                                                                                                                    | Mechanical                                                                           |
| `apps/admin/src/admin.e2e.test.ts`                              | Added one regression test: listMetrics/getMetric/listDimensions/getDimension against the pre-registered Finance semantics (`finance.revenue`/`finance.period`), plus a 404-on-unknown-id case | Closes coverage gap; isolated `it()` block                                           |

---

## 3. Quality gates

| Gate        | Scope         | Result                                                                                                                                                     |
| ----------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors (two fixes required mid-milestone, see §4)                                                                                                 |
| `lint`      | full monorepo | 76/76, 0 errors                                                                                                                                            |
| `test`      | full monorepo | 76/76 green, `@platform/analytics` 21/21 (unchanged, re-verified after the export addition), `@platform/admin` 22/22 (was 21/21; +1 new)                   |
| `arch`      | full          | 0 violations, 1531 modules (unchanged), 6522 dependencies cruised (+2, the new admin→analytics package edge and the two new export edges inside analytics) |

---

## 4. Pattern deviations (two, both resolved)

**1. Structural blocker — stopped and asked before proceeding.** `wireAnalytics()` and
`AnalyticsConsoleController` existed in `services/analytics/src/composition.ts` /
`interfaces/analytics-console.controller.ts` but were **never re-exported from
`services/analytics/src/index.ts`**, and `package.json`'s `exports` field maps only `"."` to
`src/index.ts` (no subpath escape hatch). A repo-wide grep confirmed neither symbol was imported
anywhere outside the analytics package itself — genuinely unreachable, unlike every other
milestone's target where the gap was purely on the `apps/admin` side. This breaks the "zero
changes to `services/X/**`" invariant every prior milestone (M1–M9) held. Per your standing
instruction to stop on anything invalidating the established pattern, I paused and asked; you
authorized a minimal, purely-additive 2-line export fix (no logic or behavior change to
`wireAnalytics`/`AnalyticsConsoleController` themselves), which is what's in the diff above.
Re-ran `@platform/analytics`'s own typecheck/lint/test (21/21) after the change to confirm nothing
in the analytics package itself broke.

**2. `RouteDefinition.schema` is a required field, not optional — a real bug caught by the test
suite, not just a style choice.** `@platform/http`'s `RouteDefinition` type declares
`readonly schema: { body?; params?; querystring? }` — the outer `schema` key itself has no `?`,
only its three members do. Omitting `schema` entirely (as I initially wrote for the two
no-input `GET` routes, `listMetrics`/`listDimensions`) type-checked at first glance but crashed at
runtime (`Cannot read properties of undefined (reading 'body')` in `packages/http/src/server.ts`'s
OpenAPI-schema builder, which unconditionally reads `route.schema.body`). Fixed by adding an
explicit empty `schema: {}` to both routes, matching the exact convention already used for this
case in `packages/http/src/server.test.ts:149`. Caught immediately by the full `@platform/admin`
test suite (`admin-http.e2e.test.ts` failed with a `TypeError`, not a silent gap) — flagging here
since every future no-input `GET` route (a shape none of Milestones 1–9 needed) must remember
`schema: {}` explicitly.

**Composition-shape adaptation (not a defect, just noted for completeness):** `wireAnalytics()`
takes no arguments (no serializer/idGenerator/clock) and its `WiredAnalytics` has no
`drainOutbox`/`deliveredEventTypes` — it's a pure read-only facade, the same shape
`wirePlatformConsole()` already has in this file. Analytics is wired and its controller
constructed identically to every other context, but — like `platformConsole` — is intentionally
**not** added to the `contexts: readonly DrainableContext[]` drain array, since it has nothing to
drain.

---

## 5. Remaining blockers / next steps

Next: Milestone 11 — Search. Milestone 12 — Feature Registry. Security remains deferred to S1.5.
