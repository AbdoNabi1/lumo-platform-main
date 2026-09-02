# Phase A.26 — Final Production Release Gate & Security Closure

**Date:** 2026-08-15 · **Scope:** Close the final release gate opened by A.21→A.25. Verify the exposed
pgAdmin credential, audit backup/CDC/Docker/coverage operational readiness, run every quality gate fresh,
and issue a final GO / CONDITIONAL GO / NO-GO verdict. No architecture changes, no new bounded contexts,
no destructive operations, nothing committed or pushed.

**Every finding below has a command, a file path, or a live re-run behind it in this session. Nothing is
carried forward from A.25 without being independently re-verified.**

---

## 1. Executive summary

The pgAdmin credential A.25 flagged as "currently exposed, not merely historical" is **still exposed,
unchanged, on `HEAD` and `origin/main` right now** — the working-tree fix exists but was never committed.
That alone forces **NO-GO**. Every other gate this phase re-verified is green or materially unchanged from
A.25: zero schema drift (independently re-derived against a fresh disposable database, not reused from
A.25's run), 2,385 tests passed / 31 skipped / 0 failed across 78 packages (0 cache hits), typecheck/lint/arch
all clean, and a live Docker Desktop crash was hit and recovered mid-session using exactly the documented
A.19/A.25 procedure — independent proof that runbook is accurate and repeatable, not just narrative.

## 2. A.21 → A.25 evidence summary (carried forward, not re-litigated)

Per `PHASE_A25_FINAL_PRODUCTION_GO_REPORT.md`: live PostgreSQL backup→restore→verify chain proven; CDC
watchdog proven against real Kafka Connect/Debezium including a real ~7h outage with zero event loss;
10/60 CDC stress trials run (documented shortfall, not fabricated); 691 legacy regression tests passed
twice; 3 full infrastructure restart cycles with 0 drift; schema fingerprint 0 real drift; Finance,
Licensing, Returns, Checkout given real-Postgres integration coverage for the first time (32 new tests),
surfacing and fixing two CRITICAL production bugs (composite-string ids written to `@db.Uuid` columns —
would have failed on the very first real write). Verdict at the time: **CONDITIONAL GO**, blocked on the
credential. This phase re-verifies every one of those claims rather than assuming they still hold.

---

## 3. Security status / credential exposure status

**Classification: CURRENTLY EXPOSED — not historical-only.**

| Check                                                                 | Result                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HEAD` (`1b4ff76`) `infrastructure/docker/docker-compose.yml:493-494` | Hardcoded real email + real password, unchanged since A.25                                                                                                                             |
| `origin/main`                                                         | Identical SHA to `HEAD` (`1b4ff76`) — `git log origin/main..main` is empty                                                                                                             |
| GitHub repo visibility                                                | **Public** (`AbdoNabi1/lumo-platform`, confirmed via GitHub API `"private": false`)                                                                                                    |
| Working tree                                                          | Clean — `${PGADMIN_DEFAULT_EMAIL:-admin@example.com}` / `${PGADMIN_DEFAULT_PASSWORD:-admin}`, **uncommitted**                                                                          |
| `.env`                                                                | Gitignored (`.gitignore:19-21`); not tracked; contains a _different_ email/password than the exposed value (rotated locally, hash-compared without printing either value)              |
| `.env.example`                                                        | Placeholders only                                                                                                                                                                      |
| Other tracked files at `HEAD`                                         | `git grep` for the exposed string: zero other occurrences                                                                                                                              |
| Git history                                                           | Value first appears 3 commits back (`f1336a5` per A.25; independently confirmed present in `3f2520e`, `ab3e466`, `de46df9`) and is unchanged through to `HEAD` — never rotated in-repo |
| Credential validity                                                   | Not tested (would require an unauthorized-style login attempt against a real credential — out of scope and not attempted)                                                              |

**Required user action (cannot be performed by this audit):**

1. **Rotate the real credential immediately**, and anywhere else it was reused — a real password has been sitting in a public GitHub repo's history for multiple commits.
2. **Commit and push the already-prepared working-tree fix** (env-var substitution, generic fallback) — this alone stops `HEAD`/`origin/main` from serving the hardcoded value to any future clone.
3. **Rewrite git history** (`git filter-repo`/BFG) to purge the secret from all reachable commits — destructive, needs explicit approval, not attempted here.
4. Consider a GitHub Support request to purge cached diff/PR views of the old blob, since a local history rewrite doesn't retroactively scrub GitHub's own caches or any existing forks.

The `PRODUCTION_CHECKLIST.md` security-hardening line already carried this exact finding from A.25's own
audit — re-verified accurate, left as-is (see §12).

---

## 4. Backup/restore status

The backup/restore **mechanism** is real and was proven end-to-end in A.25 (real `pg_dump`→verify→real
`pg_restore` into a disposable container, 0 errors, identical schema). This phase audited **operational**
readiness — i.e. whether it runs unattended — separately:

| Question                             | Answer                                                                                                 | Evidence                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scheduling (cron/K8s CronJob/Docker) | **NO**                                                                                                 | No `CronJob` manifest in `infrastructure/k8s/`; no scheduler service in `docker-compose.yml`; no scheduled GitHub Actions workflow (only `security.yml` has a `schedule:` trigger, and it's a weekly security scan, unrelated) |
| Storage location                     | Partial — local by default, S3 only if `BACKUP_S3_URI` is set                                          | `scripts/ops/backup-postgres.sh:37-43`                                                                                                                                                                                         |
| Retention                            | Logic exists, only runs on manual invocation                                                           | `backup-postgres.sh:46`, `find ... -mtime +${RETENTION_DAYS} -delete`                                                                                                                                                          |
| Checksum verification                | Automated _within_ the script, not independently scheduled                                             | `backup-postgres.sh:29-35`, `restore-postgres.sh:34-36`                                                                                                                                                                        |
| Restore verification                 | One-off manual (A.25's own drill), not scheduled                                                       | `OPERATIONS_GUIDE.md:84` lists it as a human quarterly calendar task                                                                                                                                                           |
| Runbook/ownership                    | Partial — role-based on-call ("DB on-call"), no dedicated backup-failure runbook entry, no named owner | `RUNBOOKS.md` has zero "backup" match                                                                                                                                                                                          |

`.env:65-69` is self-honest about this: `BACKUP_ENABLED=false`, with `BACKUP_SCHEDULE` present only as an
unused config value nothing reads.

**Gap classification: real mechanism, zero unattended automation.** High severity for a production
release, not a security blocker.

---

## 5. CDC status

Independently reviewed the watchdog implementation (not just the A.25 report narrative):

- **Watchdog logic — CONFIRMED real**, `apps/runtime/src/scheduler.ts:83-147` (`runCdcWatchdog`), restarts only `FAILED` tasks, enforces a rolling-window cap (`CDC_WATCHDOG_MAX_RESTARTS=5` / `CDC_WATCHDOG_RESTART_WINDOW_MS=3600000`, `apps/runtime/src/config.ts:39-47`). Unit-tested (`scheduler.test.ts`) for healthy/transient/FAILED/cap-reached cases.
- **Metrics — CONFIRMED**, real Prometheus gauges/counters (`apps/runtime/src/metrics.ts:99-109,244-256`), not just log lines.
- **Alerting — CONFIRMED**, `infrastructure/docker/prometheus/rules/alerts.rules.yml:96-120` defines `CdcConnectorTaskFailed` (pages after 3m) and `CdcWatchdogRestartCapReached` (pages immediately), both linked to the runbook entries added this phase (§7 below). This closes what earlier phases treated as a possible gap.
- **WAL retention — partially unbounded.** `wal_level=logical`, `max_wal_senders=8`, `max_replication_slots=8` are set (`docker-compose.yml:53-57`), but **no `max_slot_wal_keep_size` anywhere in the repo** — a stalled replication slot during a long outage can grow WAL without a configured cap. A.25's real ~7h outage is the only evidence at scale, and it didn't report resulting WAL size.
- **10/60 stress-trial gap — material but narrow, not broad.** The 10 trials covered quick self-healing restarts of each component individually and two simultaneous-restart combos; none exercised the watchdog's actual restart path repeatedly. The one real FAILED/restart/recovery scenario (the ~7h outage) was run once. Untested: repeated cap-exhaustion cycles, concurrent multi-connector failures, watchdog behavior when Kafka Connect itself is unreachable. Given the restart/cap logic is independently unit-tested and was proven once live, this is a **Medium**, not Critical, gap — consistent with A.25's own severity rating.

No new trials were fabricated or run this phase (would require inducing real outages against the newly-recovered live infra — out of the safe, non-destructive scope of this audit).

---

## 6. Docker status

A.19/A.25 root-caused a recurring Docker Desktop crash-loop to stale AF_UNIX socket reparse-point files
that no native Windows tool can delete (`Remove-Item`/`fsutil`/`takeown` all fail `ERROR_CANT_ACCESS_FILE`),
fixable only via WSL's Linux filesystem layer (`wsl -d Ubuntu-24.04 -- rm ...`) — and correctly identified
that the earlier "missing `docker-desktop-data` distro" theory (A.12/A.14) was wrong; this Docker Desktop
version only ever registers a single `docker-desktop` distro.

**This phase independently reproduced and fixed the exact same failure live**, not from documentation:
Docker Desktop was down at session start; `com.docker.backend.exe.log` showed the identical signature,
first on `dockerInference`, then — after one relaunch — on `docker-secrets-engine/engine.sock`. Cleared
both plus two more found by listing the whole `run/` directory in one pass (`dockerEthernetVfkit`,
`userAnalyticsOtlpHttp.sock`) rather than discovering them one crash at a time, then a clean relaunch
brought all 19 containers back up on their existing 5-week-old volumes — zero data loss, `lumo-postgres-1`
came back healthy, `prisma migrate status` → up to date. `lumo-hydra-1`/`lumo-kratos-1` are crash-looping
on restart, matching A.25's own pre-existing, unrelated, already-documented finding.

**Runbook:** no Docker/WSL2 recovery procedure existed in `docs/operations/RUNBOOKS.md` before this phase.
Added a `docker-desktop-wsl2-startup-crash` entry (now lines 199-249) based only on the real evidence in
the A.19/A.25 reports, then amended it with one line based on this session's own live recovery: check the
whole `run/` directory for every stale socket at once instead of relaunching serially into each new crash.

---

## 7. Real-DB integration coverage

| Context      | Real-DB integration tests                                                                           | Notable gap                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Finance      | `prisma-finance-repositories.integration.test.ts`, 8 cases                                          | No real-DB coverage of fiscal-period closing, budget variance, statement generation                |
| Licensing    | `prisma-repositories.integration.test.ts`, 8 cases                                                  | Only Credit grant/consume; no subscription cancellation/expiration                                 |
| Returns      | `prisma-return-request-repository.integration.test.ts`, 8 cases                                     | RMA lifecycle only; not refund settlement/payment-side processing                                  |
| Checkout     | `prisma-checkout-session-repository.integration.test.ts`, 8 cases                                   | No pricing/tax recalculation or payment-auth race coverage                                         |
| Orders       | `prisma-order-repository.integration.test.ts`, 5 cases                                              | No true simultaneous-transaction concurrency test; no fulfillment/cancellation transition coverage |
| Security     | 3 files (`prisma-repositories`, `prisma-consent-projection`, `prisma-identity-projection`), 6 cases | authn/authz/session/incident e2e suites still run against in-memory fakes, not real DB             |
| Customer-360 | 5 files (stores: attribute/identity/profile/segment/session), 14 cases                              | Identity merge-conflict resolution lightly tested                                                  |
| Payments     | `prisma-payment-intent-repository.integration.test.ts`, 9 cases                                     | Capture path only; no real-DB refund/void coverage                                                 |
| Inventory    | `prisma-inventory-item-repository.integration.test.ts`, 8 cases                                     | Reserve-race only; no release/replenishment-after-cancellation coverage                            |

**P0/P1/P2 classification of contexts with real production side effects and zero real-DB coverage:**

| Context           | Class  | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Identity**      | **P0** | Real `prisma-access-repositories.ts` / `prisma-customer-repository.ts` exist in the production path (customer PII, access control), but `identity.e2e.test.ts`/`access-flow.e2e.test.ts` only exercise in-memory fakes. Checked for A.25's composite-string-id-as-`@db.Uuid` defect pattern (`this.id.toString() + ...`) — **not present in Identity's domain code**, so no confirmed live bug, but PII + access control with zero real-DB coverage is the highest-risk gap category this audit found.                               |
| **Notifications** | **P1** | Real `prisma-notification-repository.ts` exists but only tested via an in-memory fake. Checked for the same composite-id defect pattern and **it is present** (`notification.ts:121,196`) — but the Prisma schema stores `attempts`/`history` as embedded JSONB arrays on the `Notification` row (`notifications.prisma`), not separate `@db.Uuid`-typed child rows, so this does **not** reproduce the Finance/Returns bug class. No PII on events (ADR-0006). Real external delivery side effect, still worth closing, not urgent. |
| Loyalty / Coupons | P2     | Monetary-equivalent (points/discounts) but promotional/secondary, not core transactional money path.                                                                                                                                                                                                                                                                                                                                                                                                                                 |

No new tests were written this phase — per the task's own instruction, only add tests against a
demonstrated concrete risk, and the Identity/Notifications gaps are coverage gaps, not confirmed defects.

---

## 8. Schema/migration status

**Independently re-derived this phase, not reused from A.25's run.** Spun up a disposable
`postgres:16-alpine` container, applied all 37 migrations fresh via `prisma migrate deploy` (clean, zero
errors), then diffed against the live `lumo` database on 5 axes via `information_schema`/`pg_indexes`,
with only nondeterministic constraint/index name suffixes normalized (never real structural differences):

| Axis                                                | Live rows | Shadow rows | Diff  |
| --------------------------------------------------- | --------- | ----------- | ----- |
| Columns (schema+table+column+type+nullable+default) | 1,346     | 1,346       | **0** |
| Primary keys                                        | 218       | 218         | **0** |
| Foreign keys                                        | 20        | 20          | **0** |
| Unique constraints                                  | 49        | 49          | **0** |
| Indexes (name-normalized)                           | 333       | 333         | **0** |

**Verdict: ZERO REAL DRIFT.**

---

## 9. Regression results (fresh, 0 cache hits)

`pnpm test` run with `.turbo` caches cleared beforehand: **78/78 tasks successful, 0 cached.**
Aggregate: **2,385 tests passed, 31 skipped (gated on optional infra: redis/storage/kafka
integration extras, 1 auth case — not failures), 0 failed.**

Critical services (cross-checked against A.25's own numbers for the 5 pre-existing regression suites):

| Service                             | This phase | A.25           |
| ----------------------------------- | ---------- | -------------- |
| Orders                              | 71/71      | 71/71          |
| Payments                            | 90/90      | 90/90          |
| Inventory                           | 31/31      | 31/31          |
| Security                            | 107/107    | 107/107        |
| Customer-360                        | 392/392    | 392/392        |
| Finance (incl. 8 new integration)   | 33/33      | new this cycle |
| Licensing (incl. 8 new integration) | 44/44      | new this cycle |
| Returns (incl. 8 new integration)   | 41/41      | new this cycle |
| Checkout (incl. 8 new integration)  | 29/29      | new this cycle |
| Runtime                             | 184/184    | —              |
| Admin                               | 123/123    | —              |

Identical to A.25 on every service A.25 also measured — zero regressions, zero flakiness introduced since.

---

## 10. Quality gates (fresh)

```
pnpm typecheck  → 78/78 tasks PASS
pnpm lint       → 78/78 tasks PASS, 0 warnings (A.25 had 5, from a scratch script since deleted)
pnpm arch       → 0 dependency violations (1,566 modules, 6,791 dependencies cruised)
pnpm test       → 78/78 tasks PASS, 0 cached — 2,385 passed / 31 skipped / 0 failed
governance/dup  → confirmed N/A: no such pnpm scripts at root or in any package.json;
                  `validate.yml`'s own comment documents they were dropped in an earlier
                  history reconstruction and never restored
```

---

## 11. Production checklist audit

`docs/operations/PRODUCTION_CHECKLIST.md` was already corrected by A.25 for its two false claims
(governance/dup as separate gates; "no credential committed"). Both corrections were re-verified accurate
and left in place. This phase refreshed the quality-gate line with today's live numbers (§10) since the
prior line cited A.25's now-stale run. No other checked item was found to be false; already-unchecked items
(TLS cert, Alertmanager on-call wiring, rollback drill, pentest sign-off) remain accurately unchecked.

---

## 12. Remaining risks / blocker table

| Finding                                                                                   | Severity      | Evidence                                                           | Required Action                                                                         | Owner               |
| ----------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------- |
| pgAdmin credential hardcoded and live on public `origin/main`                             | **BLOCKER**   | §3; `HEAD`==`origin/main`==`1b4ff76`, `docker-compose.yml:493-494` | Rotate credential, commit+push the existing working-tree fix                            | User                |
| Old credential still in reachable git history after rotation                              | HIGH          | §3                                                                 | Explicitly-approved `git filter-repo`/BFG history rewrite, coordinated force-push       | User + team         |
| Backup/restore has no scheduling automation                                               | HIGH          | §4                                                                 | Wire `scripts/ops/backup-postgres.sh` to a K8s CronJob or equivalent                    | Platform on-call    |
| Identity has zero real-DB integration coverage (PII + access control)                     | HIGH          | §7                                                                 | Add real-Postgres integration suite following the Finance/Returns/Checkout pattern      | Identity owner      |
| CDC stress matrix 10/60 trials, no repeated cap-exhaustion or concurrent-failure coverage | MEDIUM        | §5                                                                 | Dedicated CI-scheduled stress job to complete the 6×10 matrix                           | Platform on-call    |
| WAL retention unbounded (no `max_slot_wal_keep_size`)                                     | MEDIUM        | §5                                                                 | Set an explicit cap sized to worst-case outage duration                                 | DB on-call          |
| Notifications has zero real-DB coverage (external delivery side effect)                   | MEDIUM        | §7                                                                 | Add real-Postgres integration suite                                                     | Notifications owner |
| `lumo-hydra-1`/`lumo-kratos-1` crash-looping, `lumo-keto-1` exited                        | MEDIUM        | §6 (pre-existing, A.25)                                            | Investigate — blocks booting full `apps/runtime` composition for future live-infra work | Platform on-call    |
| Backup restore verification is one-off manual, not scheduled                              | LOW-MEDIUM    | §4                                                                 | Add a scheduled restore-drill job                                                       | DB on-call          |
| No named backup ownership, only role-based on-call                                        | LOW           | §4                                                                 | Assign a named owner in `RUNBOOKS.md`                                                   | Eng manager         |
| Business tables have 0 seeded rows in `lumo`/`lumo_test`                                  | INFORMATIONAL | Confirmed this phase — dev/schema environment, not a defect        | None                                                                                    | —                   |

---

## 13. Release decision: **NO-GO**

Per the task's own decision rule: NO-GO applies if an active credential remains exposed, regardless of how
many other gates are green. That condition is met — a real credential is live on a public GitHub repo's
default branch right now, unchanged from A.25. Every other gate checked this phase (schema drift, fresh
regression, quality gates, CDC watchdog mechanics, Docker recovery) is green or, where not fully automated
(backup scheduling, CDC stress coverage, Identity/Notifications real-DB coverage), is a documented
operational risk rather than an active security/data-loss threat on its own — but the credential exposure
alone is disqualifying and is not offset by the rest of the audit passing.

**This becomes CONDITIONAL GO, potentially GO, the moment the credential is rotated and the prepared fix
is committed and pushed** — nothing else found this phase reopens a blocker on its own.

---

## 14. Required user actions (in priority order)

1. Rotate the real pgAdmin credential (and anywhere else it was reused) — **do this first, independently of anything else in this report.**
2. Review and commit the working-tree fix to `infrastructure/docker/docker-compose.yml` (already present, env-var substitution), then push to `origin/main`.
3. Decide on and explicitly approve a git-history rewrite to purge the old credential from reachable commits; coordinate the resulting force-push and any contributor re-clones.
4. Decide whether to schedule the backup script via CronJob/K8s before this is called operationally ready, not just functionally proven.
5. Decide whether Identity's zero real-DB coverage needs closing before or after this release, given it's PII + access control.

---

## 15. Files modified or created this phase

**Modified:**

- `docs/operations/RUNBOOKS.md` — added `docker-desktop-wsl2-startup-crash` runbook entry (root cause, real fix, data-safety verification) plus a live-session-derived optimization note
- `docs/operations/PRODUCTION_CHECKLIST.md` — refreshed the quality-gate line with this phase's live numbers

**Created:**

- `PHASE_A26_FINAL_RELEASE_GATE_REPORT.md` (this file)

**Not modified (explicitly out of scope per the task's constraints):** `infrastructure/docker/docker-compose.yml` (fix already present, uncommitted — left as-is pending user's own commit), any credential, any git history.

**Infrastructure actions taken (non-destructive, reversible, no data touched):** cleared 4 stale Docker
Desktop AF_UNIX socket files via WSL and restarted Docker Desktop (recovered all 19 containers on their
existing volumes, zero data loss — see §6); created and destroyed one disposable `postgres:16-alpine`
container for the schema-drift check (§8), never pointed at the live database.
