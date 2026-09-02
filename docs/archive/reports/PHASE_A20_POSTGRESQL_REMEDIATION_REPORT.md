# Phase A.20 — PostgreSQL Findings Remediation & Fresh-Database Validation

Date: 2026-08-13

## 1. Executive Summary

Phase A.19 closed the project's first-ever real-PostgreSQL validation gap but surfaced three named
defects and one open question: _can a completely fresh PostgreSQL database deploy this project's
migration chain using only repository artifacts, with no hidden dev-only prerequisite?_

A.20 answers that with real evidence from disposable, isolated PostgreSQL 16 containers (never the
persistent `lumo-postgres-1` volume), while separately regression-testing the existing database. All
three A.19-named defects are closed. Two new defects were found and fixed during A.20 itself (an
orders-suite id-collision bug, and three customer-360 contract files A.19 didn't isolate that carried
the bulk of its "15 failing" count). One large **pre-existing, out-of-scope** defect was discovered —
schema/migration drift across 61 tables — and is documented, not fixed, per this phase's own
constraints on refactor scope. **One operator mistake occurred during this phase** (§9) and is
disclosed in full, including its investigation and remediation.

**Verdict: CONDITIONALLY PRODUCTION READY** — see §7.

## 2. A.19 Findings — Remediation & Verification

| #   | Finding                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Remediation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `20260805000000_outbox_cdc_publication` only runs `ALTER PUBLICATION ... ADD TABLE`; `CREATE PUBLICATION` lived only in the dev init script (`infrastructure/docker/postgres/init/01-roles-and-cdc.sql`), never in a migration. CI (`db-integration.yml`) uses a bare `postgres:16` service with no init scripts, so the migration would fail there identically. | Reproduced on a genuinely empty container: fails with P3018 "publication ... does not exist."                                                                                                                                                                                                                                                                                                                                                                                                                                                 | New migration `20260804120000_outbox_publication_bootstrap`, timestamped **before** the already-applied `20260805000000` (never edit an applied migration — `MIGRATIONS.md` §1). Idempotent `DO $$ ... IF NOT EXISTS ... CREATE PUBLICATION ... END $$` guard. Dev init script's `CREATE PUBLICATION lumo_outbox;` line removed — the publication is now owned entirely by the migration.                                                                                                                                                                                                                                                                                                          | Fresh disposable Postgres (no init script): `prisma migrate deploy` applies all 36 migrations cleanly in one pass. Separately simulated the _existing_ DB's exact ledger state (35 applied + `20260805000000` resolved via `--applied`, matching A.19's history) on a second disposable container, then applied only the new migration — clean, no ordering error, `migrate status` reports up to date. Same migration then applied for real to the existing `lumo` DB (§4) — clean. |
| 2   | 9 integration test files built `createPrismaClient` from an object cast past its type (`as Parameters<typeof createPrismaClient>[0]`) to skip `poolMax`/`connectTimeoutMs`/`statementTimeoutMs`, silently producing `connection_limit=undefined&connect_timeout=NaN` in the real connection string.                                                              | A.19 already fixed the _values_ (uncommitted); A.20 re-audited for scope and for the cast itself.                                                                                                                                                                                                                                                                                                                                                                                                                                             | Repo-wide search confirmed no occurrences beyond the same 9 files. Root cause was that `url` is `string \| undefined` (from `process.env`), which the object literal could never satisfy without a cast. Replaced the per-file inline config + cast with one new shared helper, `createTestPrismaClient(databaseUrl)` (`packages/db/src/testing/index.ts`, exported as `@platform/db/testing` — mirrors the existing `@platform/domain-events/testing` subpath convention). Also found and removed a _second_, fully redundant cast (`as Database`) in 3 of the 9 files — `createPrismaClient`'s return type already **is** `Database`, so the cast was dead.                                      | `pnpm --filter @platform/db --filter @platform/orders --filter @platform/security --filter @platform/customer-360 typecheck` — clean. Zero `as Parameters<...>` / `as Database` occurrences remain in these files (grep-verified; one unrelated `as unknown as Database` mock cast in `services/finance` left untouched — different pattern, not a real DB connection).                                                                                                              |
| 3   | `services/customer-360` test fixtures pass the placeholder `"t0"` where a real ISO timestamp is expected; harmless for in-memory tests, breaks the 4 Prisma-backed integration files with `new Date("t0")` → Invalid Date. A.19 counted 15 failing tests from this.                                                                                              | Re-ran the 4 files after applying A.19's own description of the fix scope — only 2 of the 4 files actually contained a literal `"t0"`; the real majority of the 15 failures traced to **3 shared `*.contract.ts` files** (`attribute-store.contract.ts`, `profile-store.contract.ts`, `session-store.contract.ts`) plus a 4th (`segment-store.contract.ts`) that A.19's investigation didn't isolate — these are invoked by the integration test files via `runXStoreContractTests()` and run against both the in-memory and Prisma adapters. | Added deterministic ISO-timestamp constants (`T0`/`T1`/`T2`, all before/around each file's existing fixed `clock`) in all 4 integration test files and all 4 contract files; replaced every `"t0"`/`"t1"`/`"t2"`/`"t9"` literal used as a `now`/`capturedAt`/`startedAt`/`evaluatedAt`-that-becomes-`enteredAt` argument (confirmed via `domain/segment-membership.ts`'s `nextTimestamps` that `evaluatedAt` flows into the real `enteredAt`/`exitedAt` columns for segments, unlike computed-attributes' `evaluatedAt`, which stays inside a `Json` blob and needed no fix). Left ~40 purely in-memory/unit test files untouched — intentional symbolic data, never reaches a real `Date` parser. | `pnpm --filter @platform/customer-360 typecheck` clean. Full suite: **392/392 passing** (A.19: 377/392) — re-run twice back-to-back to confirm no leftover-row flakiness.                                                                                                                                                                                                                                                                                                            |
| 4   | `apps/runtime/src/composition.test.ts` asserted the health check reports `"unhealthy"` because _nothing was running_ — true for the project's whole prior history, false now that real Postgres/Redis are reachable at `validEnv`'s addresses.                                                                                                                   | Confirmed the health-check implementation (`packages/health/src/registry.ts`, `apps/runtime/src/composition.ts`) is correct and was never the bug — it honestly reports real reachability.                                                                                                                                                                                                                                                                                                                                                    | The test's real contract is "unreachable infra reports unhealthy," not "this specific machine has no Docker." Rewrote the one test to point at a deliberately unreachable target (`127.0.0.1:1`, refuses connections immediately) instead of relying on ambient host state, so it holds regardless of whether Docker is running.                                                                                                                                                                                                                                                                                                                                                                   | `pnpm --filter @platform/runtime test -- composition.test.ts` — 51/51 passing, including the rewritten test (confirms real ECONNREFUSED on both Postgres and Redis probes, aggregate status `unhealthy`).                                                                                                                                                                                                                                                                            |

