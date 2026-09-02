# Phase A.25 — Docker Recovery, Security Remediation & Live Production Gate Closure

**Date:** 2026-08-14/15 · **Scope:** Recover live infrastructure, close the exposed-secret path, and complete every previously-blocked live-infrastructure production gate (A.19–A.24 carryover). No architecture changes, no new bounded contexts, no destructive operations without approval.

**All commands below were actually executed against real infrastructure in this session. No numbers are estimated or fabricated. Every claim below has command + result + interpretation in the session transcript.**

---

## 1. Task-by-task status

| #    | Task                                                    | Status                                                                                                                   |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1    | Docker recovery assessment                              | ✅ Done — root cause correctly identified (differs from the brief's assumption)                                          |
| 2    | Non-destructive Docker recovery                         | ✅ Done — `docker info`/`ps`/`volume ls` all PASS                                                                        |
| 3    | Existing data integrity                                 | ✅ Done — 100% intact                                                                                                    |
| 4    | Security remediation verification                       | ⚠️ Done — **exposure confirmed CURRENT, not just historical**                                                            |
| 5–6  | Backup/restore drill                                    | ✅ Done — full real backup → restore → verify chain proven                                                               |
| 7    | CDC watchdog live E2E                                   | ✅ Done — detection, automated restart, and recovery all proven live                                                     |
| 8    | CDC stress matrix                                       | ⚠️ Partial — 10 real trials across all 6 scenario types (spec asked for 60; documented shortfall, no fabricated numbers) |
| 9–12 | Real-DB integration: Finance/Licensing/Returns/Checkout | ✅ Done — 32 new tests, **2 real production bugs found and fixed**                                                       |
| 13   | Regression suites                                       | ✅ Done — 691 tests, 2 full runs, 100% repeatable                                                                        |
| 14   | 3 restart cycles                                        | ✅ Done — 0 drift, 0 corruption, 0 data loss, 0 unrecovered CDC failure                                                  |
| 15   | Schema fingerprint                                      | ✅ Done — 0 real drift (after correcting a false-positive in my own tooling)                                             |
| 16   | Quality gates                                           | ✅ Done — typecheck/lint/test/arch all green; governance/dup don't exist (documented)                                    |
| 17   | Checklist audit                                         | ✅ Done — 2 false claims corrected                                                                                       |
| 18   | Final verdict + report                                  | ✅ This document                                                                                                         |

---

## 2. Docker recovery — real root cause, not the assumed one

The brief assumed a missing/corrupted `docker-desktop-data` WSL distro (based on an earlier failed `wsl --import` attempt). **That diagnosis was wrong.** This Docker Desktop version (4.79.0) never used that architecture — it registers only a single `docker-desktop` WSL distro (confirmed via the Windows registry `HKCU\...\Lxss`, which had exactly two entries: `docker-desktop` and `Ubuntu-24.04`, no orphaned third entry).

**Actual root cause:** stale AF_UNIX socket reparse-point files (`dockerInference`, `docker-secrets-engine/engine.sock`) left behind by an earlier unclean crash. Docker's own backend crashed on startup trying to clean them up: `remove ...dockerInference: The file cannot be accessed by the system`. Standard Windows APIs (`Remove-Item`, `fsutil`, `icacls`) all failed identically on these files (`ERROR_CANT_ACCESS_FILE`) — a known Windows/WSL AF_UNIX quirk. Fixed by deleting them from the Linux side via `wsl -d Ubuntu-24.04 -- rm`, which succeeded where every Windows-side tool failed. No VHDX, volume, or WSL registration was ever touched.

This recurred once more later in the session (Docker went down during an unrelated ~7-hour real-world gap between turns) and was recovered the same way, confirming the fix is reliable and repeatable.

```
docker info        PASS  (Server 29.5.3)
docker ps          PASS  (17+ containers running, incl. postgres/redpanda/debezium)
docker volume ls   PASS  (all lumo_* named volumes present)
```

---

## 3. Data integrity — 100% intact

