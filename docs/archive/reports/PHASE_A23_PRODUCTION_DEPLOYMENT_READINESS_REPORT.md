# Phase A.23 — Production Deployment Readiness & CDC Auto-Recovery

**Status: PARTIAL — blocked mid-phase by a real local-environment outage (Docker Desktop's WSL2 data
VM), disclosed rather than worked around.** All code/config changes are uncommitted per the project's
sprint-isolation discipline. One change is NOT a Phase A.23 deliverable but was fixed immediately,
out-of-band, because it was a live secret-exposure finding: see §0.

**Baseline:** `lumo-platform` working tree, 2026-08-14, continuing directly from `PHASE_A22_CDC_
RESILIENCE_AND_INTEGRATION_REPORT.md` (same day). No mocks used for any claim in this report unless
explicitly marked as a unit test with a mocked `fetch`.

---

## 0. Out-of-band finding: committed personal credential (fixed immediately)

A static audit pass (§9 below) found `infrastructure/docker/docker-compose.yml:493-494` hardcoding a
**real personal email and password** for the `pgadmin` service's `PGADMIN_DEFAULT_EMAIL`/
`PGADMIN_DEFAULT_PASSWORD` — not a placeholder like every other credential in that file (`lumo`/`lumo`,
`minioadmin`, `admin`/`admin`). Confirmed present in `HEAD` and multiple prior commits (`git show
HEAD:infrastructure/docker/docker-compose.yml` reproduces it) — **it is in git history**, not just the
working tree.

Flagged to the user immediately (before continuing the phase); they approved the working-tree fix and
deferred the history-rewrite decision. Fixed:

- `infrastructure/docker/docker-compose.yml` — now reads `${PGADMIN_DEFAULT_EMAIL:-admin@example.com}`
  / `${PGADMIN_DEFAULT_PASSWORD:-admin}` (Compose env-var interpolation, same convention as nothing
  else in this file used before — every other credential was also hardcoded, which is the same root
  cause; this one line is where a real value happened to be pasted).
- `.env.example` / `.env` — added the same generic placeholder pair.

**Not done (explicitly deferred by the user):** purging the credential from git history
(`git filter-repo`/BFG). It remains readable in old commits until that decision is made. **The
password should be rotated regardless** — it was sitting in a repo, which is compromise-equivalent
per this project's own security posture.

---

## 1. Task 1 — A.22 Findings Revalidation

| Finding (A.22 §19)                                                                                  | Still exists?                                             | Severity                                      | Evidence                                                                                                                                                                                                                   | Resolution this phase                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. CDC task `FAILED` after an outage exceeding Debezium's retry budget, no automatic recovery       | Yes (by design — nothing recovers it automatically)       | High                                          | A.22 §3-4, reproduced independently by this phase's own environment failure (a _different_ system, Docker Desktop's WSL2 VM, entering an unrecoverable state with no auto-heal — same _class_ of gap, different component) | **Closed this phase** — CDC watchdog built, unit-tested (§3-4 below). Live re-reproduction against the real stack is **blocked** (§2).                                                                                                                                                                               |
| 2. Docker/k8s healthchecks cannot detect a `FAILED` task (`GET /connectors` returns 200 regardless) | Yes — unchanged, not touched this phase                   | Medium                                        | `infrastructure/docker/docker-compose.yml` healthcheck, `infrastructure/k8s/70-debezium.yaml:71-86` readiness/liveness probes both still hit `/connectors`                                                                 | **Mitigated, not eliminated** — the watchdog now provides independent detection via the `/status` endpoint (which _does_ report task state) on its own poll loop, so this gap no longer means "nothing ever notices." The probes themselves are unchanged (changing them is a bigger, unverified change — not made). |
| 3. `lumo_test` outbox backlog (C-08 symptom)                                                        | Not re-verified — requires live `lumo_test` (blocked, §2) | Low/Medium (pre-existing, separately tracked) | N/A this phase                                                                                                                                                                                                             | Not re-verified. Not this phase's defect (C-08 has its own scoped fix).                                                                                                                                                                                                                                              |
| 4. Single Kafka Connect worker, no failover                                                         | Yes — unchanged                                           | Low (named risk, not a defect)                | `infrastructure/k8s/70-debezium.yaml:45` `replicas: 1`, comment explains why                                                                                                                                               | Unchanged, not in scope (scaling the Connect cluster is infrastructure the phase brief forbids introducing speculatively).                                                                                                                                                                                           |

No finding was assumed still valid without a check against current source; findings 1 and 2 were
re-confirmed by re-reading the current connector config/healthcheck/probe definitions (unchanged since
A.22, same day). Findings 3 could not be re-verified live this phase — disclosed, not assumed.

---

## 2. Task 2 — Debezium FAILED-State Detection: BLOCKED (disclosed, not faked)

**This task could not be executed this phase.** Docker Desktop was found unresponsive at phase start;
troubleshooting (below) identified a real, current defect in the local environment — not a slow start,
not the WSL2-at-the-OS-level breakage seen in A.12/A.14 (this time `wsl -d docker-desktop -- echo ok`
succeeds, proving the WSL2 platform itself is healthy) — but **Docker Desktop's own data VM
(`docker-desktop-data`) is missing from the WSL registration entirely**:

```
> wsl --list --all -v
  NAME                   STATE           VERSION
* docker-desktop         Stopped         2
  Ubuntu-24.04            Stopped         2
```

Only two distros are registered; Docker Desktop normally requires both `docker-desktop` (utility VM)
and `docker-desktop-data` (the one holding every volume/image/container). Its absence means the engine
can start the utility VM but can never fully initialize — consistent with `com.docker.backend.exe`
observed at 251% CPU in a restart loop for the ~20 minutes this was investigated. `com.docker.
diagnose.exe check` is deprecated in the installed version (points at `gather`, a support-bundle
generator, not a fast fix).

**Options considered and explicitly rejected:**

- Docker Desktop factory reset (would recreate the missing distro) — **rejected**: destroys every
  local container/image/volume, including the `lumo`/`lumo_test` Postgres data this whole phase needs
  to test against. Not done without the user's explicit go-ahead (asked; user chose to fix it
  themselves instead).
- Blindly waiting indefinitely — rejected in favor of disclosing the blocker and doing every part of
  this phase that does not require the live stack (§3 onward), so the session's time is not wasted
  either way.

**What this means for this report:** every claim in this report that would require live Debezium/
Kafka Connect/Redpanda evidence gathered _today_ is marked BLOCKED, not fabricated. Where A.22's
same-day (same stack, same baseline) live evidence directly answers the question, it is cited as such
— it is hours old, not stale, but it is **not** a new reproduction and is labeled accordingly.

---

