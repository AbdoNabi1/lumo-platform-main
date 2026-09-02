# Integration Sprint — App-Composition Wiring (Commit #2): Not Landed

`INTEGRATION_SPRINT_EXCEPTION.md` authorized two commits: (1) the service-layer composition surface
(landed, `44be526`) and (2) app-composition wiring in `apps/admin`/`apps/runtime`. This second
commit is **not landed**, and not achievable as originally scoped.

## Why

`apps/admin/src/composition.ts`'s current state in `lumo-platform` imports `wire*` from roughly
**40 packages** — not just the twelve Integration Sprint packages, but also `analytics`,
`automation`, `components`, `content`, `experience`, `experimentation`, `feature-flags`,
`feature-registry`, `licensing`, `localization`, `media-library` (renamed from `media`), `pages`,
`platform-console`, `reporting`, `security`, `seo`, `tenancy`, `theme`, `customer-360`, `loyalty`,
`recommendations`, `reviews`, `search`, `wishlist`, `returns`, `shipping` — the large majority of
which are **not committed to this repository at all** (most of these bounded contexts have no
commit anywhere in `recovery/history-reconstruction`, Customer-360 being the one exception, landed
separately). `apps/admin`'s diff (382 lines) reflects the admin app's cumulative growth across
essentially every sprint this platform has ever had, not a change scoped to the Integration Sprint.

Landing `apps/admin`'s current composition.ts would require first reconstructing admin surfaces for
two dozen contexts that have never been evidenced or committed here — a separate, much larger body
of work (each of those contexts likely has its own Sprint Report describing its own admin
controller, e.g. the same pattern R1/A1g already used for earlier admin-surface milestones in this
recovery — this would be "more A1g-style milestones," not part of the Integration Sprint exception).

`apps/runtime`'s composition wiring has the same problem in miniature: of its three Integration
Sprint-related functions (`buildFulfillmentTriggerRuntime`, `buildFinanceLedgerRuntime`,
`buildShipmentNotificationRuntime`), only the first and third are buildable given what's landed
(Finance itself was deferred in commit #1 — see `INTEGRATION_SPRINT_SERVICE_LAYER_MILESTONE_REPORT.md`).
Landing even those two in isolation, without the module-registry framework
(`apps/runtime/src/modules/*`) that actually invokes them, would mean committing dead code no
entrypoint calls — see `RUNTIME_R2_INVESTIGATION_REPORT.md`'s finding that `apps/runtime`'s own
`api.ts`/`worker.ts` have already been rewritten around an unevidenced "Phase 4B" module framework.

## Disposition

Commit #2 is **not attempted**. `apps/admin` and `apps/runtime` remain exactly as committed by
prior milestones (R1/R3/A1g/A1/P3/P4). The Integration Sprint exception's authority is exhausted by
commit #1 (`44be526`) alone. Extending admin/runtime composition wiring further requires either:

1. First landing the two dozen other bounded contexts `apps/admin` now depends on (a large,
   separate reconstruction program, likely well-evidenced per-context via their own Sprint Reports —
   unlike the Integration Sprint itself), or
2. A further, separately-authorized exception scoped narrowly to only the Integration-Sprint-related
   admin controllers/routes (`payments.admin-controller.ts`'s new methods, etc.), hand-extracted
   from the current composition.ts without pulling in the other ~28 contexts — not attempted here
   given the size and risk of introducing subtle errors extracting partial wiring from a single
   382-line diff by hand.

This is recorded as a known, explicit, permanent-for-now gap — not a silent omission.
