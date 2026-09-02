# Task T5.12c report — Security write actions: Credentials (rotation tier)

Status: **DONE**

Part 3 of 6 for T5.12. Do **not** tick T5.12's own checkbox — 3 more parts (T5.12d–f) remain.

## Note on the session interruption

This implementation was completed in a second pass after a transient API error truncated the first
attempt mid-stream, right at the "start implementing" transition. Before writing anything, I
verified with `grep` that none of the 6 new function names (`issueCredential`, `rotateCredential`,
`revokeCredential`, `scheduleCredentialRotation`, `rotateDueCredentials`,
`emergencyRevokeCredentials`) existed anywhere in `apps/admin-web/src/lib/api/security.ts` yet —
confirming no edits had landed — before starting fresh. All the investigation described below (route
tables, use-case DTOs, existing write-screen conventions) was re-derived in this pass; nothing was
assumed from the interrupted attempt.

## What was investigated first

- `apps/admin/src/http/security-identity-routes.ts` — confirmed the 3 credential routes
  (`issueCredential`/`rotateCredential`/`revokeCredential`) and left the 4 T5.12b routes
  (register/transition principal, govern/suspend machine identity) untouched.
- `apps/admin/src/http/security-secrets-routes.ts` (75 lines, read in full) — confirmed all 3 routes
  (`rotation-schedule`, `rotate-due`, `emergency-revoke`) and that `lineage`/`secret-explorer` (both
  `GET`) are already wired read-only and out of scope.
- `services/security/src/application/credential.use-cases.ts` — read every use case's `execute` to
  get the exact output DTO shape for each route: `issueCredential`/`rotateCredential`/
  `revokeCredential`/`scheduleCredentialRotation` all return the existing `CredentialOutput` shape
  (already typed in `lib/api/security.ts` as `CredentialOutputDto` for the lineage lookup — reused,
  not redefined). `rotateDueCredentials` returns `{ rotated: number }`, `emergencyRevokeCredentials`
  returns `{ revoked: number }` — both given small dedicated DTOs + guards.
- **Per-row vs standalone investigation (the brief's explicit ask, verified not assumed):**
  - `SecretExplorerDto`'s row type (`lib/api/security.ts`'s `SecretRowDto`) exposes only
    `principalRef`/`kind`/`status`/`rotationDueAt`/`autoRotate` — **no credential id at all** — so
    the "Schedule rotation" form is standalone with a manual `credentialId` field, per the brief's
    fallback instruction.
  - Neither `IdentityOverviewDto` (principals) nor `MachineIdentityExplorerDto` (machine identities)
    — the only two read models the identity page renders — list credentials at all, so "Rotate" and
    "Revoke" are also standalone forms with manual `credentialId` fields (same reasoning
    `suspendMachineIdentityAction`/`suspendAiIdentityAction` already document for their own explorers
    in T5.12a/b).
- `apps/admin-web/src/components/security/identity-actions.tsx`,
  `apps/admin-web/src/app/security/identity/actions.ts`,
  `apps/admin-web/src/components/security/ai-governance-actions.tsx`,
  `apps/admin-web/src/app/security/ai-governance/actions.ts`, and `lib/api/mutation.ts` — read in
  full to match the established write-screen recipe (Server Action + `useActionState` form,
  `FormState`/`toFormState`, `newIdempotencyKey()` per submit, `window.confirm` for destructive
  actions, `Field`/`ErrorBanner` local helpers) exactly.

## Files changed

- `apps/admin-web/src/lib/api/security.ts` — appended a new "Secrets/Credential writes" section
  (placed after `getCredentialLineage`, since it reuses `CredentialOutputDto` from that section) with
  6 typed `mutateAdminApi` functions: `issueCredential`, `rotateCredential`, `revokeCredential`,
  `scheduleCredentialRotation`, `rotateDueCredentials`, `emergencyRevokeCredentials`, plus
  `CredentialKind`, `IssueCredentialInput`, `ScheduleCredentialRotationInput`,
  `EmergencyRevokeCredentialsInput`, `RotateDueCredentialsResultDto`, `EmergencyRevokeResultDto`, and
  their type guards. Every DTO is hand-typed to the use-case's actual return shape — no `isUnknown`
  fallback was needed since all 6 routes return simple, fully-typeable DTOs.
- `apps/admin-web/src/app/security/identity/actions.ts` — added `issueCredentialAction`,
  `rotateCredentialAction`, `revokeCredentialAction`, plus `CREDENTIAL_KINDS`/`isCredentialKind` and
  an `optionalDateTimeField` helper (converts a `datetime-local` input's local value to the ISO
  string the backend's `z.string().datetime()` requires — plain `datetime-local` output doesn't
  satisfy that validator directly). All 3 `revalidatePath("/security/secrets")`, not
  `"/security/identity"`, since credential state renders on the secrets screen.
- `apps/admin-web/src/app/security/secrets/actions.ts` (**new file**) — `scheduleCredentialRotationAction`,
  `rotateDueCredentialsAction`, `emergencyRevokeCredentialsAction`, following the same recipe.
