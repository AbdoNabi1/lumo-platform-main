# Phase S1 — Integration Completion — Milestone 11 (Search Admin Wiring) — Report

**Status:** Complete. Eleventh of the 12-item "business admin wiring" batch. Reuses the Coupons
pattern (Milestone 1) unchanged.

**Trigger:** repository audit found the Search bounded context (`@platform/search`, committed,
working `wireSearch()` + `SearchController`) had zero admin-app exposure.

---

## 1. Scope

**In scope:** expose Search's eight existing use cases (`create`, `advance`, `upsertDocument`,
`deleteDocument`, `addSynonym`, `removeSynonym`, `addSuggestion`, `logQuery`) through the admin
app, replicating the Coupons pattern exactly.

**Explicitly not touched:** `services/search/**`, any other context's wiring, `apps/runtime`, any
public contract/event shape.

---

## 2. Files changed, and why

| File                                                         | Change                                                                                                                                                                                                          | Why                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/admin/src/interfaces/search.admin-controller.ts` (new) | `SearchAdminController` — wraps `SearchController`, authorizes `search:create`/`advance`/`upsert_document`/`delete_document`/`add_synonym`/`remove_synonym`/`add_suggestion`/`log_query`                        | Same shape as `CouponsAdminController`     |
| `apps/admin/src/http/search-routes.ts` (new)                 | `searchRoutes(admin)` — 8 routes                                                                                                                                                                                | Same shape as `coupons-routes.ts`          |
| `apps/admin/src/composition.ts`                              | Added `wireSearch` import, `search` field on `WiredAdmin`, wiring call, drain-array entry, controller construction                                                                                              | Same pattern as Coupons                    |
| `apps/admin/src/http/admin-routes.ts`                        | Added import + spread                                                                                                                                                                                           | Exposes the new routes                     |
| `apps/admin/package.json`                                    | Added `@platform/search: workspace:*`                                                                                                                                                                           | Was missing                                |
| `pnpm-lock.yaml`                                             | Updated via `pnpm install`                                                                                                                                                                                      | Mechanical                                 |
| `apps/admin/src/admin.e2e.test.ts`                           | Added one regression test: create → upsertDocument (asserts `documentCount === 1`) → addSynonym → removeSynonym → addSuggestion → logQuery → deleteDocument (asserts `documentCount === 0`) → advance(disabled) | Closes coverage gap; isolated `it()` block |

No changes to `services/search/**`, any other service, any event contract, or any public API
shape outside `apps/admin`. Unlike Analytics (Milestone 10), `wireSearch`/`SearchController` were
already correctly exported from `services/search/src/index.ts` — no service-side change needed.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors                                           |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 23/23 (was 22/22; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6522 dependencies — unchanged |

---

## 4. Pattern deviation

**None.** Verified `SearchIndex.create()` defaults to `active` status (so `upsertDocument`/
`deleteDocument`'s `requireActive()` guard passes immediately after create, no ordering fix
needed) and every route included an explicit `schema.body`/`schema.params` — the "empty `schema:
{}`" gotcha found in Milestone 10 didn't recur here since Search has no no-input routes.

---

## 5. Remaining blockers / next steps

Next: Milestone 12 — Feature Registry (last of the 12-item business batch). Security remains
deferred to S1.5.
