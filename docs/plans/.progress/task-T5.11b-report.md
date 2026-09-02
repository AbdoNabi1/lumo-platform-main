# Task T5.11b report — Feature Flags + Experimentation (Part 2 of 2)

## Status: DONE

Both domains (Feature Flags, Experimentation) built from scratch per the brief. No frontend existed
for either before this task. This is Part 2 of T5.11 — the sibling T5.11a (Notifications +
Localization) landed first (`docs/plans/.progress/task-T5.11a-report.md`, status DONE, confirmed
before starting). Per the brief's instruction 7, since T5.11a had already landed, **T5.11's checkbox
in `docs/plans/PHASE-5-6-backlog.md` was ticked** (`- [ ]` → `- [x]`) as part of this task.

No blockers encountered; `docs/plans/BLOCKERS.md` was not touched.

## Scope respected

Only `apps/admin-web/` and the two files the brief explicitly authorizes
(`docs/plans/PHASE-5-6-backlog.md`'s checkbox, this report) were touched. `apps/admin`,
`services/*`, `packages/*` were read for reference (route files, DTOs, domain status enums) but
never edited. No `git` commands were run (repo has no `.git`). Read
`apps/admin/src/http/feature-flags-routes.ts` and `apps/admin/src/http/experimentation-routes.ts`
in full and confirmed every route/permission/idempotent flag/zod body in the brief matches the
actual source verbatim. Did not touch `app/feature-registry` — confirmed it is a different backend
domain (`services/feature-registry`, capability/dependency graph) from this task's Feature Flags
(`services/feature-flags`, boolean/percentage rollout toggles), and gave the new nav entries/labels
clearly distinct names ("Feature flags" vs "Feature registry").

## Files created

### Feature Flags

- `apps/admin-web/src/lib/feature-flag-lifecycle.ts` — hand-kept copy of the transition table from
  the brief (`active: [killed, archived]`, `killed: [active, archived]`, `archived: []`), plus
  `advanceableFlagStatusesFrom`. Simpler than `lib/notification-lifecycle.ts`'s `canXFrom`/
  `DEDICATED_COVERED_TARGETS` split: no route dedicates itself to one transition target here — the
  generic `POST /feature-flags/:flagId/transitions` is the only status-changing route.
- `apps/admin-web/src/lib/feature-flag-lifecycle.test.ts` — 5 tests.
- `apps/admin-web/src/lib/api/feature-flags.ts` — `fetchFeatureFlagsPage`, `fetchFeatureFlag`, and 5
  mutate functions (`createFeatureFlag`, `advanceFeatureFlag`, `setFeatureFlagRollout`,
  `addFeatureFlagRule`, `setFeatureFlagEnvironmentOverride`).
- `apps/admin-web/src/lib/api/feature-flags.test.ts` — 10 tests.
- `apps/admin-web/src/components/feature-flags/`: `feature-flag-status-badge.tsx`,
  `feature-flags-table.tsx`, `feature-flags-pagination.tsx`, `feature-flag-create-form.tsx`,
  `feature-flag-lifecycle-actions.tsx` (generic advance control gated by the lifecycle table, plus
  always-offered rollout/add-rule/environment-override forms — every form here carries its own
  `changedBy` audit field, pre-filled from `getCurrentUser()`'s identity but always editable).
- `apps/admin-web/src/app/feature-flags/actions.ts`, `page.tsx` (list), `new/page.tsx` (create),
  `[flagId]/page.tsx` (detail — environments table, rules table, change-history table, all 4
  write forms).

### Experimentation

- `apps/admin-web/src/lib/experiment-lifecycle.ts` — hand-kept copy of the transition table from
  the brief (`draft: [running]`, `running: [paused, completed]`, `paused: [running, completed]`,
  `completed: [archived]`, `archived: []`), plus `advanceableExperimentStatusesFrom`. Same
  no-dedicated-action shape as Feature Flags.
- `apps/admin-web/src/lib/experiment-lifecycle.test.ts` — 7 tests.
- `apps/admin-web/src/lib/api/experimentation.ts` — `fetchExperimentsPage`, `fetchExperiment`, and 4
  mutate functions (`createExperiment`, `advanceExperiment`, `recordExperimentResult`,
  `declareExperimentWinner`).
- `apps/admin-web/src/lib/api/experimentation.test.ts` — 9 tests.
- `apps/admin-web/src/components/experiments/`: `experiment-status-badge.tsx`,
  `experiments-table.tsx`, `experiments-pagination.tsx`, `experiment-create-form.tsx` (variants
  rendered as a repeated `{key, allocationPercentage, isControl}` row array, same technique as
  `ComponentCreateForm`'s `properties` rows (T5.9c) — `isControl` uses a "true"/"false" `<select>`
  rather than a checkbox so the parallel per-row arrays stay index-aligned; allocations-must-sum-
  to-100 is checked client-side on submit for a fast error and re-checked server-side),
  `experiment-lifecycle-actions.tsx` (generic advance control, record-result and declare-winner
  forms — both offer `variantKey` only among the experiment's own variants).
- `apps/admin-web/src/app/experiments/actions.ts`, `page.tsx` (list), `new/page.tsx` (create),
  `[experimentId]/page.tsx` (detail — variants table with a winner badge, results table, both
  write forms).

## Files modified

- `apps/admin-web/src/components/navigation.ts` — added `feature-flags` (`ToggleLeftIcon`) and
  `experiments` (`FlaskConicalIcon`) nav entries, placed after the existing `feature-registry`
  entry, with icons and labels ("Feature flags" / "Feature registry") deliberately distinct from
  the pre-existing Feature Registry screen.
- `apps/admin-web/src/middleware.ts` — added `ROUTE_ROLE_REQUIREMENTS` entries exactly as specified
  in the brief: `/feature-flags/new` operator, `/feature-flags` viewer, `/experiments/new`
  operator, `/experiments` viewer.
- `apps/admin-web/src/messages/en.ts` / `messages/ar.ts` — added every new string: `nav.featureFlags`
  / `nav.experiments`, plus `featureFlagsPage`, `featureFlagStatus`, `featureFlagRuleType`,
  `featureFlagCreateForm`, `featureFlagDetail`, `featureFlagLifecycle`, `experimentsPage`,
  `experimentStatus`, `experimentCreateForm`, `experimentDetail`, `experimentLifecycle`. Verified
  via `lib/i18n.test.ts`'s "actually translated, not copied" and placeholder-preservation checks
  (both pass — no interpolation placeholders were introduced by either domain's copy).
- `docs/plans/PHASE-5-6-backlog.md` — ticked T5.11's checkbox (both sub-briefs now landed).

## Verification

```
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

- **typecheck**: clean, no errors. (One pass required a fix: `advanceFeatureFlagAction`'s
  `toStatus` needed the `isFeatureFlagStatus` guard folded directly into the early-return
  condition for TS to narrow it to `FeatureFlagStatus` at the call site — fixed.)
- **lint**: 0 errors, 1 pre-existing warning in `next.config.ts` (`@typescript-eslint/require-await`
  on an existing `headers()` method) — unrelated to this task, same warning T5.11a's report noted.
- **test**: 63 test files passed, 575 tests passed, 0 failed (31 new tests from this task: 5 in
  `feature-flag-lifecycle.test.ts`, 7 in `experiment-lifecycle.test.ts`, 10 in
  `feature-flags.test.ts`, 9 in `experimentation.test.ts` — up from T5.11a's baseline of 544).

## Design decisions / concerns

1. **`changedBy` field.** No existing precedent in this codebase pre-fills a text input from the
   current admin user's identity (the closest precedent, `reviews.ts`'s `moderatorRef`, is left
   blank). Per the brief's explicit instruction, `changedBy` on every Feature Flags write form
   (except create) is pre-filled from `getCurrentUser().name` (the session's email/principal id,
   `lib/auth/current-user.ts`) but remains an editable text input — the operator may be acting on
   someone else's behalf, and the field is a plain audit-trail string, not an auth check.
2. **Rollout/add-rule/environment-override forms are not status-gated.** The brief's transition
   table only governs `POST /feature-flags/:flagId/transitions`; nothing in the brief says these
   three other write routes should be hidden at particular statuses (e.g. `archived`). Per the same
   precedent `ReviewLifecycleActions`/`NotificationLifecycleActions` set (offer the control, let the
   backend's own business rules reject it if inappropriate), they're offered unconditionally. Only
   the generic "advance to…" control is gated (and hidden entirely at the terminal `archived`
   status, where it has nothing to offer).
3. **`isControl` as a select, not a checkbox, in the variants row group.** An unchecked HTML
   checkbox omits itself from `FormData` entirely, which would desynchronize the parallel
   `variantKey`/`variantAllocationPercentage`/`variantIsControl` arrays `parseVariants` reads by
   index once any row's checkbox went unchecked. Followed `ComponentCreateForm`'s `propertyRequired`
   precedent (T5.9c): a "true"/"false" `<select>` that always submits a value, keeping every row's
   three arrays aligned.
4. **`featureFlagRef` stayed plain text**, not a `<select>` populated from `fetchFeatureFlagsPage`.
   The brief explicitly calls this optional ("nice-to-have... not required, your call, keep it
   simple if it adds complexity") — a cross-domain `<select>` would need a second server fetch inside
   a client form (or lifting the flags list into the create page and passing it down), adding
   surface area for a field that's already a free-text backend reference. Kept as plain text, same
   as every other cross-reference field in this form (`goalMetricRef`, `audienceSegmentRefs`).
5. **Rollout percentage as a number input, not a slider.** The brief says "rollout slider/number
   input" (either). No existing screen in this codebase uses an `<input type="range">`; a plain
   `type="number"` (min 0, max 100) matches the convention every other percentage/quantity field in
   this app uses and is simpler to verify.
6. **Navigation placement.** `feature-flags` and `experiments` were placed immediately after the
   existing `feature-registry` entry (adjacent platform-configuration domains). Placement is my
   judgment — the brief did not specify exact ordering, only that the entries exist with names
   distinct from Feature Registry.

## Not done

- Nothing outstanding for this task's scope. Feature Flags + Experimentation are both complete,
  read and write, per the brief.