- `apps/admin-web/src/components/security/identity-actions.tsx` — added `IssueCredentialForm` (kind
  `<select>` with the 5 enum values, optional `expiresAt` as `type="datetime-local"`),
  `RotateCredentialForm` (`credentialId` + `newMaterial`, non-destructive submit), `RevokeCredentialForm`
  (`credentialId`, `window.confirm`-gated, `variant="destructive"`).
- `apps/admin-web/src/components/security/secrets-actions.tsx` (**new file**) —
  `ScheduleCredentialRotationForm` (`credentialId`/`intervalDays`/`graceSeconds`/`autoRotate`
  checkbox), `RotateDueCredentialsButton` (no fields, confirm-gated bulk action),
  `EmergencyRevokeCredentialsForm` (`principalExternalId`/`reason`, `variant="destructive"`).
- `apps/admin-web/src/app/security/identity/page.tsx` — added 3 cards (Issue/Rotate/Revoke
  credential) below the existing register/govern/suspend cards.
- `apps/admin-web/src/app/security/secrets/page.tsx` — added a 3-card grid (Schedule
  rotation/Rotate due/Emergency revoke) between the secret explorer and the lineage lookup.
- `apps/admin-web/src/messages/en.ts` / `apps/admin-web/src/messages/ar.ts` — added
  `securityIdentityPage.issueCredential` / `.rotateCredential` / `.revokeCredential` and
  `securitySecretsPage.scheduleRotation` / `.rotateDue` / `.emergencyRevoke`, structurally identical
  in both files (the `ar` dictionary is checked against `Dictionary` at the type level via
  `DICTIONARIES` in `lib/i18n.ts`, so a missing/mismatched key there is a typecheck failure, not just
  a runtime gap — this passed).

## Emergency-revoke's confirmation treatment (the brief's explicit ask)

`EmergencyRevokeCredentialsForm` (`components/security/secrets-actions.tsx`) does **not** use a
static confirm string like every other destructive control in this task. Its `onSubmit` reads the
`principalExternalId` the operator actually typed out of the form's own `FormData` at submit time
and interpolates it into the confirm message via `.replace("{principal}", principal)` — the same
placeholder-substitution pattern `securityAuditPage.verifyBroken`/`verifyReason` already use
elsewhere in this dictionary. The English text:

> Emergency-revoke every non-terminal credential held by "{principal}"? This is irreversible and
> immediately revokes every active credential this principal holds, not just one.

names the exact principal and states both the irreversibility and the full blast radius, per the
brief. If the field is empty at submit time, the confirm is skipped and the submit proceeds straight
to normal server-side field validation (mirrors how `TransitionPrincipalControl`'s per-target confirm
already handles an unset value) — it never confirms against a blank/placeholder principal name.

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck   # clean, no errors
pnpm --filter admin-web lint        # 0 errors, 1 pre-existing warning (next.config.ts, unrelated)
pnpm --filter admin-web test        # 63 files, 581 tests, all passed
```

One lint error was found and fixed during verification: `EmergencyRevokeCredentialsForm`'s original
`String(formData.get("principalExternalId") ?? "")` tripped
`@typescript-eslint/no-base-to-string` (a `FormDataEntryValue` can be a `File`, whose default
stringification isn't meaningful). Fixed by narrowing with `typeof rawPrincipal === "string"` before
using the value, instead of blindly coercing.

## Concerns / things worth a second look

- **No new unit tests were added to `lib/api/security.test.ts`.** T5.12a added a
  `describe("governAiIdentity / suspendAiIdentity / checkAiAction")` block for its 3 new functions;
  T5.12b (register/transition principal, govern/suspend machine identity — the immediately preceding,
  most analogous part) added none. I followed the more recent T5.12b precedent and the brief's own
  "What to build" list (which doesn't mention tests) rather than T5.12a's, but this is a judgment
  call or noting explicitly rather than a demonstrated house rule — a reviewer may want tests added
  for the 6 new `security.ts` functions for parity with T5.12a.
- `issueCredential`'s `expiresAt` field is optional and, in the UI, a bare `type="datetime-local"`
  input converted client-action-side to an ISO string via `new Date(raw).toISOString()`. This is
  interpreted in the *server's* local timezone (Node process), not the browser's, since the
  conversion happens in the Server Action, not client-side — consistent with how the codebase already
  handles this class of input elsewhere (no client-side `Date` parsing precedent exists in this
  codebase; `promotions-routes.ts` instead uses `z.coerce.date()` object-server-side, a more lenient
  backend validator this credential route doesn't use). Flagging as a minor UX ambiguity, not a bug —
  the field is optional and validation still fails safely (a normal form error) on any unparsable
  input.
- Per constraint #7, T5.12's own checkbox in `docs/plans/PHASE-5-6-backlog.md` was left unticked.
- No blockers were hit; `docs/plans/BLOCKERS.md` was not touched.