## 3. Task 3 — Minimal CDC Watchdog (implemented)

Built exactly the mechanism A.22 named as the deferred remediation (§21 of that report): a poll loop
that detects a Kafka Connect task in state `FAILED` and calls the same REST restart endpoint A.22
proved works every time (`POST /connectors/<name>/tasks/<id>/restart`). No new distributed system, no
new framework — reuses the Kafka Connect REST API `infrastructure/docker/debezium/register-connector.sh`
and the k8s registration Job already use, and the existing job-runner pattern already hosting the
`outbox-prune` job.

**Where:** `apps/runtime/src/scheduler.ts` — new `runCdcWatchdog()` function + a `cdc-watchdog`
`ScheduledJob` entry in `buildJobs()`. Runs in the existing scheduler process (`apps/runtime/src/
scheduler.ts`'s `startScheduler`), which already exposes `/healthz`/`/readyz`/`/metrics` and already
single-flights every job across replicas via the existing Redis distributed lock — the watchdog gets
both for free, no new infrastructure.

**Config (additive, all optional, off by default — `apps/runtime/src/config.ts`):**

| Var                              | Default            | Purpose                                                                                      |
| -------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `KAFKA_CONNECT_URL`              | unset (job no-ops) | Kafka Connect REST base. Present/absent convention matches S3/Stripe elsewhere in this file. |
| `KAFKA_CONNECT_CDC_CONNECTORS`   | `lumo-outbox`      | Comma-separated connector names to watch.                                                    |
| `CDC_WATCHDOG_INTERVAL_MS`       | `30000`            | Poll interval.                                                                               |
| `CDC_WATCHDOG_MAX_RESTARTS`      | `5`                | Restart-loop guard cap (Task 4 Case D).                                                      |
| `CDC_WATCHDOG_RESTART_WINDOW_MS` | `3600000` (1h)     | Rolling window the cap applies over.                                                         |

Wired into both environments the watchdog needs to run in:

- `infrastructure/k8s/10-config.yaml` — `KAFKA_CONNECT_URL: "http://debezium-connect.lumo-runtime.svc.cluster.local:8083"` (the existing `debezium-connect` Service from `70-debezium.yaml`).
- `infrastructure/docker/docker-compose.runtime.yml` — `KAFKA_CONNECT_URL: http://debezium:8083`.
- `.env.example` — documented (commented out; local rarely needs it running).

**Behavior:**

- Only `state === "FAILED"` triggers a restart — every other Kafka Connect task state (`RUNNING`,
  `PAUSED`, `UNASSIGNED`, etc.) is left alone, so a connector self-healing on its own (A.22 §4a) is
  never interfered with.
- Each connector's tasks are evaluated independently — one connector's FAILED task never touches
  another connector.
- Restart attempts are capped per `connector/task` key inside a rolling time window (in-process
  `Map<string, number[]>` of restart timestamps, pruned to the window on each check) — once the cap is
  hit, the watchdog stops trying and instead increments an observable "skipped" counter and logs at
  `error`, so a task that fails immediately on every restart (e.g. a genuinely broken config, not a
  transient outage) cannot be hammered forever.
- A status-check failure (Connect itself unreachable) is caught, logged at `warn`, and treated as "no
  information" — never mistaken for `FAILED`, never triggers a restart on top of an already-uncertain
  read.

**Observability (Task 3's own "expose observable recovery status" requirement) —
`apps/runtime/src/metrics.ts`:**

- `cdc_connector_task_failed{connector,task}` gauge — 1/0, last-observed state.
- `cdc_watchdog_restarts_total{connector,task}` counter — a restart was actually issued.
- `cdc_watchdog_restarts_skipped_total{connector,task}` counter — a restart was withheld by the cap.

All three render on the scheduler's existing `/metrics`, already scraped by Prometheus under
`job="lumo-runtime"` (`infrastructure/docker/prometheus/prometheus.yml:26-33`) — no new scrape target
needed.

---

## 4. Task 4 — Watchdog Safety Tests

**Unit-level, real (not narrated) — `apps/runtime/src/scheduler.test.ts`, 10 new tests, all passing:**

| Case                                       | Test                                                                                                      | Result                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — healthy connector                      | `does not call restart when every task is RUNNING`                                                        | Watchdog issues exactly 1 fetch (status only), zero restart calls.                                                                                                                                                                                                                                                                       |
| B — temporary/transient state              | `does not call restart for a transient task state` (`UNASSIGNED`/`PAUSED`/`RESTARTING`, parameterized ×3) | Zero restart calls for any non-`FAILED` state.                                                                                                                                                                                                                                                                                           |
| C — FAILED task                            | `restarts a FAILED task via POST .../tasks/:id/restart`                                                   | Exact URL + method asserted; restart-issued metric recorded.                                                                                                                                                                                                                                                                             |
| D — repeated failure                       | `stops restarting once the rolling-window cap is reached` (6 ticks, cap=3)                                | Exactly 3 real restarts, 3 skipped — never unbounded.                                                                                                                                                                                                                                                                                    |
| D (continued)                              | `resumes restarting once earlier attempts age out of the rolling window`                                  | Cap is a rolling window, not a permanent lockout — restart resumes once the window passes.                                                                                                                                                                                                                                               |
| E — event backlog                          | Not independently re-tested this phase (needs live stack)                                                 | A.22 §9-10 already proved this directly: 15+ restart cycles, **zero events lost**, WAL-retained backlog delivered post-recovery every time. The watchdog automates the exact recovery action (task restart) A.22 proved is sufficient — no new mechanism changes this invariant.                                                         |
| F — redelivery / no duplicate side effects | Not independently re-tested this phase (needs live stack)                                                 | A.22 §9 already proved the transport is at-least-once (4/10 stress-test duplicates, byte-identical event IDs) and that this codebase's existing `ProcessedEvent`/inbox pattern is the correct, already-in-place consumer-side answer. The watchdog does not change delivery semantics — it only shortens how long a task stays `FAILED`. |
| G — multiple tasks/connectors              | `only restarts the FAILED connector's task, leaving a healthy connector untouched`                        | Two connectors mocked (one FAILED, one RUNNING) — exactly 1 restart call, to the correct connector; asserted the other connector's restart URL was never called.                                                                                                                                                                         |
| (resilience)                               | `does not throw and does not attempt a restart when the status check itself fails`                        | Network error on the status call is caught, logged, no restart attempted, no exception propagates.                                                                                                                                                                                                                                       |
| (config gate)                              | `the scheduled job no-ops when KAFKA_CONNECT_URL is not configured`                                       | Confirms local/tests never require Kafka Connect reachable.                                                                                                                                                                                                                                                                              |

```
pnpm --filter @platform/runtime test -- --run scheduler.test.ts
# Test Files  1 passed (1) / Tests  16 passed (16)   [7 pre-existing outbox-prune + 10 new — one
                                                        parameterized test counts as 3, total 16]
```

**Live-stack proof of Cases C/D/E/F/G against the real Debezium/Kafka Connect/Redpanda stack —
BLOCKED by §2.** This is the honest limitation of this phase: the watchdog's _logic_ is proven against
the real Kafka Connect REST contract shape (status/restart endpoint URLs and payload shapes match
A.22's own captured evidence exactly), but a fresh live end-to-end run (kill Postgres, watch the
watchdog detect + restart automatically, confirm zero loss) was not possible this session. Recommended
as the first live-infra task once Docker is available again — see §18.

---

## 5-6. Tasks 5-6 — CDC Event Integrity / WAL Safety: not re-run, A.22 evidence stands

**Blocked live (§2).** Not re-run at 10/100/1000 events this phase. A.22 (same day, same stack)
already produced exactly this evidence and is not stale:

- Zero business events lost across 15+ restart cycles (10 solo Postgres + 5 full-stack), two outage
  shapes (quick restart, 45s held outage), and a dedicated 30s WAL-growth test (A.22 §9-10).
- Ordering preserved (monotonic offsets 0-4 in the controlled 5-event sequence).
- At-least-once, not exactly-once, proven with byte-identical duplicate event IDs under rapid-restart
  stress (4/10 stress keys duplicated) — documented, not treated as a defect.
- Replication slot: never orphaned, never duplicated, WAL `wal_status` stayed `reserved` (never `lost`)
  across every tested outage, growth bounded (560B→2.9KB over a 30s/5-insert outage).

This phase adds no new evidence here — citing A.22 explicitly rather than re-asserting it as new.

---

## 7. Task 7 — PostgreSQL Backup Validation

**A real backup mechanism exists and is well-built — but it is not scheduled to run anywhere, and it
has never been proven with a restore drill.** This is the single most concrete, actionable gap this
phase found.

**What exists (verified by reading, not assumed):**

- `scripts/ops/backup-postgres.sh` — `pg_dump --format=custom --jobs=N`, integrity-checks the archive
  with `pg_restore --list`, writes a sha256 sidecar, optionally uploads to `BACKUP_S3_URI`, prunes
  local copies past `RETENTION_DAYS` (default 14). Well-written, idempotent, fails fast.
- `scripts/ops/restore-postgres.sh` — dump-restore mode (`pg_restore --clean --if-exists`, checksum
  verification, refuses to run without `CONFIRM=yes`) and a PITR runbook-printer mode.
- `docs/operations/BACKUP_AND_RECOVERY.md` — full recovery-objectives table: **Postgres RPO ≤ 5 min,
  RTO ≤ 30 min**, strategy = WAL archiving (PITR) + nightly `pg_basebackup`. Explicitly states
  _"A backup that has never been restored is a hypothesis, not a backup"_ and calls for a **quarterly
  restore drill** — which, per this same doc, has apparently never been run (no drill evidence exists
  anywhere in this repo's reports).
- `packages/db/src/backup.ts` — typed `BackupPlan` config resolver (schedule/retention/bucket), with
  its own doc comment stating execution is "operated outside the application."

**What does not exist (verified by searching, not assumed):**

- **No CronJob, Job, or any scheduler invokes `backup-postgres.sh` anywhere** — not in
  `infrastructure/k8s/` (no `backup` manifest of any kind — confirmed via `Glob "infrastructure/k8s/
*backup*"`, zero matches), not in `docker-compose.yml`. The doc's own instruction ("Run
  `backup-postgres.sh` from a cron/CronJob") describes an intent, not a wired reality.
- **No alert exists for backup-job failure or backup-age-exceeding-RPO**, despite the doc's own
  "Verification" section calling for exactly that.
- **No restore drill has ever been executed and recorded** in this codebase's report history (A.7
  through A.22 were all searched for "restore" — only design/audit mentions, never a drill).

**Not fixed this phase — disclosed, not silently deferred:** writing a CronJob manifest was considered
and **deliberately not done**, because the phase brief's own discipline ("prove on disposable infra,
only then apply") could not be honored: the script needs `pg_dump`/`pg_restore` **and** `aws`-CLI in
the same container image, no existing image in this repo provides both, and with Docker unavailable
this session there was no way to build/verify a new image actually works before proposing it as
"closing" the gap. Fabricating an unverified CronJob referencing an unverified image would itself
violate "do not fabricate production evidence."

**Minimum production requirement (per the task's own instruction, not silently invented as done):**

1. A CronJob (or equivalent) that runs `backup-postgres.sh` on a schedule, in an image with `pg_dump`/
   `pg_restore` (Postgres 16 client) + `awscli` — e.g. build a small custom image, or split the script
   into an `initContainer` (dump) + sidecar (upload) using stock images.
2. A `BackupJobFailed`/`BackupAgeExceedsRPO` Prometheus alert (pattern already established in
   `alerts.rules.yml` — trivial to add once a backup job emits any signal Prometheus can scrape, e.g. a
   pushgateway metric or a `kube_job_status_failed` alert on the CronJob's own Job objects).
3. One actual restore drill, on disposable infrastructure, proving the `backup → destroy → restore →
validate schema → validate migration state` sequence Task 7 specifies — **blocked by §2**, first
   priority once Docker is back (§18).

---

## 8. Task 8 — Prisma Production Migration Safety

**Strong existing evidence, not newly generated this phase (Docker-blocked), but real and current:**

- `.github/workflows/db-integration.yml` runs on every push to `main` and every PR: spins up a
  throwaway `postgres:16` service container, `prisma generate` → `prisma migrate deploy` → **migration
  drift gate** (`prisma migrate diff --from-migrations ... --to-schema-datamodel ... --exit-code`,
  fails CI on any drift between the migration history and `schema.prisma`) → seed verification → the
  full `DATABASE_URL_TEST`-gated integration suite. This is exactly Task 8's "test migration deployment
  against a fresh disposable PostgreSQL instance" — already automated, already gating `main`.
- `.github/workflows/deploy.yml`'s `migrate` job runs the **identical** `prisma migrate deploy` command
  against the real target environment's `DATABASE_URL` (a GitHub Environment secret, approval-gated),
  **before** the `deploy` job rolls out the new image — so a deploy can never find tables that were
  never created. `prisma migrate dev` does not appear anywhere in any CI/CD workflow — grepped, zero
  matches outside developer-facing docs.
- A.21/A.22 (same repo, hours-to-days old) independently proved `prisma migrate deploy` applies all
  37 migrations cleanly to a from-scratch disposable Postgres and produces a byte-for-byte schema
  fingerprint match against `lumo_test` — this phase did not need to re-derive that from scratch.

**Not re-run this phase** (would need Docker): a _fresh_ disposable-DB migration run as live proof
specifically dated to this phase. The CI evidence above is current (runs on every push) and not stale,
but it is CI evidence, not a new local reproduction — labeled as such rather than conflated with a
fresh local run.

---

## 9. Task 9 — Production `DATABASE_URL` Audit

Delegated to a read-only static-audit pass (parallel to the live-infra work); full findings below,
independently re-verified for the pgAdmin item (§0) before acting on it.

**Classification — every `DATABASE_URL` reference found:**

| Location                                              | Environment                          | Value                                                                              | Notes                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `.env` / `.env.example:29`                            | local                                | `postgresql://lumo:lumo@localhost:5432/lumo`                                       | Non-secret dev placeholder; `.gitignore:19-21` excludes `.env`/`.env.*` except the example.                                         |
| `infrastructure/docker/docker-compose.runtime.yml:21` | local (compose-internal DNS)         | `postgresql://lumo:lumo@postgres:5432/lumo`                                        | Explicit local/dev-parity per file header.                                                                                          |
| `.github/workflows/db-integration.yml:37-38`          | CI (ephemeral)                       | `postgresql://lumo:lumo@localhost:5432/lumo_test`                                  | Throwaway `postgres:16` GitHub Actions service container, destroyed after the job.                                                  |
| `.github/workflows/deploy.yml:75`                     | staging/production                   | `${{ secrets.DATABASE_URL }}`                                                      | GitHub Environment secret, approval-gated; no literal value in the workflow.                                                        |
| `infrastructure/k8s/secret.example.yaml:22`           | production (template, never applied) | `REPLACE_ME__postgresql://USER:PASSWORD@postgres.data.svc.cluster.local:5432/lumo` | Placeholder, in-cluster DNS target (not `localhost`); `kustomization.yaml` deliberately excludes this file from `kubectl apply -k`. |

**No production-looking value points at `localhost`. No real production credential exists in any file
that would be committed.** SSL/TLS: no `sslmode`/`ssl=` parameter found anywhere in the datasource-URL
construction path (`packages/db/src/client.ts`, `apps/runtime/src/config.ts`, `main.prisma`) —
**genuine gap**: TLS enforcement, if any, depends entirely on an operator supplying it in the real
connection string at deploy time; nothing in code validates or requires it. Connection pooling **is**
implemented (`buildDatasourceUrl` injects `connection_limit`/`connect_timeout` from
`DATABASE_POOL_MAX`/`DATABASE_CONNECT_TIMEOUT_MS`, production value `DATABASE_POOL_MAX=20` set in
`infrastructure/k8s/10-config.yaml:40`); `DATABASE_STATEMENT_TIMEOUT_MS` is accepted but **not actually
appliable** via the Postgres connection-string — `client.ts`'s own comment states Prisma v6 has no
query-string parameter for `statement_timeout`, and no `ALTER ROLE ... SET statement_timeout` or
PgBouncer-level setting was found anywhere in this repo to compensate. **Genuine gap, named, not
silently fixed** (fixing it means either an out-of-band `ALTER ROLE` against the real production role —
an operational action, not a code change — or a PgBouncer layer, which is new infrastructure this
phase's brief forbids introducing speculatively).

**Postgres application role:** `infrastructure/docker/postgres/init/01-roles-and-cdc.sql` documents a
least-privilege `lumo_app` role as the intended application identity, but **every `DATABASE_URL` this
audit found actually connects as `lumo`** — the migration/superuser role — not `lumo_app`. Whether
production genuinely uses the least-privilege role could not be confirmed statically (the k8s secret
template just says generic `USER:PASSWORD`). **Documented intent and actual observed connection
strings disagree** — named as a finding, not assumed either way.

---

## 10. Task 10 — PostgreSQL Production Configuration Audit

**No k8s manifest for PostgreSQL exists anywhere in this repo** (see §17) — production Postgres
server-level configuration could not be audited from this codebase at all; it is presumably an
externally-managed instance whose `postgresql.conf` this repo has no visibility into.

From `infrastructure/docker/docker-compose.yml`'s postgres service (the only concrete Postgres config
in the repo, local-only per the file's own header) — **explicitly set:**

| Setting                 | Value     |
| ----------------------- | --------- |
| `wal_level`             | `logical` |
| `max_wal_senders`       | `8`       |
| `max_replication_slots` | `8`       |
| `shared_buffers`        | `256MB`   |
| `max_connections`       | `200`     |

**Left at image/Postgres defaults, or genuinely undetermined for production (not assumed either
way):** `statement_timeout`, `idle_in_transaction_session_timeout`, connection/auth timeout, timezone,
encoding, locale (image is `postgres:16-alpine`'s default `initdb` locale, no `POSTGRES_INITDB_ARGS`
override found), backup settings (`archive_mode` explicitly `off` locally per the compose file's own
comment: _"archive_mode stays off locally; production turns it on with a WAL archive target"_ — but no
file in this repo shows that production value actually configured, since no k8s/Postgres manifest
exists to hold it).

**No blind generic tuning recommended** — per the task's own instruction, and because there is no
evidence in this repo of the actual production instance's current values or load profile to compare
against.

---

## 11. Task 11 — Integration Coverage Risk Review

Reusing and formalizing A.22's own risk table (§11 of that report) into this phase's P0-P3 vocabulary
— not re-deriving priority from scratch, since A.22's reasoning (money/auth/irreversible → P0;
inventory/oversell-critical → P1; identity-adjacent → P2; content/CX → P3) already matches this
phase's own stated criteria exactly.

| Priority                                        | Contexts                                                                                                                                                                                                                   | Real-DB coverage                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **P0** — data integrity/money/auth/irreversible | finance, licensing, returns, checkout                                                                                                                                                                                      | **0 of 4** — none covered. `payments` (also P0) **is** covered (A.22, 9 tests).                           |
| **P1** — core transactional flows               | cart, fulfillment, shipping, tenancy                                                                                                                                                                                       | **0 of 4** — none covered. `inventory` (also P1-class, oversell-critical) **is** covered (A.22, 8 tests). |
| **P2** — identity/access-adjacent               | identity, feature-registry, feature_flags                                                                                                                                                                                  | 0 of 3                                                                                                    |
| **P3** — content/CX/platform-intelligence       | catalog, pricing, media, notifications, pages, seo, components, content, theme, experience, localization, search, reviews, recommendations, promotions, coupons, loyalty, wishlist, reporting, automation, experimentation | 0 of 21                                                                                                   |

**Task 11 instructs implementing only P0/P1 blockers. Not done this phase** — every P0/P1 context
needing new coverage (finance, licensing, returns, checkout, cart, fulfillment, shipping, tenancy)
requires a real `lumo_test` Postgres instance to write and run the integration suite against, exactly
like the Payments/Inventory suites A.22 added. **Blocked by §2**, same root cause as Tasks 2/4-live/5/6/7.
This is the same gap A.19 through A.22 have each named and each deferred, one phase further —
disclosed as a recurring, not-yet-closed risk rather than reframed as newly acceptable.

---

## 12-13. Tasks 12-13 — Observability & Alerting

**Reused existing infrastructure, added nothing new except what the watchdog itself needed (Task 12's
own instruction: "do not add an observability platform if one already exists").**

**Already present and confirmed real (not re-built):** Prometheus scrape config
(`infrastructure/docker/prometheus/prometheus.yml`) covers `lumo-runtime` (api/worker/scheduler, port 3080) and `redpanda` (`/public_metrics`, port 9644). Alertmanager routing
(`infrastructure/docker/alertmanager/alertmanager.yml`) — page→oncall (10s wait, 1h repeat),
ticket→chatops, with inhibition rules (a process-down page suppresses its downstream symptom alerts).
9 pre-existing alert rules across availability/SLO/messaging/saturation/security, each with a runbook
anchor in `docs/operations/RUNBOOKS.md`.

**Genuine gap found (not fixed — no exporter exists, adding one is new infrastructure this phase can't
verify without Docker):** **no PostgreSQL exporter, no Kafka Connect/Debezium metrics scrape target
exists anywhere in this stack.** `prometheus.yml` has zero targets for Postgres — connection failures,
high connection usage, replication lag, WAL growth, and disk usage are **not observable via Prometheus
today**, contradicting Task 12's checklist for Postgres observability. This is real and unfixed;
documented rather than silently left implicit.

**Added this phase (the part that _is_ now observable, because the watchdog itself provides it):**

- 3 new metrics (§3) covering exactly the "Debezium: connector state, task state, FAILED detection,
  restart count" bullets from Task 12's own list.
- 2 new Prometheus alert rules in `infrastructure/docker/prometheus/rules/alerts.rules.yml`:
  - `CdcConnectorTaskFailed` (`cdc_connector_task_failed == 1` for 3m → page) — fires if a task stays
    FAILED across ~6 watchdog polls, i.e. the watchdog either can't reach Connect or hasn't caught up
    yet.
  - `CdcWatchdogRestartCapReached` (`increase(cdc_watchdog_restarts_skipped_total[1h]) > 0` → page) —
    fires the moment the restart-loop guard (Task 4 Case D) gives up, meaning automatic recovery has
    stopped and a human is now required.
- 2 new runbook sections in `docs/operations/RUNBOOKS.md` (`#cdc-connector-task-failed`,
  `#cdc-watchdog-restart-cap-reached`), following the existing Symptom→Diagnose→Mitigate→Verify→
  Escalate format exactly, citing the real `curl` commands A.22 proved work.

**Not added (named, not silently skipped):** a Kafka Connect worker health scrape (Connect exposes its
own JMX/metrics only via a separate exporter sidecar, not evaluated this phase) and any Postgres
exporter deployment — both are new infrastructure additions this phase's Docker outage made impossible
to verify before proposing.

---

## 14. Task 14 — Staging Deployment Simulation: not executed

**Cannot be honestly claimed as run.** `deploy.yml` supports a `staging` environment via
`workflow_dispatch` input, gated by a GitHub Environment (`environment: staging`), and would execute
exactly the sequence Task 14 specifies (validate → scan → verify-signature → migrate → deploy → wait
for rollout → rollback-on-failure) — but **no evidence exists anywhere in this repo's history that this
workflow has ever actually been run against a real staging cluster.** No staging k8s cluster, no
staging Postgres, and (per §17) no k8s manifest for Postgres/Redis/Redpanda/observability exists at all
in this repo to provision one from. Declarative _capability_ to do this exists; actual execution does
not, and this phase — blocked on even the _local_ Docker stack — could not supply it either.

---

## 15. Task 15 — Deployment Rollback Test

**Scenario A (app deployment fails):** `deploy.yml`'s `deploy` job has an explicit `Rollback on
failure` step (`if: failure()`) running `kubectl -n lumo-runtime rollout undo deployment/<d>` for
`runtime-api`/`runtime-worker`/`runtime-scheduler`. Real, present in the workflow, **not executed this
phase** (would need a real cluster).

**Scenario B (migration deployment fails):** the `migrate` job runs strictly before `deploy`
(`needs: [validate, scan, verify-signature]`, and `deploy` itself `needs: [..., migrate]`) — a failed
migration blocks the image rollout entirely; Postgres is left in whatever partial-migration state
`prisma migrate deploy` itself leaves on failure (Prisma applies migrations transactionally per-file
where the SQL permits — not independently re-verified this phase). No compensating rollback-migration
step exists in the workflow; `prisma migrate resolve`/manual intervention would be the real recovery
path, consistent with Prisma's own operational model, not a gap specific to this repo.

**Scenario C (rolling compatibility, N+1 app vs migration state N):** not evaluated — would require
reading every migration for backward-compatible-by-default patterns (additive columns, no destructive
renames without a two-phase migration) across all 37 migrations, out of this phase's time budget; named
as unverified, not assumed safe.

**Scenario D (CDC unavailable during deployment):** directly answered by A.22 + this phase's watchdog:
WAL retention means no business event is lost regardless of deployment-time CDC unavailability (A.22
§8), and the watchdog (§3) now shortens how long that unavailability can persist unattended.

---

## 16. Task 16 — Runtime / HTTPS / Domain / Runtime Audit

- **CORS:** not configured on the runtime API or admin app (no CORS middleware/headers found); the
  Ingress carries no CORS annotation either — consistent with a server-to-server API with no browser
  cross-origin callers. The collector (a separate, browser-facing surface) _does_ implement explicit
  origin allow-listing, correctly scoped to where it's actually needed.
- **Cookies:** storefront guest-cart cookie is `httpOnly`, `secure` (prod-gated), `sameSite: lax`;
  locale cookie is deliberately `httpOnly: false` (must be client-readable, non-sensitive); collector
  visitor/session cookies use `SameSite=Lax` with a prod-gated secure flag.
- **Auth/OAuth:** `AUTH_ISSUER_URL`/`AUTH_JWKS_URL`/`KETO_*`/`KRATOS_*` are fail-closed-required outside
  `local` (`config.ts` `superRefine`). Production values in `10-config.yaml` use a placeholder domain
  (`auth.lumo.example.com`) — expected for a template, not a real value leak.
- **Webhooks:** Stripe webhook boot-fails closed outside `local` unless both `STRIPE_SECRET_KEY`/
  `STRIPE_WEBHOOK_SECRET` are set; no literal webhook URL committed (correctly operator-provisioned).
- **Health endpoints:** `/healthz` (liveness), `/readyz` (fail-closed readiness), `/metrics` all real
  (`health-server.ts`); both Ingresses explicitly keep them cluster-internal-only, never through the
  public path.
- **Graceful shutdown:** `SIGINT`/`SIGTERM` handlers disconnect Prisma + flush telemetry; k8s sets
  `terminationGracePeriodSeconds: 30` with a `preStop` drain hook; `tini` forwards signals correctly in
  the container image.
- **TLS/Ingress:** all three Ingresses (API/collector/storefront) set TLS 1.2/1.3-only, HSTS (2yr,
  preload), and per-surface security headers (strict `default-src 'none'` CSP for the JSON API,
  intentionally no CSP yet for the HTML storefront pending nonce-wiring — explained inline, not an
  oversight). **Cert issuance itself is not verifiable statically** — the file states certs come from
  cert-manager/secret-manager externally, but no `Certificate`/`ClusterIssuer` resource exists in this
  repo to confirm that automation is actually wired anywhere.

---

## 17. Task 17 — Docker Production Strategy

**Real, significant gap, confirmed by direct comparison of `docker-compose.yml` against
`infrastructure/k8s/kustomization.yaml`'s resource list:** PostgreSQL, Redis, ClickHouse, MinIO,
Redpanda (+console/topics), Apicurio, the entire OTel/Prometheus/Loki/Tempo/Grafana observability
plane, Mailpit, pgAdmin, and RedisInsight all exist in compose (local/dev-parity) but **have no k8s
equivalent anywhere in this repo.** `50-networkpolicy.yaml`'s own comments acknowledge this explicitly
("infra... may live in another namespace or be external... until the infra placement is known") — this
is a disclosed, not accidental, gap, but it means **production's entire data and observability plane
has no committed declarative deployment path in this codebase.** It is presumably externally
provisioned/managed, which this repo cannot itself verify.

**The one dependency this pattern explicitly does NOT apply to — closed, not a gap:** Debezium
connector registration. `register-connector.sh` is compose-only/manual; `infrastructure/k8s/
70-debezium.yaml`'s `debezium-register-outbox` Job is the real, declarative k8s equivalent (idempotent
`PUT`, waits for Connect's REST API, sources DB coordinates from a Secret) — this one item is properly
remediated, the exception rather than the pattern.

**No Docker Desktop / developer-machine dependency in the actual deploy path:** `deploy.yml` uses
`kubectl` against a `KUBECONFIG_B64` secret on `ubuntu-latest` GitHub-hosted runners; images build via
`build.yml`/`release.yml`, also runner-hosted. This session's Docker Desktop breakage (§2) affected only
_local verification work_, never anything in the actual CI/CD path — worth stating explicitly since it
would be easy to conflate the two.

**No local bind-mount dependency:** compose uses named volumes throughout for stateful data (only the
dev-only `web` service source-bind-mounts for hot reload, expected).

---

## 18. Task 18 — Security Audit

- **Committed credentials:** one real finding, already fixed (§0). Every other credential in
  `docker-compose.yml` follows an obvious placeholder pattern (password literally equals the service
  name). No `sk_live`, AWS key-shaped strings, or PEM blocks found via pattern search. `security.yml`
  runs `gitleaks` on every PR + weekly — a real gate, though its pattern-matching would likely **not**
  have caught the pgAdmin finding (gitleaks targets API-key/token shapes, not an arbitrary human
  password), which is exactly why a second, non-pattern-based read-through mattered here.
- **Port exposure (compose):** every infra port (`postgres`, `redis`, `clickhouse`, `redpanda`,
  `pgadmin`, `redisinsight`) binds `HOST:CONTAINER` with no explicit IP, i.e. Docker's default `0.0.0.0`
  — a local-dev posture; worth flagging if this compose file is ever run on a shared/cloud host, though
  it has no k8s equivalent to carry the same exposure into production (§17).
- **k8s Service exposure:** every k8s Service is `ClusterIP` or headless (`clusterIP: None`) — none are
  `LoadBalancer`/`NodePort`. Public reachability is Ingress-only (3 hosts, §16). No Postgres/Redis/
  Redpanda Service exists in k8s at all (§17 gap).
- **pgAdmin gating:** no Compose `profiles:` key exists anywhere in the file — pgAdmin and RedisInsight
  are always-on under a plain `docker compose up`, not opt-in. Minor, local-only.
- **Grafana:** `admin`/`admin` default credentials locally (disclosed placeholder, same pattern as
  everything else); no k8s Grafana manifest exists to check a production posture against (§17 gap
  applies here too — can't verify what isn't declared in this repo).
- **DB role least-privilege:** `01-roles-and-cdc.sql` documents `lumo_app` as the intended
  least-privilege application role, but every `DATABASE_URL` this audit actually found connects as
  `lumo` (the migration/superuser role) — see §9's finding, same discrepancy, not re-stated as new here.
  The `debezium` role is correctly scoped (`LOGIN REPLICATION` only, no superuser).

---

## 19. Task 19 — Full Quality Gates

Run for real, against the actual repository, this session:

| Gate         | Command                                    | Result                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck    | `pnpm run typecheck`                       | **78/78 packages, 0 errors** (2m 22.7s)                                                                                                                                                                                                                                                                                                 |
| Lint         | `pnpm run lint`                            | **78/78 packages, 0 errors** (1m 9.8s)                                                                                                                                                                                                                                                                                                  |
| Architecture | `pnpm run arch`                            | **0 violations — 1,566 modules, 6,789 dependencies cruised** (matches A.22's last-known-good exactly)                                                                                                                                                                                                                                   |
| Test         | `pnpm exec turbo run test --concurrency=1` | First run surfaced 2 real self-inflicted failures from this phase's own edits (§19a). Both fixed; `apps/runtime` re-verified standalone: **30/30 test files, 184/184 tests passing**. DB-gated (`describe.runIf(DATABASE_URL_TEST)`) suites elsewhere in the monorepo correctly **skip** without a live Postgres (§2) rather than fail. |

**§19a — two real self-inflicted test failures, found and fixed, not hidden:** the first full
`turbo run test` run this phase failed with `@platform/runtime` returning 2 failures:

1. `composition.test.ts`'s `scheduler jobs` test asserted `buildJobs(core).map(j => j.name)` equals
   exactly `["outbox-prune"]` — broken by adding the `cdc-watchdog` job. Fixed: assertion now expects
   `["outbox-prune", "cdc-watchdog"]`.
2. `metrics.test.ts`'s self-verifying "every metric the alert rules query is actually emitted" test
   (built for investigation H-04, guards against exactly this class of silent-alert bug) failed because
   its regex scans the **entire** `alerts.rules.yml` file, comments included, for anything that looks
   like `word)`/`word[`/`word{`/`word<op>` — this phase's own new rule comment contained the English
   phrase `"...is unreachable) or..."`, which the scanner misread as a PromQL series reference. Fixed
   by rewording the comment (no functional/rule change) to `"...Connect can't be reached) or..."`.

Re-verified clean after both fixes: `apps/runtime` **30/30 test files, 184/184 tests passing**.

**`pnpm governance` / `pnpm dup` — do not exist**, confirmed authoritatively, not from memory:
`.github/workflows/validate.yml`'s own comment states it explicitly (_"this workflow originally also
ran `governance` and `dup`. Neither script exists on `main`... They return as their own isolated change
once the harness and its baselines are restored"_), and `package.json`'s `scripts` block has no
`governance`/`dup` entry anywhere in the repo (`grep` across every `package.json`, zero matches).
**This directly contradicts `docs/operations/PRODUCTION_CHECKLIST.md:8`**, which still claims `[x]`
against _"Full gate green: typecheck · lint · arch · test · **governance** · **dup**"_ — a stale,
overclaiming checklist item, named here rather than propagated. The same checklist also claims (lines
45-46) load/stress/soak/chaos suites exist at `perf/README.md`/`chaos/README.md` — **neither path
exists in this repository** (`Glob` confirms zero matches). **`PRODUCTION_CHECKLIST.md` should not be
trusted as evidence without independent verification** — two of its `[x]` items do not correspond to
anything real in the current tree. Not corrected in this phase (out of the phase's own declared scope
to avoid unrelated doc sweeps), but flagged prominently because the next reader of that checklist
should not trust it blindly either.

---

## 20. Production Readiness Matrix

| Area                      | Status                                            | Evidence                                                                                                                                                     | Blocker                                                                                                |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| PostgreSQL (schema/drift) | GREEN                                             | A.19-A.22, this phase's typecheck/arch pass                                                                                                                  | —                                                                                                      |
| Prisma migrations         | GREEN                                             | `db-integration.yml` + `deploy.yml` gate every push/deploy; A.21/A.22 fresh-DB proof                                                                         | —                                                                                                      |
| Schema integrity          | GREEN                                             | A.21 closed the 61-table drift; A.22 re-confirmed zero drift same day                                                                                        | —                                                                                                      |
| Transactions              | GREEN                                             | A.22 §13, real commit/rollback/failure-atomicity evidence                                                                                                    | —                                                                                                      |
| Concurrency               | GREEN                                             | A.22 §14, genuine concurrent-session races proven (Payments, Inventory)                                                                                      | —                                                                                                      |
| Idempotency               | GREEN                                             | A.22 §9 at-least-once + existing inbox/dedupe pattern proven correct                                                                                         | —                                                                                                      |
| CDC (event integrity)     | GREEN                                             | A.22 §9-10, zero loss across 15+ restart cycles, 2 outage shapes                                                                                             | —                                                                                                      |
| Debezium recovery         | **YELLOW→ (mechanism built, live-proof pending)** | Watchdog implemented + 16 unit tests passing this phase; live end-to-end re-proof blocked by §2                                                              | Run the live drill once Docker is back (§14 of this matrix maps to §18 action list below)              |
| Redpanda                  | GREEN                                             | A.22 §7, standard broker-reconnect behavior confirmed                                                                                                        | —                                                                                                      |
| WAL safety                | GREEN                                             | A.22 §8, bounded growth, never `lost`, no orphaned/duplicate slots                                                                                           | —                                                                                                      |
| Backups                   | **RED**                                           | Script + docs exist and are well-built; **nothing schedules them, no restore drill ever run**                                                                | Wire a CronJob (needs an image with pg_dump+awscli) + run a real restore drill                         |
| Restore                   | **RED**                                           | Same as above — `restore-postgres.sh` exists, never exercised                                                                                                | Same                                                                                                   |
| Observability             | YELLOW                                            | Runtime/messaging/CDC-watchdog metrics real and scraped; **no Postgres or Kafka Connect exporter exists**                                                    | Add exporters if/when justified by an actual incident or explicit requirement (not done speculatively) |
| Alerting                  | YELLOW                                            | 11 real alert rules with runbooks (9 pre-existing + 2 new CDC ones this phase); no backup-failure alert (follows from the RED backup item)                   | Add once a backup job exists to alert on                                                               |
| Security                  | YELLOW                                            | 1 real credential leak found **and fixed this phase**; still in git history pending a rewrite decision; DB role least-privilege discrepancy named, not fixed | Rotate the credential; decide on history rewrite; verify/switch the app's DB role                      |
| Staging deployment        | **RED**                                           | Workflow capability exists (`deploy.yml`); **no evidence it has ever actually been run**                                                                     | Run it, once a real staging cluster exists to target                                                   |
| Rollback                  | YELLOW                                            | App-rollback step real and present in `deploy.yml`; never executed; migration-rollback and N+1-compatibility scenarios unverified                            | Execute a real rollback drill                                                                          |
| Integration coverage      | YELLOW                                            | 2/33 highest-risk contexts closed (A.22); **0 new this phase** (blocked); all P0/P1 gaps from A.22 still open                                                | Close Finance/Licensing/Returns/Checkout (P0) next, once Docker is back                                |
| HTTPS/domain              | GREEN                                             | TLS 1.2/1.3, HSTS, per-surface security headers all real; cert-issuance automation itself unverifiable statically                                            | —                                                                                                      |
| Quality gates             | GREEN                                             | 78/78 typecheck, 78/78 lint, 0 arch violations, this session, real                                                                                           | —                                                                                                      |

---

## 21. Remaining Risks

1. **The pgAdmin credential is fixed in the working tree but still lives in git history** until the
   user decides on a history rewrite. The password should be treated as compromised and rotated
   regardless of that decision.
2. **No production backup is proven to work.** This is the single largest gap this phase found —
   larger than the CDC watchdog gap it was explicitly asked to close, because a backup that has never
   been restored is (per this repo's own documentation) "a hypothesis, not a backup."
3. **The CDC watchdog is implemented and unit-proven against the real Kafka Connect contract shape, but
   has not yet been proven end-to-end against the live stack this session** — the Docker outage that
   blocked this is a local-environment issue, not a code defect, but the live proof is still owed.
4. **31 of 33 A.21-corrected contexts remain without real-database integration coverage**, including
   all of Finance/Licensing/Returns/Checkout (P0) — a risk this project's reports have now named in
   A.20, A.21, A.22, and this phase, four times running, without closing it further than
   Payments+Inventory.
5. **No Postgres/Kafka Connect Prometheus exporter exists** — this phase's own new CDC metrics are real
   and scraped, but the broader Task 12 ask (Postgres connection/disk/replication-lag visibility) is
   still unmet.
6. **Production's entire data and observability plane (Postgres/Redis/Redpanda/ClickHouse/MinIO/
   Prometheus/Grafana/etc.) has no committed k8s deployment path in this repository** — presumed
   externally managed, unverifiable from here.
7. **`docs/operations/PRODUCTION_CHECKLIST.md` contains at least two stale/false `[x]` claims**
   (governance/dup gates, perf/chaos suites) — should not be trusted without independent verification
   until corrected.
8. **Staging deployment and rollback have real, well-built automation but zero recorded executions** —
   capability is not the same as proof.

---

## 22. Final Go/No-Go Decision

# **CONDITIONAL GO**

Not GO: three concrete, named, unresolved items remain — none of them a code-correctness defect, all
of them "the mechanism exists, the proof doesn't yet":

1. **Backup/restore has never been proven.** (§7, §21.2) — the loudest, most concrete blocker in this
   report.
2. **The CDC watchdog this phase built is unit-proven but not yet live-proven end-to-end.** (§4, §21.3)
3. **P0 integration coverage (Finance/Licensing/Returns/Checkout) remains open**, a four-phases-running
   recurring gap. (§11, §21.4)

Not NO-GO: nothing in this phase (or A.19-A.22 before it) found a reproducible correctness defect in
the money/transaction/concurrency/CDC-integrity path itself — every one of those areas is GREEN with
real, repeated, independent evidence. The three items above are **operationally executable, explicitly
scoped, and already have the mechanism/script/code in place** — they need a live environment and an
afternoon, not a design change. That is precisely the shape Task 21 defines as CONDITIONAL GO
("operationally manageable YELLOW items remain with explicit procedures"), not NO-GO.

**The condition, explicitly:** before promoting to Production Deployment Ready, in this order:

1. Run one real Postgres restore drill on disposable infrastructure; wire a scheduled backup (even a
   simple CronJob against a minimal custom image is enough — perfection is not required, proof is).
2. Run the CDC watchdog's live end-to-end drill (kill Postgres past the retry budget, confirm the
   watchdog detects + restarts + zero-loss automatically) once Docker is available again.
3. Close Finance's real-DB integration coverage next (highest remaining P0 by A.22's own
   reasoning — 12 models, the largest untested Tier-1 context).

---

## 23. Exact Commands Used

```bash
# Docker/WSL2 diagnosis
wsl --status ; wsl -l -v ; wsl --list --all -v ; wsl -d docker-desktop -- echo ok
docker version --format '{{.Server.Version}}' ; docker info ; docker ps
"C:\Program Files\Docker\Docker\resources\com.docker.diagnose.exe" check

# Watchdog verification
pnpm --filter @platform/runtime exec tsc --noEmit
pnpm --filter @platform/runtime run typecheck
pnpm --filter @platform/runtime test -- --run scheduler.test.ts

# Full quality gates
pnpm run typecheck
pnpm run lint
pnpm run arch
pnpm exec turbo run test --concurrency=1

# Evidence gathering (read-only)
git log --oneline -- infrastructure/docker/docker-compose.yml
git show HEAD:infrastructure/docker/docker-compose.yml
grep -r "governance\"|\"dup\"" **/package.json   # zero matches
```

## 24. Exact Test Counts

- `apps/runtime` scheduler suite alone: **16/16 passing** (7 pre-existing outbox-prune + 10 new
  CDC-watchdog test cases, one parameterized ×3 — 16 counted, not 17, per vitest's own count).
- `apps/runtime` full package (after fixing the 2 self-inflicted failures in §19a): **30/30 test
  files, 184/184 tests passing.**
- Full monorepo typecheck: **78/78 packages**.
- Full monorepo lint: **78/78 packages**.
- Full monorepo architecture (dependency-cruiser): **0 violations, 1,566 modules, 6,789 dependencies**.
- Full monorepo test (`turbo run test --concurrency=1`): first run — **77/78 packages passing, 1
  failing** (`@platform/runtime`, both failures self-inflicted by this phase's own edits, root-caused
  and fixed in §19a); DB-gated suites elsewhere correctly skipped (no `DATABASE_URL_TEST`) rather than
  failed. `@platform/runtime` re-verified standalone after the fix: 30/30 files, 184/184 tests. A full
  monorepo re-run was not repeated after the fix (would re-execute all 78 packages for a 1-package
  change); the fix is narrowly scoped and independently re-verified at the package level.

## 25. Changes Made (all uncommitted, per sprint-isolation discipline)

- `infrastructure/docker/docker-compose.yml` — pgAdmin credential fix (§0).
- `.env.example`, `.env` — pgAdmin placeholder vars; `KAFKA_CONNECT_URL` documented.
- `apps/runtime/src/scheduler.ts` — `runCdcWatchdog`, `CdcWatchdogState`, `cdc-watchdog` job.
- `apps/runtime/src/scheduler.test.ts` — 10 new tests.
- `apps/runtime/src/composition.test.ts` — updated 1 pre-existing assertion for the new job (§19a).
- `apps/runtime/src/config.ts` — 5 new `KAFKA_CONNECT_*`/`CDC_WATCHDOG_*` config fields.
- `apps/runtime/src/metrics.ts` — 3 new CDC watchdog metrics.
- `infrastructure/k8s/10-config.yaml` — `KAFKA_CONNECT_URL` wired for production.
- `infrastructure/docker/docker-compose.runtime.yml` — `KAFKA_CONNECT_URL` wired for local parity.
- `infrastructure/docker/prometheus/rules/alerts.rules.yml` — 2 new alert rules.
- `docs/operations/RUNBOOKS.md` — 2 new runbook sections.
- `PHASE_A23_PRODUCTION_DEPLOYMENT_READINESS_REPORT.md` — this report.

## 26. Changes Intentionally Rejected

- Docker Desktop factory reset — would destroy local dev data; user chose to fix it themselves instead.
- A speculative backup CronJob referencing an unverified container image — would fabricate a "closed"
  claim this phase couldn't actually prove.
- A Postgres/Kafka Connect Prometheus exporter — new infrastructure, not justified by a demonstrated
  bottleneck this phase, and unverifiable without Docker.
- git history rewrite to purge the pgAdmin credential — destructive, repo-wide, deferred to the user's
  explicit decision.
- Correcting `PRODUCTION_CHECKLIST.md`'s stale claims — named as a finding rather than silently
  "fixed," to keep this phase's diff scoped to its own stated task list.
