# Phase A.19 — Real PostgreSQL Validation Report

Date: 2026-08-13

## 1. Executive Summary

- **Docker root cause:** Docker Desktop's backend was crash-looping on startup because of orphaned AF_UNIX socket files (`dockerInference`, `docker-secrets-engine\engine.sock`, `dockerEthernetVfkit`, `userAnalyticsOtlpHttp.sock`) that Windows' native file APIs (plain delete, `fsutil reparsepoint delete`, `.NET File.Delete`, elevated `takeown`) could not remove under any circumstance, including after a full reboot and with every Docker process killed. The reliable fix was deleting the files through WSL's Linux filesystem layer (`wsl -d Ubuntu-24.04 -- rm -f /mnt/c/...`), which succeeds where every native Windows method fails. Two Windows reboots occurred during diagnosis (one deliberate, one an unplanned mid-session power-off) and a Windows Defender exclusion was added — neither was the actual fix; both are documented for completeness but the WSL-`rm` method is the one that resolved it.
- **PostgreSQL status:** Healthy, real, and now fully migrated. Container `lumo-postgres-1` has been running continuously since 2026-07-05 on the same volume (`lumo_postgres-data`) without ever being recreated.
- **Prisma status:** Fully connects and now matches the database. `prisma migrate status` genuinely reaches PostgreSQL (previously blocked entirely by the Docker outage — this is the first time in the project's history this has succeeded).
- **Real DB validation:** Now established. See §5–§8 for genuine, reproducible evidence (not fabricated, not in-memory-only) of transactions, optimistic concurrency, idempotency, and crash-recovery consistency.
- **Major discovery:** The running database had been frozen at the very first migration (`20260704000000_init`, applied 2026-07-06) for the entire project's life — all 34 subsequent migrations, spanning every sprint from Finance through the refund-idempotency hardening work, had never been applied to any persisted database. Every prior "CONDITIONALLY PRODUCTION READY" verdict (Phases A.1–A.18) was necessarily validated only against static checks and mocks, because this is the first session in which Docker/Postgres has ever actually worked.

## 2. Docker Diagnosis

| Aspect         | Finding                                                                                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Engine  | CLI 29.5.3 healthy throughout; the _backend_ (Linux engine) crashed on startup                                                                                                                                                                                                                                    |
| Docker Desktop | Backend crashed repeatedly on `starting services: initializing <Module> manager: listening on unix://...: remove ...: The file cannot be accessed by the system` — a different module each relaunch (Inference → Secrets Engine → Ethernet vfkit), because it stops at the first stale socket file it can't clear |
| WSL2           | Healthy the entire time — v2.7.10.0, kernel 6.18.33.2-2, `docker-desktop` and `Ubuntu-24.04` distros both registered. Not the root cause; a red herring early in diagnosis                                                                                                                                        |
| Context        | `desktop-linux`, correctly configured throughout                                                                                                                                                                                                                                                                  |
| Resources      | Disk had ~11.4GB free at the start — low, flagged as a risk for Docker VHDX growth, not a root cause                                                                                                                                                                                                              |
| Crashes        | Root cause confirmed via `com.docker.backend.exe.log`: orphaned AF_UNIX socket reparse points (0-byte, `Archive, ReparsePoint` attributes) that no Win32 file API could remove                                                                                                                                    |
| Networking     | Port 5432 was free throughout (`Get-NetTCPConnection`/`netstat` empty) — no conflicting process                                                                                                                                                                                                                   |

**Fix that worked:** `wsl -d Ubuntu-24.04 -- rm -fv /mnt/c/Users/abdoh/AppData/Local/Docker/run/dockerInference /mnt/c/.../dockerEthernetVfkit /mnt/c/.../userAnalyticsOtlpHttp.sock /mnt/c/Users/abdoh/AppData/Local/docker-secrets-engine/engine.sock`

**Fixes that did NOT work (documented to save time in future incidents):** Windows Defender exclusions (added, harmless, not causal); Windows reboots (cleared the _first_ corrupted socket once, but a second socket corrupted independently and survived a second clean reboot); force-killing Docker processes mid-startup (this itself appears to _cause_ further socket corruption — avoid `Stop-Process -Force` on a Docker process unless it has already fully crashed and is idle).

## 3. PostgreSQL Configuration

Validated via `docker compose -f infrastructure/docker/docker-compose.yml config` against the expected baseline — matches exactly, plus additional logical-replication flags:

| Field          | Value                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Image          | `postgres:16-alpine`                                                                                       |
| Database       | `lumo`                                                                                                     |
| User           | `lumo`                                                                                                     |
| Password       | `lumo`                                                                                                     |
| Container port | 5432                                                                                                       |
| Host port      | 5432                                                                                                       |
| Healthcheck    | `pg_isready -U lumo -d lumo`                                                                               |
| Volume         | `postgres-data` → `/var/lib/postgresql/data` (created 2026-07-05, never recreated)                         |
| Extra          | `wal_level=logical`, `max_wal_senders=8`, `max_replication_slots=8` (for the Debezium/outbox CDC pipeline) |

## 4. Connectivity

| Path                                    | Result                                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host → PostgreSQL (TCP)                 | `Test-NetConnection localhost -Port 5432` → succeeded                                                                                               |
| Host → PostgreSQL (SQL, published port) | Throwaway `postgres:16-alpine` client container → `SELECT 1` → succeeded                                                                            |
| Container → PostgreSQL (internal)       | `docker exec lumo-postgres-1 psql` → `SELECT version()/current_database()/current_user/now()` → PostgreSQL 16.14, db `lumo`, user `lumo`            |
| Prisma → PostgreSQL                     | `DATABASE_URL=postgresql://lumo:lumo@localhost:5432/lumo` (host-side execution, correctly using `localhost` not `postgres`) → connects successfully |

## 5. Migration Validation

**Before any fix:** `prisma migrate status` reached PostgreSQL for the first time ever and reported the database at `20260704000000_init` only — 34 migrations pending, applied nowhere, ever, on this persisted database (created 2026-07-05).

**Investigation (no fabrication, root cause confirmed):** the database volume/container is the project's original, continuously-running instance — never recreated. Nobody had ever run `prisma migrate deploy` against it.

**Remediation (user-approved):** `prisma migrate deploy` applied 30/34 migrations cleanly. Migration `20260805000000_outbox_cdc_publication` failed with P3018 (`relation "outbox" is already member of publication "lumo_outbox"`) — investigated and confirmed the live publication state exactly matched the migration's intended target (added via manual DDL outside Prisma's tracking at some earlier point, consistent with active CDC replication activity observed in the postgres logs since July). Resolved via `prisma migrate resolve --applied`, then the remaining 3 migrations applied cleanly.