## 3. Fresh Database Results

Disposable `postgres:16-alpine` container, isolated network port, **no** `docker-entrypoint-initdb.d`
scripts, no persistent volume, never `lumo-postgres-1` or its `lumo_postgres-data` volume.

| Check                    | Result                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh PostgreSQL startup | Clean; `pg_isready` succeeded within 5s of container start                                                                                                                                                                                        |
| Prisma deploy            | ✅ 36/36 migrations applied in one pass, zero manual intervention                                                                                                                                                                                 |
| Migration count          | 36 (35 original + `20260804120000_outbox_publication_bootstrap`)                                                                                                                                                                                  |
| Migration time           | ~3.76s DB-side (18:16:15.390 → 18:16:19.145 UTC), ~6.3s wall-clock incl. CLI startup                                                                                                                                                              |
| Schema creation          | 40 non-system schemas, 133 tables — byte-for-byte match with the existing DB's counts                                                                                                                                                             |
| Publication creation     | ✅ `lumo_outbox` created by the migration itself; `platform.outbox` correctly the sole member, 11 columns, no row filter — identical to the existing DB's publication state                                                                       |
| CDC configuration        | Matches `docker-compose.yml`'s `wal_level=logical`/`max_wal_senders=8`/`max_replication_slots=8`; Debezium's `slot.name: lumo_outbox` is connector-managed, unaffected                                                                            |
| Prisma status            | `Database schema is up to date!` (clean, no drift against the migration history)                                                                                                                                                                  |
| Transaction validation   | ✅ Real: `BEGIN`→`UPDATE`→in-tx `SELECT` (visible)→`ROLLBACK`→fresh-session `SELECT` (reverted); `BEGIN`→`UPDATE`→`COMMIT`→fresh-session `SELECT` (persisted)                                                                                     |
| Concurrency validation   | ✅ Real: two genuinely concurrent sessions (`pg_sleep`-forced lock overlap) racing `UPDATE ... WHERE version=0`; session A committed (0→1), session B's identical `UPDATE` affected 0 rows post-commit. Exactly one write won, zero lost updates. |
| Idempotency validation   | ✅ Real: two concurrent sessions inserting the identical `(consumer_group, message_id)` primary key; one committed, the other received a genuine `duplicate key value violates unique constraint` error. Final count: exactly 1.                  |
| Crash consistency        | ✅ Real: one transaction wrote a dedup marker + an aggregate change (both visible in-tx), then `ROLLBACK` (simulated crash). Verified after: dedup row count 0, aggregate reverted to its last real commit.                                       |