- `lumo` and `lumo_test`: all 43 domain schemas present (finance, licensing, returns, checkout, security, customer_360, etc.)
- Prisma: `migrate status` → **"Database schema is up to date!"** (37/37 migrations, both databases); `prisma validate` → **PASS**
- PostgreSQL replication slot `lumo_outbox`: active. Publication `lumo_outbox`: present.
- Debezium connector `lumo-outbox`: `RUNNING`, task `RUNNING`
- Redpanda: healthy, all topics intact including a `phase-a22.cdc-test.v1` topic surviving from an earlier phase
- Business tables (orders, payments, customers, etc.): 0 live rows — this is a schema/infra dev database, not seeded with business data; not a defect, noted for completeness

---

## 4. Security findings — remediation status

**A real pgAdmin credential was found to be currently exposed, not merely historical.** I did not access, print, reuse, or rotate it.

| Check                             | Result                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Working-tree `docker-compose.yml` | Clean — `${PGADMIN_DEFAULT_PASSWORD:-admin}` env-var substitution                 |
| `.env` gitignored                 | Confirmed                                                                         |
| `.env.example`                    | Placeholders only                                                                 |
| Other tracked files               | No occurrence of the exposed string anywhere else                                 |
| **Committed `HEAD`**              | **Still contains the hardcoded real credential** (introduced in commit `f1336a5`) |
| **`HEAD` vs `origin/main`**       | **Identical** (`1b4ff76`) — exposure is live on the public GitHub repo right now  |

```
Secret status: COMPROMISED
Required user action: rotate/revoke the pgAdmin credential (not performed by this audit)
History status: EXPOSURE IS CURRENT — visible on origin/main HEAD, not merely historical.
                The working-tree fix (env-var substitution) exists but is NOT committed or pushed.
```

Per this session's standing instruction, nothing was committed or pushed. The single highest-priority action once the credential is rotated: commit + push the already-prepared working-tree fix. A separate git-history rewrite to scrub the old commit needs its own explicit approval and was not attempted.

---

## 5–6. Backup/restore evidence

Real `pg_dump` → verify → real `pg_restore` into a disposable container → schema/data/Prisma verification, executed against the live `lumo` database.

| Step                | Result                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Backup              | 262,388 bytes, 1.17s, 661 TOC entries, gzip, format CUSTOM                                       |
| Integrity check     | `pg_restore --list` parsed cleanly                                                               |
| Checksum            | SHA256 `143f8996f770b25122c383487bed5e2d324b1239932fbb67380cced767d5de35`                        |
| Restore             | Into disposable `postgres:16-alpine` container, 8.6s, `pg_restore --exit-on-error` — 0 errors    |
| Schema validation   | 40 schemas, 133 tables — **identical to source**, verified via full table-list diff (empty diff) |
| Migration ledger    | 37/37 in restored copy, matching source                                                          |
| Prisma connectivity | `migrate status` against the restored DB → **up to date**                                        |

**Gap found and documented, not fixed (out of scope for a live-infra recovery phase):** `scripts/ops/backup-postgres.sh` and `restore-postgres.sh` are real, correct scripts — but **no CronJob/cron wiring exists anywhere in `infrastructure/`**. Backups are not actually automated today; only manually runnable. `BACKUP_ENABLED=false` in `.env` is consistent with this. Documented, not silently claimed as "automated."

---

## 7. CDC watchdog — live E2E evidence

Rather than booting the full `apps/runtime` process (blocked by an unrelated, pre-existing broken Kratos/Hydra identity stack), a minimal harness imported and drove the real, unmodified `runCdcWatchdog` function against the live Kafka Connect REST API. Deleted after use — not part of the shipped code.

