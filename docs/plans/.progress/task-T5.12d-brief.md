# Task T5.12d brief — Security write actions: Operations (incident triage tier)

Part 4 of 6 covering T5.12. See `docs/plans/.progress/task-T5.12b-brief.md`'s "Revised split"
section for the full 6-part breakdown. This part is the plan's explicit **"incident triage"**
high-blast-radius category — dispatch only after T5.12a/b/c have landed. T5.12's own checkbox is
ticked only after all 6 parts land — do not tick it yourself.

Same write-screen recipe as every prior Phase 5 task. Extends the existing
`apps/admin-web/src/app/security/audit/page.tsx` (Phase 3 T3.1, read-only — this is where the
incident explorer lives, grouped with audit per T3.1's own screen-grouping table) and
`apps/admin-web/src/lib/api/security.ts`. **Read the existing page fully first.**

## Routes — `apps/admin/src/http/security-operations-routes.ts` (read in full, verbatim below)

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/security/incidents` (open) | POST | `security:open_incident` | yes | `{ title: string.min(1), severity: "low"\|"medium"\|"high"\|"critical", category: string.min(1), reference?: string.min(1), tenantRef?: string.min(1) \| null }` |
| `/security/incidents/:reference/triage` | POST | `security:triage_incident` | yes | `{ assignee: string.min(1), note: string.min(1) }` — this is literally "incident triage" |
| `/security/incidents/:reference/mitigate` | POST | `security:mitigate_incident` | yes | `{ note: string.min(1) }` |
| `/security/incidents/:reference/resolve` | POST | `security:resolve_incident` | yes | `{ resolution: string.min(1) }` |
| `/security/incidents/:reference/close` | POST | `security:close_incident` | yes | `{ note: string.min(1) }` |
| `/security/incidents/:reference/evidence` (add) | POST | `security:add_incident_evidence` | **no** | `{ kind: string.min(1), ref: string.min(1) }` |
| `/security/threat-indicators/check` | POST | `security:check_threat_indicator` | **no** | `{ indicator: string.min(1) }` — a lookup/simulation tool, not a mutation; treat like T5.12a's `checkAiAction` (a "try it" preview panel, no `revalidatePath`) |
| `/security/compliance/evaluate` | POST | `security:evaluate_compliance` | **no** | `{ framework: "gdpr"\|"soc2"\|"iso27001"\|"hipaa"\|"pci_dss", tenantRef?: string.min(1) \| null, attestations?: { encryptionAtRest?, consentTracked?, retentionDefined?: boolean } }` — also a read/evaluation tool, not a mutation |
| `/security/compliance/rules` (register) | POST | `security:register_compliance_rule` | yes | `{ id: string.min(1), framework: (same enum), description: string.min(1), severity: "low"\|"medium"\|"high"\|"critical" }` |

`security/audit-chain/verify`, `security/console/incident-explorer`, `security/console/
audit-explorer`, `security/console/dashboard`, `security/console/trust-center`, `security/console/
analytics` (all GET) are already wired read-only — do not touch them.

An incident's lifecycle (open → triage → mitigate → resolve → close, evidence attachable
throughout) is implied by the 5 dedicated action routes above, one per named step — there is no
separate generic "advance" route for incidents, so no transition-table lookup is needed here: gate
each dedicated action's availability by reading the incident's actual current status off whatever
DTO the incident explorer/console returns (check `IncidentExplorerDto`'s shape in
`lib/api/security.ts`), offering only the one action that represents "the next step" (or none, at
a terminal `closed` state) — same one-action-per-status discipline T5.3's returns screen
established, just without a formal transition table to consult since the route names already are
the states.

## What to build

1. `apps/admin-web/src/lib/api/security.ts` (existing, append) — 9 typed mutate functions:
   `openIncident`, `triageIncident`, `mitigateIncident`, `resolveIncident`, `closeIncident`,
   `addIncidentEvidence`, `checkThreatIndicator`, `evaluateCompliance`, `registerComplianceRule`.
   Check each handler for DTO mapping; default to `isUnknown` if unmapped.
2. `apps/admin-web/src/app/security/audit/page.tsx` — add: an "Open incident" form, per-incident
   triage/mitigate/resolve/close controls gated by current status (per above — check
   `IncidentExplorerDto` for a `status`/`reference` per row to attach these to; if the console read
   model doesn't expose enough per-incident detail for this, add the controls as a standalone
   "manage incident by reference" mini-form section instead of per-row, and note the limitation in
   your report rather than guessing at fields that don't exist), an "add evidence" form, a "check
   threat indicator" simulation panel, a "compliance evaluate" simulation panel, and a "register
   compliance rule" form.
3. Every new string in both `messages/en.ts` and `messages/ar.ts`. No nav/middleware changes
   needed.

## Global constraints (every Phase 5 task, security tasks especially)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire.
3. Never fabricate data — including inventing incident-status fields that aren't actually on the
   DTO; if the console read model can't support per-row gating, say so in your report rather than
   guessing.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Do NOT tick T5.12's checkbox yourself — 2 more parts remain after this one.
8. One `Idempotency-Key` per user-initiated submit, regardless of the route's own `idempotent`
   flag.
9. Never call the runtime API from browser JS.
10. Every write control is `admin`-only. This part is the plan's named "incident triage"
    high-blast-radius category — the actions themselves are lower-risk individually than
    credential/session/policy controls (they're workflow steps on an incident record, not
    account-takeover-adjacent), but keep the same confirmation discipline for `close` (a
    terminal, hard-to-undo state).

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.12d-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
