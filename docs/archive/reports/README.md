# Archived Phase Reports

Historical audit trail. Every file here is **superseded** — its findings were
either closed and re-verified by a later phase, or rolled up into a report that
is still in the repository root. Nothing here was deleted; it was moved out of
the root so the root shows only the reports that still describe current state.

Phases A.35, A.36 and A.40 each audited these files for deletion and each
concluded "keep — historical audit trail". This archive respects that: it
relocates, it does not remove.

## Still current (kept in the repository root)

| Report                                                              | Why it is still live                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `PHASE_A43_VERCEL_SUPABASE_PRISMA_PRODUCTION_PREPARATION_REPORT.md` | Latest state — Vercel/Supabase/Prisma preparation                           |
| `PHASE_A42_SUPABASE_PRISMA_INTEGRATION_AUDIT_REPORT.md`             | Data-layer map: 35 migrations, zero destructive ops, zero committed secrets |
| `PHASE_A41_STAGING_KUBERNETES_PRE_PRODUCTION_FREEZE_REPORT.md`      | Open blocker — no Kubernetes cluster available                              |
| `PHASE_A39_DOCKER_RUNTIME_UNBLOCK_AND_PRODUCTION_SMOKE_REPORT.md`   | Open blocker — root cause of the Docker/WSL2 failure                        |
| `PHASE_A38_RUNTIME_RECOVERY_PRODUCTION_SMOKE_TEST_REPORT.md`        | The live checks still outstanding                                           |
| `PHASE_A37_*`, `PHASE_A36_*`, `PHASE_A35_*`                         | Most recent build-recovery and cleanup audits                               |
| `PHASE_A34_PRODUCTION_REMEDIATION_REPORT.md`                        | Closure of the 10 P0 blockers; in-cluster deployment decision               |
| `PHASE_A33_PRODUCTION_READINESS_REPORT.md`                          | Source of those blockers                                                    |
| `PHASE_A32_AUTHENTICATION_RECOVERY_REPORT.md`                       | How Hydra/Kratos/Keto were recovered                                        |
| `PHASE_A21_POSTGRESQL_SCHEMA_DRIFT_REMEDIATION_REPORT.md`           | Final word on schema drift                                                  |

For a rolled-up view prefer `docs/PROJECT_STATE.md` and `docs/KNOWN_GAPS.md`
over reading any individual report below.

## What is in here

**Per-context inventories (31 files)** — `P1_5_*_REPORT.md`. One short
inventory per bounded context. Superseded by the service-level reports and by
`docs/architecture/`.

**Severity remediation chains** — `CRITICAL_1..6`, `HIGH_01..09`,
`HIGH_FINDINGS_SUMMARY`, `V1_*`, `M2_2..M2_7`, `MEDIUM_*`,
`PRODUCTION_REMEDIATION_SUMMARY`. All findings closed; closure independently
re-verified in `POST_CRITICAL_VERIFICATION_REPORT.md` and
`MEDIUM_VERIFICATION_REPORT.md` (both archived here).

**Release-candidate audits** — `RC_AUDIT_*`, `RC_VALIDATION_REPORT`,
`FINAL_PRODUCTION_READINESS_AUDIT.md` and its `_v2`, superseded by
`FINAL_PRODUCTION_READINESS_REPORT.md` (also archived — its "READY FOR RC"
verdict predates the A.32-A.43 findings and should not be quoted as current).

**Payments and transaction-boundary phases** — `PHASE_A5` through `PHASE_A30`.
The refund/capture idempotency, transaction-boundary and PostgreSQL hardening
work. All closed; the surviving conclusion is in `PHASE_A21` (kept in root).

**Milestone and integration reports** — `C2_2_REPORT`, `CUSTOMER_360_*`,
`E1_COLLECTOR_*`, `INTEGRATION_*`, `K7_*`, `TRACKING_COMPATIBILITY_REPORT`,
`COMPOSITION_SURFACE_RECONCILIATION_REPORT`, `RUNTIME_*`, `UI_RECOVERY_PLAN`,
`FINAL_RECOVERABLE_SUBSYSTEMS_DECLARATION`, `PHASE_A29_COMMIT_PLAN`.

## Reading a report from here

Verdicts in these files describe the state **at the time they were written**.
Several say "CONDITIONALLY PRODUCTION READY"; that predates Phase A.38/A.39/A.41
establishing that no live authentication path has ever been verified. Treat any
readiness verdict in this directory as historical, not as a current claim.
