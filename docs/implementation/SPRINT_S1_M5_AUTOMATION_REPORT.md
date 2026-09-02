# Phase S1 — Integration Completion — Milestone 5 (Automation Admin Wiring) — Report

**Status:** Complete. Fifth of the 12-item "business admin wiring" batch. Reuses the Coupons
pattern (Milestone 1) unchanged.

**Trigger:** repository audit found the Automation bounded context (`@platform/automation`,
committed, working `wireAutomation()` + `AutomationController`) had zero admin-app exposure.

---

## 1. Scope

**In scope:** expose Automation's four existing use cases (`create`, `advance`, `trigger`,
`retryExecution`) through the admin app, replicating the Coupons pattern exactly.

**Explicitly not touched:** `services/automation/**`, any other context's wiring, `apps/runtime`,
any public contract/event shape.

---

## 2. Files changed, and why

| File                                                             | Change                                                                                                                                                                                                                     | Why                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/admin/src/interfaces/automation.admin-controller.ts` (new) | `AutomationAdminController` — wraps `AutomationController`, authorizes `automation:create`/`advance`/`trigger`/`retry_execution`                                                                                           | Same shape as `CouponsAdminController`     |
| `apps/admin/src/http/automation-routes.ts` (new)                 | `automationRoutes(admin)` — 4 routes: `POST /automation/workflows`, `POST /automation/workflows/:workflowId/transitions`, `POST /automation/workflows/:workflowId/trigger`, `POST /automation/workflows/:workflowId/retry` | Same shape as `coupons-routes.ts`          |
| `apps/admin/src/composition.ts`                                  | Added `wireAutomation` import, `automation` field on `WiredAdmin`, wiring call, drain-array entry, controller construction                                                                                                 | Same pattern as Coupons                    |
| `apps/admin/src/http/admin-routes.ts`                            | Added import + spread                                                                                                                                                                                                      | Exposes the new routes                     |
| `apps/admin/package.json`                                        | Added `@platform/automation: workspace:*`                                                                                                                                                                                  | Was missing                                |
| `pnpm-lock.yaml`                                                 | Updated via `pnpm install`                                                                                                                                                                                                 | Mechanical                                 |
| `apps/admin/src/admin.e2e.test.ts`                               | Added one regression test: create → advance(active) → trigger → trigger again with the same `triggerId` (asserts `duplicate: true` idempotent replay)                                                                      | Closes coverage gap; isolated `it()` block |

No changes to `services/automation/**`, any other service, any event contract, or any public API
shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors                                           |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 17/17 (was 16/16; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6520 dependencies — unchanged |

---

## 4. Pattern deviation

**Wiring pattern: none.**

**Test-coverage note (not a wiring defect):** `retryExecution` is fully wired (controller method +
guarded permission + HTTP route), matching Coupons/Experimentation/Promotions/Recommendations
exactly, but is **not exercised end-to-end** in the new regression test. `AutomationWorkflow.retryExecution`
requires the target execution to already be in `failed` status (see
`services/automation/src/domain/automation-execution.ts`'s transition table:
`failed → [retrying, dead_letter]`); producing a failed execution requires an `ActionDispatcherPort`
that throws, but `AdminWiringDeps` (this app's composition entrypoint) has no seam to inject a
custom dispatcher into `wireAutomation` — only `AutomationWiringDeps.dispatcher` supports that,
and admin's `wireAdmin` calls `wireAutomation(deps)` with the shared generic deps only, same as
every other context. Threading a per-context dispatcher override through `AdminWiringDeps` would be
a composition-surface change beyond this milestone's "wire what already exists" scope — flagged
here as a known, narrow test-coverage gap, not fixed. The domain-level retry/dead-letter behavior
itself is already covered by `services/automation/src/domain/automation-workflow.test.ts`.

---

## 5. Remaining blockers / next steps

Next: Milestone 6 — Feature Flags. Security remains deferred to S1.5.
