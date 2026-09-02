# Task T5.12b brief — Security write actions: Identity lifecycle (principals + machine identities)

Part 2 of 6 covering T5.12 (revised split — see below). T5.12's checkbox is ticked only after all
6 parts land; do not tick it yourself. Same write-screen recipe as every prior Phase 5 task.
Extends the existing `apps/admin-web/src/app/security/identity/page.tsx` (Phase 3 T3.1, read-only)
and `apps/admin-web/src/lib/api/security.ts`.

## Revised split for T5.12 (read this before starting — supersedes any file-per-part assumption)

The plan says to add **incident triage, session revocation, policy definition and credential
rotation last** ("highest-blast-radius controls"). Those four categories don't map one-to-one onto
the 6 route files, so the split is by risk category, not strictly by file:

- T5.12a (done) — AI Governance (3 routes): lowest risk, contained to AI principals.
- **T5.12b (this task)** — Identity's **non-credential** routes only: `registerPrincipal`,
  `transitionPrincipal`, `governMachineIdentity`, `suspendMachineIdentity` (4 routes). Principal/
  machine-identity lifecycle, not credential material.
- T5.12c (later) — **Credentials**, combined from two files: Identity's `issueCredential`/
  `rotateCredential`/`revokeCredential` (3 routes) + all of Secrets (`rotation-schedule`/
  `rotate-due`/`emergency-revoke`, 3 routes) = 6 routes. This is the plan's "credential rotation"
  category — dispatched after this task, not before.
- T5.12d (later) — Operations (9 write routes: incidents + threat-indicators + compliance). This
  is the plan's "incident triage" category.
- T5.12e (later) — Sessions & Authentication (the whole file, ~17 write routes, including
  `revokeSession`/`revokeAllSessions`). This is the plan's "session revocation" category — the
  single largest remaining file.
- T5.12f (last) — Authorization (~18 write routes: roles, policies, ReBAC relations, delegations,
  impersonation, tenant security profile). This is the plan's "policy definition" category, the
  single most powerful/sensitive surface in the product (includes `startImpersonation`) — dispatch
  strictly last.

## Routes — `apps/admin/src/http/security-identity-routes.ts` (read it yourself for exact zod
bodies — the file is short, ~214 lines; do not guess field names)

| Route | Method | Permission | Idempotent |
| --- | --- | --- | --- |
| `/security/principals` (register) | POST | `security:register_principal` | yes |
| `/security/principals/:externalId/transitions` | POST | `security:transition_principal` | yes |
| `/security/machine-identities/:externalId` (govern) | POST | `security:govern_machine_identity` | yes |
| `/security/machine-identities/:externalId/suspend` | POST | `security:suspend_machine_identity` | yes |

`registerPrincipalBody`'s `kind` enum has 8 values (`human`/`service_account`/`machine`/`api_key`/
`robot`/`partner`/`marketplace`/`ai`) — render as a `<select>`. `transitionPrincipalBody`'s `to`
enum is `suspended`/`active`/`disabled` — read
`services/security/.../principal-status.ts`-equivalent (find the actual file) for the real
transition table rather than assuming all 3-choose-3 transitions are legal; copy it as UI-only
data per every prior Phase 5 lifecycle-table task, or if no such table exists in the domain (some
of this Security bounded context may validate transitions differently — check), gate conservatively
and let a backend rejection surface as a normal form error.

`governMachineIdentityBody`'s nested `config` object has 6 optional fields
(`owner`/`purpose`/`allowedEnvironments`/`maxCredentialTtlSeconds`/`rotationIntervalDays`/
`allowedScopes`) — render each directly, it's a fixed shape, not a `Record<string,string>`.

## What to build

1. `apps/admin-web/src/lib/api/security.ts` (existing, append) — 4 typed mutate functions:
   `registerPrincipal`, `transitionPrincipal`, `governMachineIdentity`, `suspendMachineIdentity`.
   Check each `admin.securityIdentity.*` handler for whether its response maps through a DTO;
   if not, use the `isUnknown` pattern like most Phase 5 write routes.
2. `apps/admin-web/src/app/security/identity/page.tsx` (existing, read first) — add: a "Register
   principal" form, a per-principal "Transition" control (needs `externalId` — check whether
   `IdentityOverviewDto`'s rows expose it for per-row attachment; if not, a standalone form with a
   manual id field), a "Govern machine identity" form, a per-machine-identity "Suspend" button
   (kill-switch — confirm before submit).
3. Every new string in both `messages/en.ts` and `messages/ar.ts`. No nav/middleware changes
   needed (already under `/security`, `admin`-gated).

## Global constraints (every Phase 5 task, security tasks especially)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire.
3. Never fabricate data — including the principal-status transition table; read it or gate
   conservatively, don't guess.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Do NOT tick T5.12's checkbox yourself — 4 more parts remain after this one.
8. One `Idempotency-Key` per user-initiated submit.
9. Never call the runtime API from browser JS.
10. Every write control is `admin`-only (already enforced by the existing `/security` middleware
    entry and each route's own `permission`) — do not weaken either. Kill-switch actions
    (`suspend`) must be confirmed before submit.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.12b-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
