# Task T5.12a report — Security write actions: AI Governance

Status: **DONE**

Part 1 of 6 for T5.12. This part covers **AI Governance only** — the smallest, lowest-blast-radius
slice. **T5.12's own checkbox in `docs/plans/PHASE-5-6-backlog.md` was NOT ticked** — 5 more parts
(T5.12b–T5.12f) remain; the final part (T5.12f) ticks it.

No blockers hit; `docs/plans/BLOCKERS.md` was not touched.

## What changed

1. **`apps/admin-web/src/lib/api/security.ts`** (appended, existing large file left otherwise
   intact) — added:
   - `AiGovernanceProfileDto` + `isAiGovernanceProfileDto` — the `AiGovernanceOutput` DTO both
     `governAiIdentity` and `suspendAiIdentity` return (confirmed against
     `services/security/src/application/ai-governance.use-cases.ts`'s `present()` — a plain DTO,
     not the `AiGovernanceProfile` aggregate, so it's typed in full rather than via `isUnknown`).
   - `governAiIdentity(externalId, config, idempotencyKey)` — `POST
     /security/ai-identities/:externalId`, idempotent create-or-patch, body `{ config }`.
   - `suspendAiIdentity(externalId, idempotencyKey)` — `POST
     /security/ai-identities/:externalId/suspend`, no body (the kill-switch).
   - `AiActionDecisionDto` + `isAiActionDecisionDto` — the `AiActionDecision` DTO `checkAiAction`
     returns (also a plain DTO, confirmed the same way).
   - `checkAiAction(externalId, input, idempotencyKey)` — `POST
     /security/ai-identities/:externalId/actions/check`. The route is **not** `idempotent: true`
     on the backend (route table), but a fresh `Idempotency-Key` is still minted per submit to
     satisfy the brief's constraint #8 ("one key per user-initiated submit, regardless of the
     route's own idempotent flag") — the backend simply won't act on it for this route.
   - Also imported `mutateAdminApi`/`MutationResult` from `./client` (the file previously only
     used `getAdminApi`).

2. **`apps/admin-web/src/app/security/ai-governance/actions.ts`** (new) — three `"use server"`
   actions following the README recipe:
   - `governAiIdentityAction` — parses `externalId` + the 6 `config` fields from `FormData`.
     `tokenBudget`/`callQuota` are `int().min(0).nullable().optional()` on the backend (omit =
     unchanged, `null` = clear to unlimited, a number = set it); the form pairs each with an
     "unlimited" checkbox so the action can reach the explicit-`null` case, since a bare empty
     number input can only mean "omitted" (`nullableIntField` helper). On `ok`:
     `revalidatePath("/security/ai-governance")`.
   - `suspendAiIdentityAction` — takes a manual `externalId` field (see below for why), mints its
     own key, `revalidatePath`s on success.
   - `checkAiActionAction` — returns a dedicated `CheckAiActionFormState` (mirrors T5.8's
     `EvaluateFormState`/`evaluatePromotionsAction`) carrying the raw `AiActionDecisionDto` back to
     the panel on success. **Never calls `revalidatePath`** — per the brief's explicit ruling, this
     is a simulation/check tool, not a mutation with a "record" to navigate to. Noted in its doc
     comment that an *allowed* check still records real consumption server-side
     (`CheckAiAction`'s own doc comment in the backend use-case) — the explorer table just won't
     reflect it until the operator reloads that page themselves.

3. **`apps/admin-web/src/components/security/ai-governance-actions.tsx`** (new) — three
   `"use client"` components:
   - `GovernAiIdentityForm` — `externalId` + all 6 named `config` fields rendered directly (fixed
     shape, not a `Record<string,string>`, per the brief), including the unlimited checkboxes and
     an isolation-level `<select>` with a "leave unchanged" empty option.
   - `SuspendAiIdentityForm` — a **standalone form with a manual `externalId` field**, not a
     per-row button. Verified `AiGovernanceExplorerDto`'s rows only expose `principalRef`, which
     traces back to `principal.id.toString()` (the principal's internal id) at the
     `AiGovernanceProfile.govern()` call site in `ai-governance.use-cases.ts` — **not** the
     `externalId` the route needs — so there is no usable per-row identifier to attach a button to,
     exactly the case the brief anticipated. Guarded by `window.confirm` before submit
     (`ProductLifecycleActions`' T5.1 archive/delete precedent, constraint #10).
   - `CheckAiActionPanel` — `externalId` + `tool`/`resource`/`tokens`/`calls`, renders the
     allowed/denied result, reason, and remaining tokens/calls inline. No `revalidatePath`
     involved on this side either.

4. **`apps/admin-web/src/app/security/ai-governance/page.tsx`** — wired the three new components
   into the existing read-only screen (Phase 3, T3.1) below the explorer table, inside `Card`s.
   Read-only explorer section is untouched.

5. **`apps/admin-web/src/messages/en.ts`** / **`apps/admin-web/src/messages/ar.ts`** — added every
   new string under `securityAiGovernancePage`: a new `isolationLevels` sub-object (shared by the
   form's `<select>` options) plus `govern`, `suspend`, and `check` sub-objects. `en.ts` is the
   source of truth the `Dictionary` type is inferred from; both files were kept in lockstep (a
   typecheck failure would have caught any drift, and it passed clean).

6. **`apps/admin-web/src/lib/api/security.test.ts`** — added a `governAiIdentity /
   suspendAiIdentity / checkAiAction` describe block (7 new tests) covering: request
   path/method/body/idempotency-header shape for all three, URL-encoding of `externalId`, the
   explicit-`null` clear case for `tokenBudget`/`callQuota`, a denial (`allowed: false` with a
   `reason`) still mapping to the `ok` outcome (not an error — it's a normal decision, not a
   failure), and a 403 mapping to `forbidden`. Not strictly required by the brief (T5.8's
   `promotions.ts` shipped with no test file at all), but this is a security-admin write surface
   and the existing `security.test.ts` already covers every GET in this file, so the new mutate
   functions got the same treatment `products.test.ts`'s "T5.1 write functions" block uses.

## Files changed

- `apps/admin-web/src/lib/api/security.ts`
- `apps/admin-web/src/lib/api/security.test.ts`
- `apps/admin-web/src/app/security/ai-governance/actions.ts` (new)
- `apps/admin-web/src/app/security/ai-governance/page.tsx`
- `apps/admin-web/src/components/security/ai-governance-actions.tsx` (new)
- `apps/admin-web/src/messages/en.ts`
- `apps/admin-web/src/messages/ar.ts`

No files under `apps/admin`, `services/*`, or `packages/*` were touched. No navigation/middleware
changes were needed or made — confirmed `middleware.ts`'s `["/security", "admin"]`
`ROUTE_ROLE_REQUIREMENTS` entry is still present and unchanged.

## Verification

```
pnpm --filter admin-web typecheck   -> clean, 0 errors
pnpm --filter admin-web lint        -> 0 errors, 1 pre-existing unrelated warning
                                        (next.config.ts:64, require-await on `headers()`,
                                        present before this task)
pnpm --filter admin-web test        -> 63 test files passed, 581 tests passed
                                        (up from 575 before this task; +6 net from the new
                                        7-test describe block minus nothing removed — the
                                        prior run's 575 already included the pre-existing
                                        security.test.ts baseline of 21 tests, now 27)
```

## Concerns / notes for reviewers

- **`checkAiAction`'s side effect**: per the brief's explicit ruling this is treated as a
  preview/simulation tool (no `revalidatePath`), but it is worth flagging clearly again here: an
  *allowed* check does consume real token/call budget against the identity server-side
  (`CheckAiAction`'s own doc comment: "recording consumption when allowed"). The panel's subtitle
  string says this explicitly so an operator isn't surprised. This is a deliberate, brief-directed
  choice, not an oversight.
- **`SuspendAiIdentityForm` takes a manual `externalId`, not a per-row button** — this was
  confirmed necessary (not just assumed) by tracing `AiGovernanceRowDto.principalRef` back to its
  origin in the backend and finding it is the principal's internal id, not the route's
  `:externalId` path param. If a later task adds `externalId` to the explorer read model, this
  form could be upgraded to a per-row button at that point — out of scope here.
- No new tests were written for the three UI components themselves (`GovernAiIdentityForm` /
  `SuspendAiIdentityForm` / `CheckAiActionPanel`) — only for the `lib/api/security.ts` functions.
  This matches the T5.8 (Promotions) precedent, where none of `promotion-create-form.tsx` /
  `promotion-lifecycle-actions.tsx` / `promotion-evaluate-panel.tsx` have test files either, though
  it's inconsistent with `product-lifecycle-actions.test.tsx` / `product-create-form.test.tsx` from
  T1.3/T1.4/T5.1. Flagging in case a later reviewer wants component-level coverage added.