**Result:** `prisma migrate status` → `Database schema is up to date!` (35/35 migrations applied). Verified stable across 3 restart cycles (§9).

**Related defect found (not fixed, out of scope for this infra-audit phase):** migration `20260805000000_outbox_cdc_publication` implicitly depends on the local dev init script (`infrastructure/docker/postgres/init/01-roles-and-cdc.sql`) having already run `CREATE PUBLICATION lumo_outbox;` — no migration creates that publication itself. This means the migration would fail identically on any environment without that init script, **including the project's own CI** (`.github/workflows/db-integration.yml` uses a bare `postgres:16` service with no custom init scripts). Confirmed by creating a genuinely fresh `lumo_test` database and pre-running only the publication-creation statement — all 35 migrations then applied in one pass with no manual resolution needed, proving the dependency.

## 6. Transaction Validation (Task 9)

Direct SQL evidence against `lumo_test`, `orders.orders` table:

1. `BEGIN` → `UPDATE ... customer_ref = 'uncommitted-should-vanish'` → `SELECT` inside the same transaction confirmed the value **was visible**.
2. `ROLLBACK` → fresh session `SELECT` confirmed the value **reverted** to its pre-transaction state.
3. `BEGIN` → `UPDATE ... customer_ref = 'committed-value'` → `COMMIT`.
4. Fresh session `SELECT` confirmed the value **persisted durably**.

Independently corroborated by real integration test suites (§8) exercising the actual application's `PrismaUnitOfWork`/`unitOfWork.run()` transaction wrapper — not just raw SQL.

## 7. Concurrency Validation (Task 10)

All three cases used genuinely concurrent PostgreSQL sessions (parallel background jobs with `pg_sleep`-forced lock overlap — not sequential calls).

**Case A — optimistic concurrency (no lost update):** Two sessions raced `UPDATE orders.orders SET version = version + 1 WHERE id = X AND version = 0`. Session A held the row lock for 3 seconds and committed (version 0→1). Session B blocked on the lock, then found `version = 0` no longer matched post-commit → `UPDATE 0`. **Exactly one write won; zero lost updates.** Independently corroborated by `PrismaOrderRepository`'s real integration test "rejects a stale write with ConcurrencyError (no retry, no silent overwrite)," which now passes against real Postgres.

**Case B — idempotency key (exactly one side effect):** Two sessions concurrently inserted the identical `(consumer_group, message_id)` primary key into `platform.inbox_processed_events`. Session A committed. Session B received a real, deterministic `duplicate key value violates unique constraint "inbox_processed_events_pkey"` error. Final row count: exactly 1.

**Case C — crash/rollback dedup consistency:** A single transaction wrote both a dedup marker (`inbox_processed_events`) and an aggregate change (`orders.customer_ref`) — both visible inside the transaction — then was rolled back (simulating a crash before commit). Verified afterward: dedup row count = 0, aggregate value reverted to its last real commit. **No phantom dedup state is possible when tied to the same transaction boundary.**

## 8. Idempotency Validation — Real Integration Test Suites

First-ever execution of the project's `DATABASE_URL_TEST`-gated integration suites against real PostgreSQL:

| Suite                                                                                                  | Result                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `@platform/orders` (`prisma-order-repository.integration.test.ts` + full package)                      | **71/71 passed**                                                                           |
| `@platform/security` (Prisma repositories, identity/consent projections, WORM audit-chain enforcement) | **107/107 passed**                                                                         |
| `@platform/customer-360`                                                                               | 377/392 passed, 15 failed (see §10 — pre-existing test-fixture defect, not an infra issue) |

