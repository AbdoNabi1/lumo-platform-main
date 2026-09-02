# Task T5.12b report — Security write actions: Identity lifecycle (principals + machine identities)

Status: **DONE**

Part 2 of 6 for T5.12 (revised split). T5.12's checkbox in `docs/plans/PHASE-5-6-backlog.md` was
**not** ticked — 4 more parts (T5.12c–T5.12f) remain.

## What was built

Added the 4 non-credential Identity write routes to the existing (read-only, T3.1)
`/security/identity` screen: `registerPrincipal`, `transitionPrincipal`, `governMachineIdentity`,
`suspendMachineIdentity`. Deliberately excluded `issueCredential`/`rotateCredential`/
`revokeCredential` from `apps/admin/src/http/security-identity-routes.ts` — those are deferred to
T5.12c per the brief's revised split.

### 1. `apps/admin-web/src/lib/api/security.ts` (appended)

New section `── Identity writes: register/transition principal, govern/suspend machine identity
(T5.12b) ──`, following the exact `mutateAdminApi` + `isValid` pattern the T5.12a AI Governance
section (immediately above it) established:

- `PrincipalKind` — the 8-value union mirroring `principalKindEnum` in
  `security-identity-routes.ts`.
- `PrincipalOutputDto` / `isPrincipalOutputDto` — the plain DTO `presentPrincipal()` returns
  (`services/security/src/application/principal.use-cases.ts`), typed in full since it's not the
  `Principal` aggregate (README.md rule #2).
- `registerPrincipal(input, idempotencyKey)` — `POST /security/principals`.
- `PrincipalTransitionTarget` = `"suspended" | "active" | "disabled"`.
- `PRINCIPAL_STATUS_TRANSITIONS` — a UI-only mirror of `Principal`'s **private** `TRANSITIONS`
  table, read directly from `services/security/src/domain/principal.ts` (not assumed):
  `active → [suspended, disabled]`, `suspended → [active, disabled]`, `disabled → []`. Documented
  as non-authoritative — `Principal.transition` still enforces this server-side; a UI/domain drift
  can only offer an option the backend then rejects as a normal form error, never silently allow
  an illegal one.
- `transitionPrincipal(externalId, to, idempotencyKey)` — `POST
  /security/principals/:externalId/transitions`.
- `MachineIdentityOutputDto` / `isMachineIdentityOutputDto` — the plain DTO
  `machine-identity.use-cases.ts`'s `present()` returns. Documented that `principalRef` on this DTO
  is the profile's **internal** principal id (`principal.id.toString()`), not `externalId` — traced
  through `GovernMachineIdentity.execute`'s call to `MachineIdentityProfile.govern(id,
  principal.id.toString(), ...)` and confirmed the read-model (`read-models.ts`'s
  `machineIdentityExplorer()`) exposes the same internal `principalRef`, not `externalId`. This is
  why govern/suspend machine-identity are standalone forms rather than per-row controls (see below).
- `MachineIdentityConfigInput` — the 6 fields mirroring `machineIdentityConfigSchema`.
- `governMachineIdentity(externalId, config, idempotencyKey)` — `POST
  /security/machine-identities/:externalId`.
- `suspendMachineIdentity(externalId, idempotencyKey)` — `POST
  /security/machine-identities/:externalId/suspend`.

### 2. `apps/admin-web/src/app/security/identity/actions.ts` (new)

4 `"use server"` actions (`registerPrincipalAction`, `transitionPrincipalAction`,
`governMachineIdentityAction`, `suspendMachineIdentityAction`), following the README recipe and
mirroring `security/ai-governance/actions.ts`'s conventions: defensive `FormData` parsing (every id
re-derived from the submitted form, not a closure variable), one `newIdempotencyKey()` per
invocation, `revalidatePath("/security/identity")` on `ok`, `toFormState` otherwise. Local
`nullableIntField` helper reused for `maxCredentialTtlSeconds`/`rotationIntervalDays` (each pairs a
number input with a "clear" checkbox to reach the backend's explicit-`null` case, same as
`governAiIdentityAction`'s `tokenBudget`/`callQuota`).

### 3. `apps/admin-web/src/components/security/identity-actions.tsx` (new)

4 client components:

- `RegisterPrincipalForm` — standalone create form. `kind` renders as a native `<select>` with all
  8 enum values (brief's explicit instruction). `attributes` (the optional ABAC bag) was
  deliberately left off — the brief calls out `kind` specifically and never asks for a free-form
  key/value editor, and the field is fully optional server-side; adding an unrequested
  `Record<string,string>` editor would be scope creep, not a required capability.
- `TransitionPrincipalControl` — **per-row** control attached to each row of the identity-overview
  table (verified `IdentityOverviewDto`'s `PrincipalOverviewRowDto` exposes a real `externalId`,
  traced to `read-models.ts` line 285: `externalId: p.externalId`, not an internal id — so a
  per-row attachment was correct here, unlike the two machine-identity actions). Renders only the
  `to` options `PRINCIPAL_STATUS_TRANSITIONS[status]` marks legal; a `disabled` principal (no legal
  transitions) gets no control at all, just a "No transitions available" note. Submitting a
  transition to `suspended` or `disabled` is gated behind `window.confirm` — not literally the route
  table's one entry labeled "kill-switch" (that's `suspendMachineIdentity`), but both are
  hard-to-reverse moves on a real principal, so treated with the same care per constraint #10's
  spirit (`disabled` has zero outbound transitions per the table above, i.e. is terminal).
  Reactivating (`to: "active"`) is not confirmed.
- `GovernMachineIdentityForm` — standalone create-or-patch form, the 6 `config` fields rendered
  directly (fixed shape, not `Record<string,string>`, per brief).
- `SuspendMachineIdentityForm` — standalone kill-switch form (manual `externalId`, since the
  machine-identity explorer's rows only expose the internal `principalRef`), confirmed via
  `window.confirm` before submit per constraint #10.

### 4. `apps/admin-web/src/app/security/identity/page.tsx` (extended)

- Added an "Actions" column to the identity-overview table, rendering `TransitionPrincipalControl`
  per row.
- Added a new `grid gap-6 lg:grid-cols-2` section (between the two explorer `<Suspense>` blocks and
  the existing 4-lookup grid) with 3 cards: "Register principal", "Govern machine identity"
  (2-column row), and "Suspend machine identity" (full-width, `lg:col-span-2`) — same visual
  structure `security/ai-governance/page.tsx` uses for its govern/suspend/check cards.
- No changes to the read-only lookup sections below.

### 5. `apps/admin-web/src/messages/en.ts` / `messages/ar.ts`

Added `securityIdentityPage.columns.actions` and 4 new nested sections (`register`, `transition`,
`governMachine`, `suspendMachine`) to both dictionaries, matching every key the new components
reference. `en.ts` is the source of truth (`Dictionary` is inferred from it); typecheck confirms
`ar.ts` has no missing/extra keys.

## Verification investigations performed (per brief's instructions)

1. **Principal-status transition table**: read `services/security/src/domain/principal.ts` (not
   assumed) — found the private `TRANSITIONS` constant (`active→[suspended,disabled]`,
   `suspended→[active,disabled]`, `disabled→[]`) and `Principal.transition()`'s enforcement of it.
   Mirrored it as UI-only gating data in `lib/api/security.ts`'s `PRINCIPAL_STATUS_TRANSITIONS`,
   documented as non-authoritative.
2. **`IdentityOverviewDto` row externalId check**: read `services/security/src/interfaces/
   read-models.ts` — `identityOverview()`'s `PrincipalOverviewRow` maps `externalId: p.externalId`
   (the real external id), so a per-row `TransitionPrincipalControl` was correct.
3. **`MachineIdentityExplorerDto` row id check**: same file's `machineIdentityExplorer()` maps
   `principalRef: p.principalRef`, traced to `MachineIdentityProfile.govern(id,
   principal.id.toString(), ...)` in `machine-identity.use-cases.ts` — an **internal** principal id,
   not `externalId`. Confirmed both `governMachineIdentity` and `suspendMachineIdentity` had to be
   standalone forms with a manual `externalId` field, same as T5.12a's `suspendAiIdentity` precedent
   for an analogous reason.
4. **Response DTO shape (aggregate vs. DTO) for all 4 routes**: read
   `principal.use-cases.ts`/`machine-identity.use-cases.ts` — both `RegisterPrincipal`/
   `TransitionPrincipal` return `PrincipalOutput` (via `presentPrincipal()`) and both
   `GovernMachineIdentity`/`SuspendMachineIdentity` return `MachineIdentityOutput` (via
   `present()`) — plain DTOs, safe to type in full, not the `Principal`/`MachineIdentityProfile`
   aggregates.

## Verification run

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

- `typecheck`: passed, 0 errors.
- `lint`: passed, 0 errors — 1 pre-existing unrelated warning (`next.config.ts:64`, `headers` async
  method with no `await`, not touched by this task).
- `test`: **581 passed** across 63 test files (0 failed). `src/lib/api/security.test.ts`'s existing
  27 tests still pass unchanged — this task only appended new exports to that file, didn't modify
  existing ones. No new test files were added for the new actions/components, matching T5.12a's
  precedent (`security/ai-governance/actions.ts` and `ai-governance-actions.tsx` also shipped
  without dedicated unit tests).

## Global constraints checklist

1. `packages/*`/`services/*` never import from `apps/*` — not touched, no `services/security`
   files edited.
2. Domain aggregates never on the wire — confirmed both response DTOs (`PrincipalOutput`,
   `MachineIdentityOutput`) are plain use-case output DTOs, not the `Principal`/
   `MachineIdentityProfile` aggregates.
3. No fabricated data — the transition table was read from the actual domain source, not guessed.
4. Every new user-facing string added to both `en.ts` and `ar.ts`.
5. No `git` commands run (repo has no `.git`).
6. No questions asked; nothing was blocked, so `docs/plans/BLOCKERS.md` was not touched.
7. T5.12's checkbox in `docs/plans/PHASE-5-6-backlog.md` was **not** ticked.
8. One `newIdempotencyKey()` per submit in every one of the 4 new actions.
9. No `RUNTIME_API_URL`/admin-API call from any Client Component — all 4 new `lib/api/security.ts`
   functions are called only from the new `"use server"` actions file.
10. All 4 new controls live under `/security/identity`, already `admin`-gated by
    `middleware.ts`'s `ROUTE_ROLE_REQUIREMENTS` (`["/security", "admin"]`, longest-prefix match) —
    no middleware change needed, matching the brief. The kill-switch
    (`suspendMachineIdentity`) is confirmed via `window.confirm` before submit; the
    per-row `suspended`/`disabled` principal transitions are confirmed too, for the reasons in
    section 3 above.

## Files changed

- `apps/admin-web/src/lib/api/security.ts` (extended)
- `apps/admin-web/src/app/security/identity/actions.ts` (new)
- `apps/admin-web/src/components/security/identity-actions.tsx` (new)
- `apps/admin-web/src/app/security/identity/page.tsx` (extended)
- `apps/admin-web/src/messages/en.ts` (extended)
- `apps/admin-web/src/messages/ar.ts` (extended)

## Concerns

None blocking. Two judgment calls worth flagging to the reviewer:

- `attributes` (the optional ABAC bag on `registerPrincipalBody`) was left off the register form —
  the brief didn't call it out the way it called out `kind`, and it's fully optional server-side.
  If a future part needs it, it's a straightforward additional field.
- The "confirm before submit" gate on `TransitionPrincipalControl` was extended to cover
  `to: "disabled"` in addition to the route table's literal "kill-switch" (`suspendMachineIdentity`),
  since `disabled` is a terminal state with zero outbound transitions per `Principal`'s own
  `TRANSITIONS` table. This is a defensible reading of constraint #10's "kill-switch actions
  (suspend) must be confirmed" but is a judgment call beyond the letter of the brief's route table,
  documented in the component's doc comment for review.