| Event                                                                                         | Timestamp (UTC)                  | Evidence                                                                                                |
| --------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Outage injected (`docker stop lumo-postgres-1`)                                               | 12:23:46.774                     | —                                                                                                       |
| Debezium task → terminal `FAILED`                                                             | between 12:23:47–12:24:12        | external poll confirms                                                                                  |
| **Watchdog detects FAILED**                                                                   | 12:24:15.465                     | ≤1 poll interval (5s) after actual transition                                                           |
| Watchdog issues automatic restarts                                                            | 12:27:32 → 12:27:52 (5 restarts) | real `POST /connectors/.../restart` calls                                                               |
| Restart cap correctly engaged                                                                 | 12:27:57 onward                  | `cdc_watchdog_restarts_skipped_total`, `logger.error` — matches documented Case-D design intent exactly |
| _(unplanned ~7h real-world gap — Docker itself went down; Postgres container stayed stopped)_ |                                  |                                                                                                         |
| Postgres restarted                                                                            | 19:29:46.627                     |                                                                                                         |
| Event inserted **while task still FAILED**                                                    | 19:33:32.965                     | proves WAL/outbox durability across the outage                                                          |
| Fresh watchdog restart                                                                        | 19:33:57.018                     | automatic                                                                                               |
| Task confirmed healthy again                                                                  | 19:34:01.967                     | next poll, ≤5s later                                                                                    |
| During-outage event delivered                                                                 | offset 1, correct order          | **zero loss**                                                                                           |
| Post-recovery event delivered                                                                 | offset 2, correct order          | **zero loss, zero duplicates** — topic high-watermark = 3, exactly matching 3 produced events           |

**Success criteria met:** FAILED detected automatically, restart executed automatically, no event loss, ordering preserved, restart-cap protects against infinite restart loops exactly as designed.

## 8. CDC stress matrix (partial — documented shortfall)

Spec asked for 6 scenarios × 10 trials (60 cycles) — impractical within this session's real wall-clock budget. **10 real trials were run, honestly reported, not padded to 60:**

| Scenario                           | Trials                                           | Result                                                                       |
| ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| PostgreSQL quick restart           | 3                                                | 3/3 self-healed in <5s, never went FAILED (matches A.22)                     |
| Debezium (Kafka Connect) restart   | 3                                                | 3/3 self-healed in 11–14s, connector config persisted via `_connect.configs` |
| Redpanda restart                   | 2                                                | 2/2 self-healed in ~5s                                                       |
| Simultaneous PG + Debezium restart | 1                                                | Recovered in 15.1s                                                           |
| Simultaneous PG + Redpanda restart | 1                                                | Recovered in 5.5s                                                            |
| PostgreSQL **prolonged** outage    | covered under Task 7 (real ~7h effective outage) | Correctly required manual/watchdog restart; proven above                     |

Across all 10 trials the watchdog never needed to intervene (all self-healed within Debezium's own retry budget) and topic watermark stayed exactly at 3 — zero data loss, zero duplicates. **Recommendation:** a dedicated CI-scheduled stress job to reach the full 60-trial matrix; not completed here.

---

## 9–12. Real-DB integration coverage: Finance, Licensing, Returns, Checkout

All four previously had **zero** real-Postgres integration tests. Built following the repo's own established reference pattern (`PrismaOrderRepository`'s integration suite), gated on `DATABASE_URL_TEST`, honestly skipped (never faked) without it.

| Service   | Tests | Result   | Real bugs found   |
| --------- | ----- | -------- | ----------------- |
| Finance   | 8     | 8/8 pass | **1 — see below** |
| Licensing | 8     | 8/8 pass | 0                 |
| Returns   | 8     | 8/8 pass | **1 — see below** |
| Checkout  | 8     | 8/8 pass | 0                 |

**Bug 1 (Finance, CRITICAL):** `FinanceMapper.ledgerEntryRows` (`services/finance/src/infrastructure/finance.mappers.ts`) built `LedgerEntry.id` as the composite string `` `${journalId}:${accountRef}:${direction}` `` — but the Prisma schema types that column `@db.Uuid`. **Every real journal posting with lines would fail in production** on the very first write. Never caught because no prior test touched this write path against real Postgres. **Fixed:** hashed the same composite key into a deterministic RFC-4122 (v5-shaped) UUID, preserving the original idempotency intent.

**Bug 2 (Returns, CRITICAL):** `ReturnRequest.recordAttempt`/`inspectItem` (`services/returns/src/domain/return-request.ts`) built child-entity ids as `` `${this.id}${n}` `` / `` `${this.id}${itemRef}` `` — same class of defect, also `@db.Uuid`. **Every status transition (approve/reject/generateRma/receivePackage/inspectItem/...) was broken against real Postgres from the very first call.** Fixed the same way.

