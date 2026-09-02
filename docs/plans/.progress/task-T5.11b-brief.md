# Task T5.11b brief — Feature Flags + Experimentation (read screens from scratch + write)

Part 2 of 2 covering T5.11. Same write-screen recipe as every prior Phase 5 task. **No frontend
exists for either domain** — build both read and write from scratch. Scope (`apps/feature-flags`,
`apps/experiments`, `lib/api/feature-flags.ts`, `lib/api/experimentation.ts`) does not overlap
T5.11a or any earlier Phase 5 task. Note: this repo already has a **Feature Registry** screen
(`apps/admin-web/src/app/feature-registry`, from Phase 3 T3.4) — that is a **different** backend
domain (`services/feature-registry`, capability/dependency graph of application features) from
this task's **Feature Flags** domain (`services/feature-flags`, boolean/percentage rollout
toggles). Do not touch the Feature Registry screen; build a separate one for Feature Flags.

## A. Feature Flags — `apps/admin/src/http/feature-flags-routes.ts` (read in full, verbatim below)

`FeatureFlagDto`: `{ id, key, name, description: string|null, status,
environments: Array<{environment, enabled: boolean, rolloutPercentage: number|null}>,
rules: Array<{type, attribute: string|null, values: string[], enabled: boolean}>,
rolloutPercentage: number, changes: Array<{action, changedBy, details: string|null, occurredAt}> }`.

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/feature-flags` (create) | POST | `feature_flags:create` | yes | `{ key: string.min(1), name: string.min(1), description?: string.min(1) }` — created active, 0% rollout |
| `/feature-flags/:flagId/transitions` | POST | `feature_flags:advance` | yes | `{ toStatus: "active"\|"killed"\|"archived", changedBy: string.min(1) }` |
| `/feature-flags/:flagId/rollout` | POST | `feature_flags:set_rollout` | yes | `{ percentage: number.min(0).max(100), changedBy: string.min(1) }` |
| `/feature-flags/:flagId/rules` (add) | POST | `feature_flags:add_rule` | **no** | `{ type: "tenant"\|"user"\|"attribute", values: string[], enabled: boolean, attribute?: string.min(1), changedBy: string.min(1) }` |
| `/feature-flags/:flagId/environment-overrides` (set) | POST | `feature_flags:set_environment_override` | yes | `{ environment: string.min(1), enabled: boolean, rolloutPercentage?: number.min(0).max(100), changedBy: string.min(1) }` |
| `/feature-flags` (list) | GET | `feature_flags:read` | — | `{ first?, after?, last?, before? }` |
| `/feature-flags/:flagId` (get) | GET | `feature_flags:read` | — | — |

Every write body except create carries its own `changedBy` field (an audit-trail actor id) —
this is separate from auth/session identity; render it as a required text input on each form (the
operator types who they are, or use the current admin user's id/email if `getCurrentUser()`
exposes one — check `lib/auth/current-user.ts`, prefer pre-filling from that over a blank field if
available).

Flag status transition table (copy verbatim as UI-only data, sourced from
`services/feature-flags/src/domain/value-objects/flag-status.ts`, never import `services/*`):
```
active: [killed, archived]
killed: [active, archived]
archived: []
```

Build: `apps/admin-web/src/lib/api/feature-flags.ts` (list/get + 5 mutate functions),
`apps/admin-web/src/app/feature-flags/page.tsx` (list) + `.../new/page.tsx` (create) +
`.../[flagId]/page.tsx` (detail: environments table, rules table, rollout slider/number input,
changes/audit history table, lifecycle actions gated by the table above, an "add rule" form, an
"add/update environment override" form).

## B. Experimentation — `apps/admin/src/http/experimentation-routes.ts` (read in full, verbatim below)

`ExperimentDto`: `{ id, name, hypothesis: string|null, variants: Array<{key,
allocationPercentage: number, isControl: boolean}>, audiencePercentage: number,
audienceSegmentRefs: string[]|null, goalMetricRef, featureFlagRef: string|null, status,
results: Array<{variantKey, metricValue: number, sampleSize: number, occurredAt}>,
winnerVariantKey: string|null }`.

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/experiments` (create) | POST | `experiments:create` | yes | `{ name: string.min(1), hypothesis?: string.min(1), variants: Array<{key: string.min(1), allocationPercentage: number, isControl: boolean}>.min(1), goalMetricRef: string.min(1), audiencePercentage?: number.min(0).max(100), audienceSegmentRefs?: string[], featureFlagRef?: string.min(1) }` — **variant allocations must sum to 100** (client-side validate this before submit for a fast error, but the backend is authoritative — surface its rejection via `toFormState` if the client check is somehow wrong) |
| `/experiments/:experimentId/transitions` | POST | `experiments:advance` | yes | `{ toStatus: "draft"\|"running"\|"paused"\|"completed"\|"archived" }` |
| `/experiments/:experimentId/results` (record) | POST | `experiments:record_result` | **no** | `{ variantKey: string.min(1), metricValue: number, sampleSize: int().min(0) }` |
| `/experiments/:experimentId/winner` (declare) | POST | `experiments:declare_winner` | yes | `{ variantKey: string.min(1) }` |
| `/experiments` (list) | GET | `experiments:read` | — | `{ first?, after?, last?, before? }` |
| `/experiments/:experimentId` (get) | GET | `experiments:read` | — | — |

Experiment status transition table (copy verbatim, sourced from
`services/experimentation/src/domain/value-objects/experiment-status.ts`):
```
draft: [running]
running: [paused, completed]
paused: [running, completed]
completed: [archived]
archived: []
```
`featureFlagRef` on the create form is a plain text id — a cross-domain picker into this same
task's Feature Flags list is a nice-to-have (both screens exist in this same task, so a `<select>`
populated from `fetchFeatureFlagsPage` is reasonable here, unlike cross-task pickers elsewhere in
Phase 5 which stayed plain text) but not required; your call, keep it simple if it adds complexity.

Build: `apps/admin-web/src/lib/api/experimentation.ts` (list/get + 4 mutate functions),
`apps/admin-web/src/app/experiments/page.tsx` (list) + `.../new/page.tsx` (create — variants as a
repeated `{key, allocationPercentage, isControl}` row array, same technique used throughout Phase
5) + `.../[experimentId]/page.tsx` (detail: variants table, results table, a "record result" form,
a "declare winner" form — offered only among the experiment's own variant keys — lifecycle actions
gated by the table above).

## Navigation, middleware, dictionaries

- `PRIMARY_NAV`: `feature-flags` entry (label it clearly distinct from the existing
  "Feature Registry" nav entry — e.g. "Feature Flags" vs "Feature Registry"), `experiments` entry.
- `middleware.ts`: `["/feature-flags", "viewer"]`, `["/feature-flags/new", "operator"]`,
  `["/experiments", "viewer"]`, `["/experiments/new", "operator"]`.
- Every new string in both `messages/en.ts` and `messages/ar.ts`.

## Global constraints (every Phase 5 task)

1. `packages/*`/`services/*` never import from `apps/*`; copy both transition tables as data.
2. Domain aggregates never go on the wire — both DTOs above are already correctly typed.
3. Never fabricate data.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark T5.11's checkbox (`- [ ] **T5.11 Notifications, localization, feature flags,
   experimentation.**` → `- [x] ...`) in `docs/plans/PHASE-5-6-backlog.md` **only if T5.11a has
   already landed** — check its report file exists at
   `docs/plans/.progress/task-T5.11a-report.md` with status DONE before ticking; if T5.11a hasn't
   finished yet, leave the checkbox alone and just note in your own report that your half (Feature
   Flags + Experimentation) is complete — the controller will tick it once both halves are
   confirmed.
8. One `Idempotency-Key` per user-initiated submit.
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.11b-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
