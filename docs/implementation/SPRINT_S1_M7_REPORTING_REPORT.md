# Phase S1 — Integration Completion — Milestone 7 (Reporting Admin Wiring) — Report

**Status:** Complete. Seventh of the 12-item "business admin wiring" batch. Reuses the Coupons
pattern, with two deviations noted below (one naming/method-shape, one a genuine type-level fix).

**Trigger:** repository audit found the Reporting bounded context (`@platform/reporting`,
committed, working `wireReporting()` + `ReportingController`) had zero admin-app exposure.

---

## 1. Scope

**In scope:** expose Reporting's five existing use cases across its two aggregates — report
definitions (`createReportDefinition`, `advanceReportDefinition`, `generateReport`) and dashboards
(`createDashboard`, `advanceDashboard`) — through the admin app, replicating the Coupons pattern.

**Explicitly not touched:** `services/reporting/**`, any other context's wiring, `apps/runtime`,
any public contract/event shape.

---

## 2. Files changed, and why

| File                                                            | Change                                                                                                                                                                                         | Why                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/admin/src/interfaces/reporting.admin-controller.ts` (new) | `ReportingAdminController` — wraps `ReportingController`, authorizes `reporting:create_report_definition`/`advance_report_definition`/`generate_report`/`create_dashboard`/`advance_dashboard` | Same shape as `CouponsAdminController`, method names kept as-is (see §4) |
| `apps/admin/src/http/reporting-routes.ts` (new)                 | `reportingRoutes(admin)` — 5 routes across report-definitions and dashboards                                                                                                                   | Same shape as `coupons-routes.ts`                                        |
| `apps/admin/src/composition.ts`                                 | Added `wireReporting` import, `reporting` field on `WiredAdmin`, wiring call, drain-array entry, controller construction                                                                       | Same pattern as Coupons                                                  |
| `apps/admin/src/http/admin-routes.ts`                           | Added import + spread                                                                                                                                                                          | Exposes the new routes                                                   |
| `apps/admin/package.json`                                       | Added `@platform/reporting: workspace:*`                                                                                                                                                       | Was missing                                                              |
| `pnpm-lock.yaml`                                                | Updated via `pnpm install`                                                                                                                                                                     | Mechanical                                                               |
| `apps/admin/src/admin.e2e.test.ts`                              | Added one regression test: report-definition create → advance(active) → generateReport, dashboard create → advance(archived)                                                                   | Closes coverage gap; isolated `it()` block                               |

No changes to `services/reporting/**`, any other service, any event contract, or any public API
shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors (one fix required mid-milestone, see §4)  |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 19/19 (was 18/18; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6520 dependencies — unchanged |

---

## 4. Pattern deviation

**Method-naming deviation (by design, not a mistake):** unlike every prior milestone's controller
(`create`/`advance`/...), `ReportingController`'s methods are already named
`createReportDefinition`/`advanceReportDefinition`/`generateReport`/`createDashboard`/`advanceDashboard`
in the service itself — because Reporting owns **two** aggregates (report definitions and
dashboards) in one controller, so short names would collide. The admin controller and routes
reuse these exact names rather than inventing shorter ones, to stay a pure pass-through (no
renaming layer).

**Genuine type-level fix required — a real (if narrow) deviation from "wire only, no logic":**
`tsc --noEmit` failed on first pass:

```
src/http/reporting-routes.ts(43,96): error TS2345: ... Property 'value' is optional in type
'{ field: string; operator: ...; value?: unknown }' but required in type
'{ field: string; operator: FilterOperator; value: unknown }'.
```

Root cause: zod infers a field typed `z.unknown()` as an **optional** TS key (any/unknown-typed
object properties get `?` per zod's `addQuestionMarks` rule), but `CreateReportDefinitionInput`'s
`filters[].value` is a **required** `unknown` field. Spreading the raw zod-parsed body directly
into the domain input (as every other milestone's route does) doesn't type-check here. Fixed by
mapping `body.filters` into a fresh literal array (`filters: body.filters?.map((f) => ({ field:
f.field, operator: f.operator, value: f.value }))`) — an object literal's properties are always
present regardless of the source type's optionality, so this satisfies the required-`value` shape
with zero behavior change (identical runtime values, just a re-shaped literal). No schema was
loosened; no validation was removed. This is the first milestone where "pure delegation" needed a
one-line reshape at the HTTP boundary, purely for TypeScript soundness.

Everything else — composition wiring, package.json, drain-array wiring, controller/permission
guard shape — is identical to Coupons.

---

## 5. Remaining blockers / next steps

Next: Milestone 8 — Reviews. Security remains deferred to S1.5.