Schema-integrity comparison against the existing DB (§4): identical schema/table/index/constraint/
trigger/extension counts (40/133/366/1365/1/plpgsql-only); `payments.refunds` structurally identical
column-for-column; only meaningful difference was migration count (35 vs. 36) before the fix landed on
both.

## 4. Existing Database Regression

The persistent `lumo-postgres-1` container/volume was **not reset** at any point. The new migration
was applied to it exactly as validated above (idempotent guard confirmed safe beforehand via a
same-history simulation on a disposable container — see §2 row 1).

| Check                                             | Result                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `prisma validate`                                 | ✅ Schema valid                                                                                                      |
| `prisma migrate status`                           | ✅ 36/36 applied, up to date                                                                                         |
| Orders integration suite                          | ✅ 71/71 (found + fixed a real id-collision bug along the way — see §6)                                              |
| Security integration suite                        | ✅ 107/107 (matches A.19 exactly)                                                                                    |
| Customer-360 integration suite                    | ✅ 392/392 (A.19: 377/392 — the 3 additional contract-file fixes closed the gap)                                     |
| Restart stability (3 cycles, real compose config) | ✅ stop ~1.1–1.6s, start-to-healthy ~6.2–6.9s each cycle; migration ledger and publication state stable across all 3 |

## 5. CI Compatibility

**Partially yes, with one large caveat found during this phase.**

`prisma migrate deploy` — the step CI actually runs to provision its database — now succeeds cleanly
against CI's exact setup (bare `postgres:16` service image, no init scripts, matching what was tested
in §3). This was the literal blocker A.19 named and it is closed.

