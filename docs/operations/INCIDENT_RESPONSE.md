# Incident Response Guide

> How to run an incident from detection to post-mortem. Pairs with the alert-specific
> [RUNBOOKS](RUNBOOKS.md) (what to _do_) — this doc is the _process_ around them.

## Severity classification

| Sev      | Definition                                                       | Examples                                       | Response                                        |
| -------- | ---------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| **SEV1** | customer-facing outage / data-integrity / active security breach | API down, DB corruption, credential compromise | page immediately, incident commander, all-hands |
| **SEV2** | major degradation, SLO at risk                                   | fast error-budget burn, dependency down        | page on-call                                    |
| **SEV3** | minor / contained                                                | slow burn, single-topic dead-lettering         | ticket, business hours                          |

Security incidents (breach, data exposure) are **always SEV1/SEV2** and additionally follow the
containment path below.

## Roles

- **Incident Commander (IC)** — owns coordination and decisions; not hands-on-keyboard.
- **Ops lead** — drives mitigation using the runbooks.
- **Comms** — stakeholder + status-page updates.
- **Scribe** — timestamped timeline in the incident channel.

## Flow

1. **Detect** — alert (Alertmanager → on-call), report, or dashboard.
2. **Triage** — assign severity; open an incident channel; IC takes command.
3. **Mitigate** — restore service first (roll back, scale, fail over) using the matching
   [runbook](RUNBOOKS.md). Prefer reversible mitigations.
4. **Communicate** — update stakeholders at a fixed cadence (SEV1: every 30 min).
5. **Resolve** — confirm SLIs recovered and alerts cleared; downgrade/close.
6. **Learn** — blameless post-mortem within 3 business days.

## Security containment (breach / suspected compromise)

1. **Contain** — revoke suspect credentials/sessions; rotate affected keys/secrets
   ([BACKUP_AND_RECOVERY §key rotation](BACKUP_AND_RECOVERY.md#key-rotation)); the security context
   provides step-up/lockout and the WORM audit trail.
2. **Preserve evidence** — the WORM audit log is append-only and tamper-evident; do **not** purge it.
   Snapshot relevant logs/traces.
3. **Eradicate & recover** — remove the vector, patch, restore from a known-good state if integrity is
   in doubt ([database-recovery](BACKUP_AND_RECOVERY.md#database-recovery)).
4. **Notify** — follow legal/compliance obligations (the security context tracks compliance
   evidence). Notification is a **human decision**, never automated by the platform.

## Communication templates

**Initial (SEV1/2):** `⛑ [SEVx] <title> — impact: <who/what>. Investigating. Next update <time>. IC: <name>.`
**Resolved:** `✅ [SEVx] <title> resolved at <time>. Cause: <one line>. Post-mortem to follow.`

## Post-mortem (blameless)

Capture: timeline, impact (users, duration, budget spent), root cause, what went well/poorly, and
**action items with owners + due dates**. Feed durable fixes back into runbooks, alerts, and tests.
