# Task T5.12c brief — Security write actions: Credentials (rotation tier)

Part 3 of 6 covering T5.12. See `docs/plans/.progress/task-T5.12b-brief.md`'s "Revised split"
section for the full 6-part breakdown. This part is the plan's explicit **"credential rotation"**
high-blast-radius category — dispatch only after T5.12a (AI Governance) and T5.12b (Identity
lifecycle) have landed. T5.12's own checkbox is ticked only after all 6 parts land — do not tick
it yourself.

Same write-screen recipe as every prior Phase 5 task. Extends the existing
`apps/admin-web/src/app/security/secrets/page.tsx` and `.../identity/page.tsx` (Phase 3 T3.1,
read-only) and `apps/admin-web/src/lib/api/security.ts`. **Read both existing pages fully first.**

## Routes — two files, combined because they're the same risk category

### `apps/admin/src/http/security-identity-routes.ts` (credential-specific routes only — the
principal/machine-identity routes in this same file are T5.12b's, already done, do not re-touch)

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/security/credentials` (issue) | POST | `security:issue_credential` | yes | `{ principalExternalId, kind: "api_key"\|"secret"\|"certificate"\|"signing_key"\|"oauth_client", material: string.min(1), expiresAt?: string.datetime() \| null }` |
| `/security/credentials/:credentialId/rotate` | POST | `security:rotate_credential` | yes | `{ newMaterial: string.min(1) }` — "marks current rotated, issues a superseding one" |
| `/security/credentials/:credentialId/revoke` | POST | `security:revoke_credential` | yes | none |

### `apps/admin/src/http/security-secrets-routes.ts` (read in full yourself — short, 75 lines)

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/security/credentials/:credentialId/rotation-schedule` | POST | `security:schedule_credential_rotation` | yes | `{ intervalDays: int().positive(), graceSeconds: int().min(0), autoRotate?: boolean }` |
| `/security/credentials/rotate-due` | POST | `security:rotate_due_credentials` | **no** | none — bulk action, "rotate every credential whose scheduled rotation is due" |
| `/security/credentials/emergency-revoke` | POST | `security:emergency_revoke_credentials` | **no** | `{ principalExternalId: string.min(1), reason: string.min(1) }` — **the single highest-blast-radius action in this part**: "revoke every non-terminal credential for a principal at once (breach response)". Render with an explicit confirmation dialog naming the exact principal and stating the action is irreversible and affects every credential the principal holds. |

`security/credentials/:credentialId/lineage` (GET) and `security/console/secret-explorer` (GET)
are already wired read-only — do not touch them.

## What to build

1. `apps/admin-web/src/lib/api/security.ts` (existing, append) — 6 typed mutate functions:
   `issueCredential`, `rotateCredential`, `revokeCredential`, `scheduleCredentialRotation`,
   `rotateDueCredentials`, `emergencyRevokeCredentials`. Check each handler for DTO mapping;
   default to `isUnknown` if unmapped, per every prior Phase 5 write route.
2. `apps/admin-web/src/app/security/secrets/page.tsx` — add: a per-credential "Schedule rotation"
   form (needs `credentialId` — check whether `SecretExplorerDto`'s rows expose it for per-row
   attachment; if so, attach the form per-row, otherwise a standalone form with a manual id
   field), a standalone "Rotate due credentials" button (no id needed, confirm before submit since
   it's a bulk action), and the "Emergency revoke" form (confirmation-gated, per above — this is
   the part's highest-risk control, treat it accordingly).
3. `apps/admin-web/src/app/security/identity/page.tsx` — add: an "Issue credential" form
   (principalExternalId + kind `<select>` + material + optional expiry), a per-credential "Rotate"
   form (`newMaterial` field) and "Revoke" button (confirm before submit — this immediately
   invalidates the credential).
4. Every new string in both `messages/en.ts` and `messages/ar.ts`. No nav/middleware changes
   needed.

## Global constraints (every Phase 5 task, security tasks especially)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire.
3. Never fabricate data.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Do NOT tick T5.12's checkbox yourself — 3 more parts remain after this one.
8. One `Idempotency-Key` per user-initiated submit, regardless of the route's own `idempotent`
   flag.
9. Never call the runtime API from browser JS.
10. Every write control is `admin`-only (already enforced). **This entire part is the plan's
    named "credential rotation" high-blast-radius category** — every destructive/irreversible
    action (`revoke`, `emergency-revoke`, `rotate-due`) must be confirmed before submit, and
    `emergency-revoke`'s confirmation must be unambiguous about its blast radius (per above).

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.12c-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