CI's _separate_ drift-check step (`prisma migrate diff --from-migrations ... --to-schema-datamodel ...
--exit-code`, `db-integration.yml`'s "Migration drift" step) would **currently fail**, for a reason
**unrelated to A.19/A.20's outbox fix**: the live schema/*.prisma source files have drifted from the
migration history across 61 tables (33 with real column additions/removals, 28 with cosmetic
index-name-only differences — see §6 for the full breakdown). This is a large, pre-existing condition,
confirmed identical on both the fresh disposable DB and the existing `lumo` DB, so it predates this
phase entirely and is not something A.19's fix or A.20's new migration touches.

**Bottom line:** a clean CI Postgres instance can now reach the same _deployed_ schema state as the
local instance (the original success criterion). It cannot currently pass CI's own drift gate, because
that gate is checking something broader — whether the Prisma schema source files are honestly
migrated — which was already broken before this phase and remains broken after it.

## 6. Additional Findings (Discovered During A.20, Not in A.19)

**Orders integration test id-collision (fixed).** `services/orders/.../prisma-order-repository.integration.test.ts`'s
`"list"` describe block generated fully deterministic tenant/order UUIDs (`monotonicIds()` always
started its counter at `n=0`), with no cleanup between test runs. Against a real, persistent database
this meant a second run of the suite collided with the first: the "empty page" assertion failed
(leftover rows from A.19's original run) and the pagination test hit a primary-key unique-constraint
violation. Fixed by seeding the generator with a random per-run 8-hex-digit prefix, keeping ids
monotonic _within_ one run (which is all the ordering assertion needs) while making them unique
_across_ runs. Verified re-runnable twice in a row. Cleaned the 3 leftover rows this bug had left in
`lumo_test` from A.19's session.

**Massive pre-existing schema/migration drift (documented, not fixed — out of scope).** Running CI's
own drift-check command surfaced 61 tables where the migration-derived schema disagrees with the
current `schema/*.prisma` source files, spanning nearly every bounded context (automation, growth,
saas-foundation, experience-platform, licensing, catalog, media, reviews, and more). 33 tables have
real column-level drift (added/removed/renamed columns); 28 are index-rename-only (cosmetic, likely
from a naming-convention change applied inconsistently). Confirmed identical on the fresh disposable
DB and the existing `lumo` DB — 100% pre-existing, not introduced by this phase. Fixing this would mean
authoring dozens of new migrations across contexts this phase has no mandate to touch, and would
violate the explicit "DO NOT redesign the architecture" / max-refactor-scope constraints governing
A.20. Flagged here as the single most significant finding of this phase, recommended for its own
dedicated migration-regeneration phase.

**`governance`/`dup` tooling absent from the repository.** The project's own standing engineering-
governance memory describes `pnpm governance` (type-ban/event-naming/tenant-scoping enforcement) and
`pnpm dup` (jscpd duplication ratchet) as "COMPLETE / MAINTENANCE MODE," canonically documented under
`docs/governance/`. None of `scripts/governance/`, `docs/governance/`, `.jscpd.json`, or a `governance`/
`dup` script in the root `package.json` exist in the current working tree. This is a stale memory, not
a regression introduced by this phase — flagged as "not available to run," distinct from "failing,"
and outside A.20's scope to reconstruct.

## 7. Migration Safety Review (35 Original Migrations + 1 New)

- One destructive `DROP COLUMN` (`media.folders.key`, `pages.templates.key`, `pages.templates.kind`)
  in the already-applied, historical `20260804000000_sprint5x_schema_reconciliation` — safe: those
  tables had never held a row (confirmed via the migration's own contemporaneous comment), and the
  migration has already run everywhere this project has ever run it. No corrective action needed or
  taken, per "never edit an applied migration."
- One `SET NOT NULL` in the same migration, self-documented as safe for the same reason.
- No other `DROP TABLE`/`TRUNCATE`/`DROP SCHEMA`/unguarded `ALTER COLUMN TYPE` found across any
  migration.
- No `GRANT`/`REVOKE`/`CREATE ROLE`/`CREATE EXTENSION` inside any migration — role/extension
  provisioning is correctly kept out of Prisma's migration history (an ops/infra concern), consistent
  with `MIGRATIONS.md`.
- The one genuine hidden dependency (§2 row 1) is now closed.

## 8. Docker/PostgreSQL Startup Validation

Docker was already healthy at the start of this session (no repeat of A.19's socket-corruption
incident). Ran the postgres service through the project's actual `docker-compose.yml` for 3 full
stop/start cycles — see §4 table. All clean.

## 9. Incident Disclosure: A Live-Database Mistake, Investigated and Remediated

While verifying CI drift-check compatibility (§5), a `prisma migrate diff --shadow-database-url`
command was run with the shadow-database URL mistakenly pointed at the **live `lumo` database**
instead of a separate scratch database. Prisma's diff workflow uses that URL as disposable scratch
space; pointing it at the real database wiped its `_prisma_migrations` bookkeeping table.

**Investigation before any further action:** `pg_stat_user_tables` was queried across every table in
`lumo` — **zero rows existed in any table, before or after** (the database has never served real
application traffic; only the separate `lumo_test` database was ever used for actual data-writing test
evidence, per A.19). All 40 schemas and 133 tables remained structurally intact (Prisma's diff replay
recreates the identical schema from the same migration history). The separate `lumo_test` database was
untouched. **No real data was lost.**

**Remediation:** ran `prisma migrate resolve --applied` for all 36 migrations in the correct order,
restoring the ledger without re-executing any SQL (the schema objects already existed identically from
the replay). Verified: `prisma migrate status` → up to date, publication state correct, schema/table
counts back to their original 40/133. The 3-restart-cycle validation (§8) was then re-run cleanly from
this restored state.

This is disclosed in full because it is exactly the kind of event this phase's constraints (§"Absolute
Constraints": _do not destroy the existing database_) exist to prevent. The mistake is the author's;
the investigation confirming no lasting damage is real, and the recovery is verified, not asserted.

## 10. Remaining Risks

- **Schema/migration drift (§6)** — real, large, pre-existing, unfixed. This is the dominant risk
  carried forward from this phase.
- **CI drift gate will fail** until the above is addressed — a clean CI run would successfully deploy
  the database (§5) but fail the separate drift-check step.
- **Docker Desktop's AF_UNIX socket fragility on this development machine** (A.19 finding) — did not
  recur this session, but remains an unaddressed environment-level risk specific to this machine, not
  the project.
- **`lumo-hydra-1`/`lumo-kratos-1`/`lumo-keto-1`/`lumo-web-1`** (Ory identity stack) — still
  crash-looping/dead per A.19, unrelated to PostgreSQL, out of scope for this phase.
- **`governance`/`dup` tooling absent** — cannot currently enforce the type-ban/duplication ratchets
  the project's own standing rules describe as active; not a PostgreSQL risk, flagged for completeness.

No speculative risks are listed; everything above was directly observed this session.

## 11. Production Readiness Verdict

**CONDITIONALLY PRODUCTION READY**

All three A.19-named defects are closed with real evidence, not static checks. A completely fresh
PostgreSQL 16 database — matching CI's exact bare-image setup — deploys the full 36-migration chain
unattended, with no dev-only prerequisite, and real transaction/concurrency/idempotency/crash-
consistency behavior is proven against it, not merely asserted. The existing, persistent database
remains healthy, fully regression-tested, and (after a fully-investigated and fully-remediated
operator mistake, §9) confirmed to have lost no real data.

The condition is the same shape A.19 left it in, but on a different axis: production readiness is now
gated on a single, large, precisely-scoped, honestly-disclosed defect — pre-existing schema/migration
drift across 61 tables — rather than on unproven infrastructure or unverified fixes. Closing it is a
dedicated migration-authoring phase, not a quick follow-up, and is the clear next step before any
further readiness upgrade.
