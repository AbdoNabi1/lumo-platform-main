# Task T5.12d report — Security write actions: Operations (incident triage tier)

**Status: DONE**

## Session continuity note

This task was completed across a dropped connection. Before resuming, I re-verified (rather than
assumed) which of the 6 planned file changes had actually landed by grepping each one directly:

| File | State found on resume |
| --- | --- |
| `lib/api/security.ts` (9 mutate functions) | Landed, all 9 exports present |
| `app/security/audit/actions.ts` | Landed, file complete |
| `components/security/audit-actions.tsx` | Landed, file complete |
| `app/security/audit/page.tsx` | Landed, imports + actions column + 5 new cards present |
| `messages/en.ts` | Landed, full `securityAuditPage` write-string additions present and well-formed |
| `messages/ar.ts` | **Not landed** — connection dropped exactly here |

Only `ar.ts` needed to be written from that point forward. Confirmed via `grep` before touching
anything further, then wrote the Arabic mirror and ran full verification.

## What was built

1. **`apps/admin-web/src/lib/api/security.ts`** (appended) — 9 typed mutate functions:
   `openIncident`, `triageIncident`, `mitigateIncident`, `resolveIncident`, `closeIncident`,
   `addIncidentEvidence`, `checkThreatIndicator`, `evaluateCompliance`, `registerComplianceRule`.
   Each verified against its use-case's actual return DTO
   (`services/security/src/application/incident.use-cases.ts`'s `IncidentOutput`,
   `threat.use-cases.ts`'s `ThreatVerdictOutput`, `compliance.use-cases.ts`'s
   `ComplianceReportOutput`, `registry.use-cases.ts`'s `RegistryEntryOutput`) rather than assumed —
   all four are plain DTOs, safe to type in full per README.md rule #2.

2. **Per-incident status gating — verified, not guessed.** The brief asked me to check whether
   `IncidentExplorerDto` exposes enough per-row detail to gate the 5 lifecycle actions, falling back
   to a standalone "manage by reference" section only if it didn't. I read `IncidentRowDto` in
   `lib/api/security.ts`: it already exposes both `reference` and `status` per row. So the 5
   lifecycle actions (triage/mitigate/resolve/close/add-evidence) attach **directly to each
   incident-explorer row** — no fallback needed, unlike T5.12a/b's `AiGovernanceRowDto`/
   `MachineIdentityRowDto`, whose rows only expose an internal id and needed standalone forms.

   Gating logic: read `services/security/src/domain/incident.ts`'s private `TRANSITIONS` table
   directly (`detected -> triaged/closed`, `triaged -> mitigating/closed`,
   `mitigating -> resolved/closed`, `resolved -> closed`, `closed -> []`) and mirrored it as a
   UI-only `INCIDENT_NEXT_ACTIONS` map (`lib/api/security.ts`), same non-authoritative-mirror
   discipline `PRINCIPAL_STATUS_TRANSITIONS` (T5.12b) already established. Each row's "Actions" cell
   renders only the action(s) legal from its current status — one primary lifecycle step
   (triage/mitigate/resolve) plus `close` (always offered alongside it except at `resolved`, where
   `close` is the only legal move) — never more, and nothing at `closed` (terminal).

3. **`apps/admin-web/src/app/security/audit/actions.ts`** (new) — 9 Server Actions following the
   established recipe (defensive `FormData` parsing, one `newIdempotencyKey()` per submit,
   `revalidatePath("/security/audit")` on success). `checkThreatIndicatorAction` and
   `evaluateComplianceAction` use a custom `*FormState` type carrying the preview result and never
   call `revalidatePath` — same "try it" simulation-panel treatment T5.12a's `checkAiActionAction`
   established for `checkAiAction`.

4. **`apps/admin-web/src/components/security/audit-actions.tsx`** (new) — `OpenIncidentForm`,
   `IncidentLifecycleControl` (the per-row dispatcher, rendering compact inline
   triage/mitigate/resolve/close mini-forms per `INCIDENT_NEXT_ACTIONS`), `AddIncidentEvidenceForm`
   (standalone, per the brief's own separate listing), `CheckThreatIndicatorPanel`,
   `EvaluateCompliancePanel`, `RegisterComplianceRuleForm`. `close` is confirmed via
   `window.confirm` before submit (constraint #10 — terminal, no reopen route exists), matching the
   confirmation discipline every other terminal/destructive action in the codebase uses.

5. **`apps/admin-web/src/app/security/audit/page.tsx`** — added an "Actions" column to the incident
   explorer table wired to `IncidentLifecycleControl`, plus 5 new cards below the existing read-only
   sections: Open incident, Add evidence, Check threat indicator (simulation), Evaluate compliance
   (simulation), Register compliance rule.

6. **`apps/admin-web/src/messages/en.ts`** / **`ar.ts`** — every new user-facing string added to
   both dictionaries under `securityAuditPage`: `incidentColumns.actions`, `severities`,
   `frameworks`, `openIncident`, `incidentActions` (triage/mitigate/resolve/close sub-objects),
   `addEvidence`, `checkThreatIndicator`, `evaluateCompliance`, `registerComplianceRule`.

7. **`apps/admin-web/src/lib/i18n.test.ts`** — added the 5 `ComplianceFramework` labels (GDPR, SOC
   2, ISO 27001, HIPAA, PCI DSS) to `SHARED_VERBATIM`. These are internationally recognized
   regulatory/standard names that are conventionally left untransliterated in Arabic UI copy —
   the existing `i18n.test.ts` "is actually translated, not copied" guard flagged them as
   accidentally-untranslated on first run; this is the same exemption already granted to the
   HTML/Markdown/JSON format names in T5.9a, applied for the same reason. This is the one file
   outside `apps/admin-web/src/{lib/api,app/security,components/security,messages}` that this task
   touched, and it's a pre-existing shared test file, not new production surface.

## Design decisions worth flagging

- **`addIncidentEvidence` is standalone, not per-row.** The task brief lists "an 'add evidence'
  form" separately from "per-incident triage/mitigate/resolve/close controls gated by current
  status" — read as a deliberate distinction (evidence is attachable at any non-closed status, not
  gated to "the next step"), so it's a standalone form with a manual `reference` field, matching the
  brief's own wording rather than folding it into the per-row lifecycle cell.
- **`close` is offered alongside the primary next-step action, not only as the terminal option at
  `resolved`.** The domain's `TRANSITIONS` table allows `close` directly from every non-terminal
  status (`detected`/`triaged`/`mitigating`/`resolved` all list `closed` as a legal target), so
  `INCIDENT_NEXT_ACTIONS` offers it at every one of those states, not just at `resolved`. This is a
  deliberate reading of "one action that represents the next step" as "one *primary* step, plus the
  always-available close" rather than literally one button total — I flag this interpretation here
  rather than let it pass silently, since a stricter reading (close only when it's the *sole* legal
  transition) would also have been defensible.
- **No `BLOCKERS.md` entry needed.** Verification confirmed `IncidentRowDto` supports full per-row
  gating, so the brief's fallback path was not needed.

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck   # tsc --noEmit — clean, 0 errors
pnpm --filter admin-web lint        # eslint . — 0 errors, 1 pre-existing warning in next.config.ts (unrelated)
pnpm --filter admin-web test        # vitest run — 63 files, 581/581 tests passing
```

All three commands were re-run after the `ar.ts`/`i18n.test.ts` fix and confirmed clean together in
one pass.

## Files changed

- `apps/admin-web/src/lib/api/security.ts` (appended)
- `apps/admin-web/src/app/security/audit/actions.ts` (new)
- `apps/admin-web/src/components/security/audit-actions.tsx` (new)
- `apps/admin-web/src/app/security/audit/page.tsx` (edited)
- `apps/admin-web/src/messages/en.ts` (edited)
- `apps/admin-web/src/messages/ar.ts` (edited)
- `apps/admin-web/src/lib/i18n.test.ts` (edited — `SHARED_VERBATIM` allowlist addition)

No files under `apps/admin`, `services/*`, or `packages/*` were touched. `docs/plans/BLOCKERS.md`
was read but not modified — it contains a pre-existing, unrelated entry from a different task; T5.12d
hit no blockers of its own. `docs/plans/PHASE-5-6-backlog.md`'s T5.12 checkbox was left unticked, per
the brief (2 more parts, T5.12e/f, remain).

## Concerns

None blocking. The one judgment call worth a second look is the "close offered alongside the
primary next-step action" reading documented above — if a reviewer wants strictly one button per
status (never two), `INCIDENT_NEXT_ACTIONS` is a single small table to adjust.