**Real bug found and fixed (uncommitted, flagged for review):** all 9 integration test files' `wire()`-style helpers built their Prisma client via an incomplete config object cast past TypeScript (`{url, logQueries} as Parameters<typeof createPrismaClient>[0]`), which caused `packages/db/src/client.ts`'s `buildDatasourceUrl` to inject literal `connection_limit=undefined&connect_timeout=NaN` into the real connection string — rejected by Prisma's engine specifically for interactive-transaction operations. This is why none of these integration suites had ever successfully run before. Fixed by supplying `poolMax`/`connectTimeoutMs`/`statementTimeoutMs` in all 9 occurrences (`services/orders`, `services/security` ×3, `services/customer-360` ×5).

## 9. Restart Stability

3 cycles of `docker compose stop postgres` / `start postgres`, timed:

| Cycle | Docker | PostgreSQL                       | Health  | Port 5432 | Prisma/SQL    |
| ----- | ------ | -------------------------------- | ------- | --------- | ------------- |
| 1     | stable | stop 1.3s, start-to-healthy 6.1s | healthy | reachable | `SELECT 1` OK |
| 2     | stable | stop 0.9s, start-to-healthy 6.2s | healthy | reachable | `SELECT 1` OK |
| 3     | stable | stop 1.2s, start-to-healthy 6.1s | healthy | reachable | `SELECT 1` OK |

`prisma migrate status` re-confirmed "Database schema is up to date!" after all 3 cycles. Postgres logs show WAL-based crash recovery ran successfully on every restart throughout today's Docker instability (multiple ungraceful terminations from the Docker Desktop crash-loop) — the database replayed cleanly every time with no data loss.

## 10. Remaining Infrastructure Risks

**Proven defects:**

- Migration `20260805000000_outbox_cdc_publication` is not self-contained; depends on a manual init-script step and would fail identically in CI (§5).
- 9 integration test files had a connection-string-building bug that silently prevented them from ever running against real Postgres (§8) — now fixed, uncommitted.
- `services/customer-360` test fixtures (~70+ call sites) use the placeholder string `"t0"` where real ISO timestamps are expected; harmless for in-memory unit tests, but breaks all 4 Prisma-backed integration test files with `new Date("t0")` → Invalid Date. Not fixed (out of scope for an infra audit) — 15 tests currently fail for this single root cause.
- `apps/runtime`'s `composition.test.ts` has one test asserting the health-check registry reports `"unhealthy"` when "no Docker runtime" is present — this assumption held for the project's entire prior history but is now false, since Postgres/Redis are genuinely reachable. Not a bug; the health check is correctly reporting real state. The test's expectation needs updating for a world where real infrastructure exists.

**Proven risks:**

- Docker Desktop's AF_UNIX socket handling on this machine is fragile — any ungraceful termination (crash, force-kill, power loss) can orphan a socket file that no Windows-native tool can clear, requiring the WSL-`rm` workaround or a reboot. This is a standing operational risk for this development machine specifically, not the project.
- `lumo-hydra-1` and `lumo-kratos-1` (Ory identity stack) are crash-looping; `lumo-keto-1` is dead (exit 127); `lumo-web-1` fails to start. None of these block PostgreSQL and were out of scope per this phase's instructions, but they represent real, separate defects worth their own investigation.

**Environment issues:**

- Disk free space (~11.4GB at session start) is a standing constraint worth monitoring.

**Unverified assumptions:**

- Whether the customer-360 "t0" pattern also causes silent (non-crashing) incorrect behavior in any _non-integration_ code path was not investigated — only the crash-on-Invalid-Date symptom was confirmed.

## 11. Production Readiness Impact

The prior "CONDITIONALLY PRODUCTION READY" verdict (accumulated across Phases A.1–A.18) can now be **partially strengthened and partially newly questioned**:

- **Strengthened:** Real transaction, optimistic-concurrency, and idempotency-key behavior are now proven against genuine PostgreSQL — not asserted from mocks. This was the single largest gap named across A.12–A.18 and is now closed for the orders and security domains specifically.
- **Newly at risk:** The database had silently never been migrated past its initial schema for the project's entire life. This means every previous phase's "verified" claims about Payments, Returns, Fulfillment, Finance, Security Platform, etc. schema behavior were validated only against Prisma's static schema definition, never against an actual applied database — a materially different (weaker) form of evidence than was implied. Now that migrations are applied, this gap is closed going forward, but it means the _specific_ claims in A.1–A.18 about database-dependent behavior should be treated as unverified until re-run against this now-real database.
- **New, real defects surfaced** (§10) that no prior phase could have found, because no prior phase ever reached a real, running, migrated PostgreSQL instance.

**Verdict: CONDITIONALLY PRODUCTION READY — upgraded from "conditional on unproven infrastructure" to "conditional on a short, named list of real defects"** (§10), which is a materially stronger position than any prior phase reached. Recommend re-running the customer-360 test-fixture fix and the outbox-publication migration fix as focused follow-up work before the next verdict upgrade.
