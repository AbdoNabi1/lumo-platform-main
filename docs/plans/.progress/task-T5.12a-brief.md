# Task T5.12a brief — Security write actions: AI Governance

Part 1 of 6 covering T5.12 (57 routes across 6 files, revised into 6 risk-ordered parts — see
`docs/plans/.progress/task-T5.12b-brief.md`'s "Revised split" section for the full breakdown and
why). This is deliberately the smallest, lowest-blast-radius part, dispatched first. T5.12's own
checkbox is ticked only after all 6 parts land — do not tick it yourself.

**Correction:** an earlier draft of this brief also included the Secrets file
(`security-secrets-routes.ts`). That was wrong — Secrets is credential-rotation machinery, which
the plan explicitly says to add **last**. Secrets now belongs to T5.12c ("Credentials"), dispatched
later. This task covers **AI Governance only**.

Same write-screen recipe as every prior Phase 5 task (`apps/admin-web/README.md`). Phase 3 (T3.1)
already built the read-only Security Console, including
`apps/admin-web/src/app/security/ai-governance/page.tsx`. This task **adds write forms to that
existing screen** — read it fully first, match its existing structure/imports/`AppShell` usage.

## Routes — `apps/admin/src/http/security-ai-governance-routes.ts` (read in full, verbatim below)

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/security/ai-identities/:externalId` (govern) | POST | `security:govern_ai_identity` | yes | `{ config: { tokenBudget?: int().min(0) \| null, callQuota?: int().min(0) \| null, windowSeconds?: int().positive(), allowedTools?: string[], allowedResources?: string[], isolationLevel?: "none"\|"sandboxed"\|"isolated" } }` — idempotent create-or-patch |
| `/security/ai-identities/:externalId/suspend` | POST | `security:suspend_ai_identity` | yes | none — a kill-switch, confirm before submit |
| `/security/ai-identities/:externalId/actions/check` | POST | `security:check_ai_action` | **no** | `{ tool?: string, resource?: string, tokens?: int().min(0), calls?: int().min(0) }` — this is a **simulation/check** tool ("the AI action gate — checks... in one call"), not a mutation with lasting effect; treat it like T5.8's promotion-evaluate — a "try it" panel whose result is a read/preview, not something to `revalidatePath` |

`security/console/ai-governance-explorer` (GET) is already wired read-only — do not touch it.

## What to build

1. `apps/admin-web/src/lib/api/security.ts` (existing, large file — append, do not restructure) —
   add typed mutate functions: `governAiIdentity`, `suspendAiIdentity`, `checkAiAction`. Check each
   `admin.securityAiGovernance.*` handler for whether its response maps through a DTO; if not, use
   the established `isUnknown` pattern (read nothing off the response beyond success).
2. `apps/admin-web/src/app/security/ai-governance/page.tsx` — add: a "Govern AI identity" form
   (externalId + the 6 named `config` fields, rendered directly — most are optional, this is a
   fixed shape, not a `Record<string,string>`), a per-identity "Suspend" button (needs
   `externalId` — check whether `AiGovernanceExplorerDto`'s rows expose it for per-row attachment;
   if not, a standalone form with a manual id field, confirmed before submit), and a "Check AI
   action" simulation panel (per the ruling above — a preview tool, not a mutation).
3. Every new string in both `messages/en.ts` and `messages/ar.ts`. No navigation/middleware changes
   needed — already under `/security`, already `admin`-gated (verify the existing
   `["/security", "admin"]` middleware entry is still there, don't lower it).

## Global constraints (every Phase 5 task, security tasks especially)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire.
3. Never fabricate data — if a route's response can't be safely typed, use `isUnknown`, don't guess
   a shape.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Do NOT tick T5.12's checkbox yourself — 5 more parts remain after this one. Note in your report
   that your part (AI Governance) is complete.
8. One `Idempotency-Key` per user-initiated submit, regardless of the route's own `idempotent`
   flag.
9. Never call the runtime API from browser JS.
10. This is a security-admin surface — every write control here is `admin`-only (already enforced
    by `middleware.ts`'s existing `/security` entry and by each route's own `permission`). Do not
    weaken either. The kill-switch action (`suspend`) must be confirmed before submit (a
    `window.confirm` or equivalent, matching `ProductLifecycleActions`' T5.1 precedent for
    archive/delete).

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.12a-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