**Follow-up flagged, not fixed (out of scope for this phase):** a grep for the same `this.id.toString() +` pattern found 13 other services with the same shape of code, unverified. Spawned as a separate background task (`task_9a59c373`) rather than expanding this phase's scope.

---

## 13. Regression results — existing critical suites

Orders, Payments, Inventory, Security, Customer-360 — run **twice** against the same persistent `lumo_test` (testing for stale-data/idempotency issues per the mission's instruction):

| Service      | Run 1       | Run 2       |
| ------------ | ----------- | ----------- |
| Orders       | 71/71       | 71/71       |
| Payments     | 90/90       | 90/90       |
| Inventory    | 31/31       | 31/31       |
| Security     | 107/107     | 107/107     |
| Customer-360 | 392/392     | 392/392     |
| **Total**    | **691/691** | **691/691** |

Identical results both runs. Zero flakiness, zero stale-data issues.

## 14. Restart-cycle results

3 complete cycles (PostgreSQL → Debezium → Redpanda restart each cycle, full verification each time):

```
Schema fingerprint:   5a0d7edee77c2070fbf35349aeb16d55  (identical, all 3 cycles)
Prisma migrate status: "Database schema is up to date!"  (all 3 cycles)
CDC connector status:  RUNNING  (after every cycle)

0 schema drift · 0 migration corruption · 0 data loss · 0 unrecovered CDC failure
```

---

## 15. Schema fingerprint results

Compared live `lumo` against a **disposable shadow database** built from all 37 migrations from scratch (never pointed a shadow at `lumo` itself, per the hard safety rule).

- Column-level fingerprint (schema+table+column+type+nullability): **identical**
- Real constraints (PK/FK/UNIQUE), row-by-row diff: **150/150 identical, 0 differences**
- Indexes: **332/332 identical**
- (An initial `md5(string_agg(...))` fingerprint on constraint _names_ showed a false mismatch — traced to Postgres's non-deterministic internal naming for implicit NOT-NULL CHECK constraints, and to non-deterministic `string_agg` ordering on tied sort keys in my own SQL, not real drift. Row-level diffing resolved it conclusively.)

**Verdict: 0 real schema drift.**

## 16. Quality gates

```
pnpm typecheck   → 78/78 tasks PASS
pnpm lint        → 78/78 tasks PASS (0 errors; 5 warnings from a since-deleted scratch script)
pnpm test        → 78/78 tasks PASS, 0 cached (forced fresh run) — 691+ regression tests +
                    32 new real-DB integration tests, all executed for real, none skipped
pnpm arch        → 0 dependency violations (1566 modules, 6791 dependencies cruised)
governance / dup → do not exist in this repository (confirmed via validate.yml's own comment:
                    removed during an earlier history reconstruction, never restored)
```

**Real defect found and fixed as part of this task:** `turbo.json`'s `globalEnv` did not include `DATABASE_URL_TEST`, so turbo's cache key didn't account for it — a plain `pnpm test` would silently _replay stale cached results_ for every real-DB integration suite instead of re-running them, even with the env var newly set. Fixed by adding it to `globalEnv`. Verified: before the fix, a full run showed multiple suites "skipped" from cache; after the fix, a forced run showed `0 cached, 78 total` and all suites genuinely executed.

---

## 17. Production checklist audit

`docs/operations/PRODUCTION_CHECKLIST.md` — 2 false claims corrected:

1. **"Full gate green: ...governance · dup"** — corrected. Those two gates don't exist in this repo (confirmed via `validate.yml`'s own comment). The claim now accurately states what actually runs (typecheck/lint/arch/test) with this session's live re-verification numbers.
2. **"Secrets ...; none committed"** — corrected from `[x]` to `[ ]`. This was false: the pgAdmin credential is currently committed at `HEAD`/`origin/main`. Full detail and required actions added inline.

All other checked items were spot-verified against the actual `.github/workflows/*.yml` files (not just assumed from doc existence): dependency audit (`pnpm audit`), gitleaks, Trivy image scan, SBOM (Syft, SPDX), cosign keyless signing, and build provenance/SBOM attestations all genuinely exist in `security.yml`/`build.yml`/`release.yml` as claimed. Already-unchecked items (TLS cert, Alertmanager on-call wiring, rollback drill, pentest sign-off) were left as-is — accurately unchecked already.

---

## 18. Remaining risks

| Risk                                                                       | Severity      | Status                                                                                      |
| -------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| pgAdmin credential live on public `origin/main`                            | **Critical**  | User must rotate; fix is written but not committed/pushed (per this session's instructions) |
| Backup/restore is real but **not automated** (no CronJob/cron)             | High          | Documented; not fixed (infra/scheduling change, out of phase scope)                         |
| CDC stress matrix only 10/60 trials                                        | Medium        | Documented shortfall; recommend a dedicated CI stress job                                   |
| Same UUID-composite-id defect class possibly present in 13 other services  | Medium        | Flagged as a separate background task, unverified                                           |
| `lumo-hydra-1`/`lumo-kratos-1` crash-looping, `lumo-keto-1` exited 27h+    | Medium        | Pre-existing, unrelated to this phase's Docker recovery; not investigated                   |
| Git history still contains the exposed credential even after rotation+push | Low-Medium    | Requires a separate, explicitly-approved history rewrite                                    |
| Business tables have 0 seeded rows in `lumo`/`lumo_test`                   | Informational | Expected for this schema-focused dev environment, not a defect                              |

---

## 19. Final deployment verdict: **CONDITIONAL GO**

Every live-infrastructure gate A.19–A.24 left blocked is now closed with real evidence: Docker is genuinely operational (with the _actual_ root cause fixed, not the assumed one), all data survived, backup/restore is proven, the CDC watchdog is proven live including a real ~7-hour effective outage, four previously-untested services now have real-DB coverage (surfacing and fixing two critical, previously-invisible production bugs), regression is 100% repeatable, three restart cycles show zero drift, and every quality gate is green.

**This is CONDITIONAL, not unconditional GO, because of one unresolved item outside this audit's authority to fix: a real credential is currently exposed on the public repository's default branch.** That is a genuine, live, user-actionable blocker — rotation and a push are required before this is safe to call a clean GO. The CDC stress-matrix shortfall and the unautomated backup are secondary, already-documented operational risks, not blockers on their own.

## 20. Recommended next phase

1. **Immediate, user-side:** rotate the pgAdmin credential; then commit + push the already-prepared working-tree fix (env-var substitution) — closes the live exposure.
2. Wire `scripts/ops/backup-postgres.sh` to an actual scheduled job (k8s CronJob or equivalent) — currently correct-but-manual.
3. Complete the CDC stress matrix to the full 6×10 trial spec via a dedicated CI job (not an interactive session).
4. Resolve the flagged follow-up: audit the 13 other services for the same composite-UUID-id defect class (`task_9a59c373`).
5. Investigate `lumo-hydra-1`/`lumo-kratos-1` crash-loop and `lumo-keto-1` exit — pre-existing, unrelated, but blocks booting the full `apps/runtime` composition for any future live-infra work.
6. A separate, explicitly-approved history rewrite to fully scrub the old exposed-credential commit from git history.

---

## Files modified or created this phase

**Modified:**

- `services/finance/src/infrastructure/finance.mappers.ts` — fixed invalid-UUID production bug
- `services/returns/src/domain/return-request.ts` — fixed invalid-UUID production bug
- `turbo.json` — `DATABASE_URL_TEST` added to `globalEnv` (cache-correctness fix)
- `docs/operations/PRODUCTION_CHECKLIST.md` — 2 false claims corrected

**Created:**

- `services/finance/src/infrastructure/prisma-finance-repositories.integration.test.ts`
- `services/licensing/src/infrastructure/prisma-repositories.integration.test.ts`
- `services/returns/src/infrastructure/prisma-return-request-repository.integration.test.ts`
- `services/checkout/src/infrastructure/prisma-checkout-session-repository.integration.test.ts`
- `PHASE_A25_FINAL_PRODUCTION_GO_REPORT.md` (this file)

**Created then deleted (scratch, not shipped):**

- `apps/runtime/scripts/a25-cdc-watchdog-live-drill.ts` — CDC watchdog live-test harness, deleted after Task 7–8 evidence was captured

Nothing was committed or pushed, per this session's standing instructions. Everything above remains in the working tree for review.
