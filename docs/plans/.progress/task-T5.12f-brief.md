# Task T5.12f brief — Security write actions: Authorization (policy definition tier — LAST)

Part 6 of 6, the FINAL part of T5.12. See `docs/plans/.progress/task-T5.12b-brief.md`'s "Revised
split" section. This is the plan's explicit **"policy definition"** category, and the single most
powerful/sensitive surface in the entire admin product (it includes granting delegated
impersonation of other principals). **Dispatch this only after T5.12a through T5.12e have all
landed and been independently verified.** Once this part lands and verifies clean, you (the
implementer) SHOULD tick T5.12's own checkbox in `docs/plans/PHASE-5-6-backlog.md` — the line is
`- [ ] **T5.12 Security write actions.**` — since this is genuinely the last of the 6 parts (same
pattern T5.9c used to close out T5.9).

Same write-screen recipe as every prior Phase 5 task. Extends the existing
`apps/admin-web/src/app/security/access/page.tsx` (Phase 3 T3.1, read-only) and
`apps/admin-web/src/lib/api/security.ts`. **Read the existing page fully first**, and read
`apps/admin/src/http/security-authorization-routes.ts` in full yourself (421 lines, the largest
route file in the codebase) — this brief summarizes it; the file itself is the authority for exact
zod shapes, including two fields (`when`/`expr` on policy rules, `expression` on policy fragments,
`abac` on access checks) typed `z.unknown()` in the backend because they're a recursive
expression-language type validated by the domain layer, not by zod — render these as raw JSON
textareas (same technique T5.9c's Component Library `defaults` field used), not a structured
editor.

## Routes — grouped by sub-area, all in `security-authorization-routes.ts`

**Roles:**
- `POST /security/roles` (define) — `security:define_role`, idempotent per key
- `POST /security/roles/:roleKey/permissions` (grant) — `security:grant_role_permission`,
  idempotent
- `POST /security/role-assignments` (assign) — `security:assign_role`, idempotent — body includes
  `grantedBy` (audit actor, same pattern as T5.11a's notification-callback `changedBy` fields —
  pre-fill from the current admin user if available)
- `POST /security/role-assignments/:assignmentId/revoke` — `security:revoke_role_assignment`,
  idempotent. Confirm before submit.

**Policies (the core "policy definition" controls):**
- `POST /security/policies` (define) — `security:define_policy`, idempotent per key, starts draft
- `POST /security/policies/:policyKey/versions` (publish) — `security:publish_policy_version`,
  idempotent. "Publish a new immutable policy version and activate it" — **this is a live-traffic
  policy change; confirm before submit, and display the policy key prominently in the
  confirmation.** `rules` is an array of `{id, description, when: unknown, expr?: unknown, effect}`
  — render `when`/`expr` as raw JSON per the note above.
- `POST /security/policies/:policyKey/archive` — `security:archive_policy`, idempotent
- `POST /security/policies/:policyKey/simulate` — `security:simulate_policy`, not idempotent,
  explicitly "(read-only)" per its summary — a preview/dry-run panel, no `revalidatePath`.

**ReBAC relations:**
- `POST /security/relations` (write tuple) — `security:write_relation_tuple`, idempotent
- `POST /security/relations/delete` — `security:delete_relation_tuple`, idempotent (same body
  shape as write — `{namespace, object, relation, subject}` identifies the tuple to remove)

**Access checks (read-only tools, not mutations):**
- `POST /security/access/check` — `security:check_access`, not idempotent, "unified authorization
  check across RBAC, ReBAC, and ABAC" — preview panel.
- `POST /security/access/evaluate` — `security:evaluate_access`, not idempotent, "the platform's
  single authorization entry point" — preview panel, same treatment.

**Registries:**
- `POST /security/policy-fragments` (register) — `security:register_policy_fragment`, idempotent
  — `expression` is `unknown`, raw JSON textarea per the note above
- `POST /security/permissions` (register) — `security:register_permission`, idempotent

**Delegations & impersonation (the second-highest-risk group in this part, after policy
publishing):**
- `POST /security/delegations` (grant) — `security:grant_delegation`, idempotent — "one principal
  may act as another, time-boxed"
- `POST /security/delegations/:delegationId/revoke` — `security:revoke_delegation`, idempotent.
  Confirm before submit.
- `POST /security/delegations/:delegationId/impersonate` (start) —
  `security:start_impersonation`, idempotent. **The single highest-risk individual action in this
  entire phase — starting an impersonation session lets one principal act as another.** Render
  with an unmistakable, explicit confirmation naming both the delegator and delegate, and consider
  (your judgment) whether this belongs behind an extra "type the delegation id to confirm"
  friction step, similar to how destructive cloud-console actions gate irreversible operations —
  at minimum, do not let this be a single unconfirmed button click.

**Tenant security:**
- `POST /security/tenants/:tenantRef/security-profile` (configure) —
  `security:configure_tenant_security`, idempotent create-or-patch

`security/consent/:subjectRef` (GET), `security/console/permission-explorer`, `.../policy-explorer`,
`.../registry-explorer` (all GET) are already wired read-only — do not touch them.

## What to build

1. `apps/admin-web/src/lib/api/security.ts` (existing, append) — one typed mutate function per
   write route above (18 total), following the established `isUnknown`-unless-DTO-mapped pattern.
2. `apps/admin-web/src/app/security/access/page.tsx` — organize into sub-sections (Roles /
   Policies / Relations / Access Checks / Registries / Delegations / Tenant Security), same
   long-page-with-clear-headings approach as T5.12e. This is the largest single screen in the
   whole phase — that's expected, do not artificially fragment it.
3. Every new string in both `messages/en.ts` and `messages/ar.ts`. No nav/middleware changes
   needed.

## Global constraints (every Phase 5 task, security tasks especially)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire.
3. Never fabricate data — including for the `unknown`-typed policy expression fields; a raw JSON
   textarea validated for well-formedness client-side (malformed JSON blocks submission) and
   re-validated server-side is correct here, do not invent a structured policy-rule editor.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. **This is the last of T5.12's 6 parts** — once your own verification passes clean, tick T5.12's
   checkbox (`- [ ] **T5.12 Security write actions.**` → `- [x] ...`) in
   `docs/plans/PHASE-5-6-backlog.md`.
8. One `Idempotency-Key` per user-initiated submit, regardless of the route's own `idempotent`
   flag.
9. Never call the runtime API from browser JS.
10. Every write control is `admin`-only. **This part is the plan's named "policy definition"
    high-blast-radius category, and contains the single riskiest action in this phase
    (`start_impersonation`).** Every destructive or high-consequence action (`revoke-role-
    assignment`, `publish-policy-version`, `revoke-delegation`, `start-impersonation`) must be
    confirmed before submit, with `start-impersonation`'s confirmation being maximally explicit
    per the note above.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.12f-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
