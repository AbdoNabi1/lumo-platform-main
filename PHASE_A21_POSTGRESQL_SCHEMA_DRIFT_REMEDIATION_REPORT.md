# Phase A.21 — PostgreSQL Schema Drift Remediation

Date: 2026-08-14
Status: **All 15 tasks COMPLETE with real evidence.** The corrective migration was proven on four
disposable containers before being applied — with explicit user approval — to the live `lumo` and
`lumo_test` databases. Full regression, 3 restart cycles, and a final schema fingerprint all confirm
success.

## 1. Executive Summary

Phase A.20 discovered, but did not investigate, a 61-table drift between the migration-derived
schema and `packages/db/prisma/schema/*.prisma`. This phase found the exact mechanism, the exact
origin commit, and produced (but has not yet applied) a single corrective migration that closes it.

**The drift is not cosmetic.** 33 of the 61 tables have real column-level drift, and this phase
proved directly — with a real generated Prisma Client against a disposable database seeded with
the _live_ 36-migration schema — that this is a genuine, unconditional, 100%-reproducible runtime
failure: `prisma.automationWorkflow.create()` throws `The column 'name' does not exist in the
current database` today, against the schema the live `lumo` database actually has. The same is true
for the other 32 drifted tables. Any real request path that touches Automation, Growth (Promotions/
Coupons/Loyalty/Wishlist), Customer Experience (Reviews/Search/Recommendations), Platform
Intelligence (Reporting/Feature Flags/Experimentation), Experience Platform (Content/Theme/Pages/
SEO/Media/Components/Localization), or SaaS Foundation/Licensing tables would fail identically in
production the moment it ran.

**Root cause found (not merely described):** commit `7925d2b` (`fix(db): restore dropped migrations
and reconcile schema drift (C-04)`, 2026-08-04) hand-authored the migration
`20260804000000_sprint5x_schema_reconciliation` with **no reachable database** (its own commit
message cites `G-41`). It correctly restored 6 missing migrations and closed a _table-existence_ gap
(36 missing tables → 3), and its own verification claim — "table parity is now exact, 132/132" — was
true and is not in dispute. But the migration's column/index names do not exactly match the
`schema.prisma` model files it was written to reconcile against, across 33 tables' columns and 28
additional tables' index names (2 more tables have constraint-name-only drift from the
`MediaFolder`→`Folder`/`PageTemplate`→`Template` renames the same commit made). This is the **first
time this project has ever had a real, reachable PostgreSQL database to check that migration
against** — A.19 (2026-08-13) was the first real-Postgres validation in the project's history, nine
days after this migration was authored blind.

**All 61 drifted tables hold zero rows in both `lumo` and `lumo_test`** (verified via
`pg_stat_user_tables`, not assumed) — this is not a data-migration problem, it is a pure DDL
correction. A single new migration, `20260814000000_a21_sprint5x_column_and_index_reconciliation`,
has been authored, and — critically — has already been **proven on three separate disposable
PostgreSQL 16 containers**, never on `lumo`:

1. Applied on top of a disposable clone of the exact live 36-migration schema, with a seeded
   unrelated row (`orders.orders`) to prove existing data survives — it did.
2. Confirmed `prisma migrate diff --from-migrations --to-schema-datamodel` now reports
   **"This is an empty migration"** — zero remaining drift, machine-verified, not eyeballed.
3. Confirmed a real Prisma Client create/find/delete round-trip against `automation_workflows`
   now succeeds, where it failed identically (same error, same table) against the unpatched
   36-migration schema moments earlier on a separate throwaway container.
4. Confirmed a completely clean `postgres:16-alpine` with **zero** init scripts, zero manual DDL,
   deploys all 37 migrations (36 original + this one) unattended via `prisma migrate deploy`, and
   both `prisma migrate status` and `prisma validate` report clean.

**Verdict: CONDITIONALLY PRODUCTION READY, pending Task 11 approval** — see §11. Everything through
Task 10 is done and evidenced. Applying the proven migration to the live `lumo` database (Task 11) —
and the regression/restart/fingerprint validation that follows it (Tasks 12–14) — has not been done
and requires an explicit go-ahead per this session's operating rules, even though the data-safety
analysis (§7) shows zero rows are at risk.

## 2. Baseline (Task 1)

Captured via `pg_dump --schema-only` + 18 targeted `information_schema`/`pg_catalog` queries against
the live `lumo` database (docker exec, no destructive commands). Full CSVs retained.

| Metric                                   | `lumo` (baseline)                                                     |
| ---------------------------------------- | --------------------------------------------------------------------- |
| PostgreSQL version                       | 16.14 (Alpine, musl)                                                  |
| Database size                            | 15 MB                                                                 |
| Schemas (non-system)                     | 40                                                                    |
| Tables                                   | 133 (132 Prisma-model-backed + `_prisma_migrations` ledger)           |
| Indexes                                  | 366                                                                   |
| Constraints (PK/FK/UNIQUE/CHECK)         | 1,368                                                                 |
| Sequences                                | 0 (all identity columns are UUID/text, no `serial`)                   |
| Triggers                                 | 2 (`security.audit_records` WORM guard: BEFORE UPDATE, BEFORE DELETE) |
| Functions                                | 1 (`security.reject_audit_mutation`, backs the WORM triggers)         |
| Views (app-owned)                        | 0                                                                     |
| Extensions                               | `plpgsql` only                                                        |
| Publications                             | 1 (`lumo_outbox`, `platform.outbox`, `pgoutput`, no filter)           |
| Replication slots                        | 1 (active, `lumo_outbox`, Debezium-owned)                             |
| Migration ledger                         | 36 rows, all applied 2026-08-13 (first real deploy, per A.19)         |
| Row counts, all 61 drift-affected tables | **0**, in both `lumo` and `lumo_test`                                 |

## 3. Drift Reproduction (Task 2)

Two independent comparisons were run — the spec's "fresh vs. lumo" framing and A.20's actual
CI-drift-gate command are different questions, so both were checked:

**(a) Fresh migration-derived schema vs. `lumo`'s actual schema:** a disposable
`postgres:16-alpine` had all 36 migrations applied and its full baseline captured identically to
§2. Every structural file (schemas/tables/columns/indexes/constraints/sequences/triggers/functions/
extensions) was **byte-for-byte identical** to `lumo`'s. The only differences were operational, not
structural: the migration ledger's timestamps (different apply time) and the replication slot
(`lumo`'s Debezium connector has attached; the disposable DB's has not). **Conclusion: `lumo` itself
has zero manual/out-of-band drift from what its own migration history produces.** The 61-table drift
is not a live-database anomaly — it is baked into the migration history itself, applied identically
everywhere.

**(b) Migration-derived schema vs. `schema.prisma` source (the actual CI gate,
`.github/workflows/db-integration.yml` lines 65–71):**

```
prisma migrate diff --from-migrations prisma/schema/migrations \
  --to-schema-datamodel prisma/schema --shadow-database-url <disposable> --script
```

Run against a **disposable throwaway shadow database** (`lumo-a21-shadow-pg`, never `lumo` — see the
Absolute Constraints and A.20 §9's incident this rule exists to prevent). Produced a 519-line SQL
script: 51 `DropIndex`, 35 `AlterTable` blocks, 21 `CreateIndex`, 51 `RenameIndex`. This is the real
61-table drift, and it is what §4–§6 classify below.

## 4. Classification of All 61 Drifted Tables (Task 3)

| Classification                                                                                                                             | Count | Tables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C — Column drift**                                                                                                                       | 33    | `automation.automation_workflows`, `catalog.products`, `components.component_definitions`, `content.content_blocks`, `coupons.coupons`, `experience.experiences`, `experiment.experiments`, `feature_flags.feature_flags`, `licensing.credits`, `licensing.invoices`, `licensing.merchant_capabilities`, `licensing.merchant_feature_overrides`, `licensing.plans`, `licensing.subscriptions`, `licensing.usage_counters`, `localization.locales`, `localization.translation_sets`, `loyalty.loyalty_accounts`, `media.media_assets`, `pages.pages`, `promotions.promotions`, `recommendations.recommendation_models`, `reporting.dashboards`, `reporting.report_definitions`, `reviews.reviews`, `search.search_indexes`, `seo.redirects`, `seo.robots_policies`, `seo.seo_profiles`, `seo.sitemaps`, `tenancy.workspaces`, `theme.themes`, `wishlist.wishlists`                                                                                                                                                                                                               |
| **E — Constraint drift** (PK rename only, tied to the `MediaFolder`→`Folder` / `PageTemplate`→`Template` rename in the same origin commit) | 2     | `media.folders`, `pages.templates`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **D — Index drift** (name-only; underlying columns/uniqueness unchanged)                                                                   | 26    | `components.component_definitions`†, `feature_registry.feature_bundles`, `feature_registry.feature_definitions`, `finance.exchange_rates`, `fulfillment.processed_carrier_webhooks`, `licensing.plans`†, `licensing.subscriptions`†, `localization.locales`†, `notifications.processed_callbacks`, `security.ai_governance_profiles`, `security.audit_records`, `security.consent_projection`, `security.credentials`, `security.delegations`, `security.devices`, `security.identity_membership_projection`, `security.identity_organization_projection`, `security.identity_user_projection`, `security.incidents`, `security.machine_identities`, `security.mfa_enrollments`, `security.policies`, `security.principals`, `security.relation_tuples`, `security.role_assignments`, `security.roles`, `security.sessions`, `security.tenant_profiles`, `seo.redirects`†, `shipping.processed_webhooks`, `tenancy.tenants` (5 marked † also appear in the Column-drift row — their index rename is a side effect of the same column rename, not counted twice in the 61 total) |
| **I — Unknown**                                                                                                                            | 0     | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **A/B/F/G/H — Missing/extra/trigger/sequence/manual-legitimate**                                                                           | 0     | none found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Total unique tables: 33 + 2 + 26 = 61**, exactly matching A.20's count. No table is classified
`Unknown` — every one was resolved to a concrete cause (§5).

**None of this is "legitimate manual drift" (H).** All 61 tables' current `schema.prisma`
definitions were authored _before_ the reconciliation migration that was supposed to match them
(§5), in prior "reconstruct" commits. The drift is a defect in one migration's authoring, not an
intentional divergence.

## 5. Origin Trace & Migration Timeline (Tasks 4 & 5)

Every one of the 61 tables traces to the **same single commit**, confirmed via `git log` on both the
affected `schema.prisma` files and the migration directory:

| Step | Commit                                                                              | Date                    | What it did                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `a886813` and 8 other `feat(...): reconstruct ...` commits                          | 2026-07-30 → 2026-08-03 | Authored/reconstructed the current `schema.prisma` model definitions for all 40 bounded contexts (part of the documented [[lumo-platform-recovery-state]] git-history reconstruction). Each of these commits is the **last** commit to touch its respective `.prisma` file — none of the 61 tables' schema files were edited after step 2.                                                                                                                            |
| 2    | `7925d2b` — `fix(db): restore dropped migrations and reconcile schema drift (C-04)` | 2026-08-04 14:28        | Restored 6 previously-dropped migrations + `tracking.prisma` verbatim from an earlier commit (`de46df9`), then **hand-wrote** `20260804000000_sprint5x_schema_reconciliation` to reconcile the restored migrations' schema with the current (step-1) `.prisma` files. Explicitly: _"no database host is reachable here (G-41)"_ — authored and merged without ever running it against Postgres. Verified only _table_-level parity (132/132), not column/index-level. |
| 3    | (this phase)                                                                        | 2026-08-13/14           | First time any tool has run `prisma migrate diff` for this history against a _real_ database. Surfaced the exact column/index mismatches step 2 introduced.                                                                                                                                                                                                                                                                                                           |

**Migration application timeline:** all 36 migrations (spanning authored dates 2026-07-04 through
2026-08-11) were applied to `lumo` in a single batch on 2026-08-13 (A.19) — the project's first-ever
real deploy. No migration was individually verified against a live database at authoring time; the
entire chain, including the flawed reconciliation migration, was validated only statically
(`prisma validate`, which checks internal schema consistency, not migration-history-vs-schema
equivalence) until this phase.

No other migration in the 36-migration history shows the same defect class — `7925d2b` is the sole
origin. No evidence of manual/out-of-band SQL, no dev-init-script contribution (already ruled out
in §3a — fresh and `lumo` are identical), no incorrect migration _ordering_ (the migrations apply in
a valid dependency order; the _content_ of one migration is simply wrong relative to its stated
target).

## 6. Prisma Schema Audit (Task 6)

- **Models without tables / tables without models:** none. 132 `model` declarations across
  `packages/db/prisma/schema/*.prisma` ↔ 132 model-backed tables + 1 framework table
  (`_prisma_migrations`, expected, not a model).
- **Column drift:** the 33 tables in §4 — full statement-level detail in
  `reconciliation_migration.sql` (checked into the migration below).
- **`@@index`/`@@unique` mismatches:** the 26 index-rename tables in §4, plus the `CreateIndex`/
  `DropIndex` pairs on the 33 column-drift tables (these are compound indexes referencing a renamed
  column, e.g. `automation_workflows_tenant_id_key_key` → `automation_workflows_tenant_id_name_key`
  because `key` became `name`).
- **Relation differences:** none found — no `AddForeignKey`/`DropForeignKey` statements appeared in
  the drift diff at all. All 61 tables' relations are consistent between migration history and
  `schema.prisma`.
- **Unsupported/manual database objects:** none beyond the known, intentional WORM trigger pair
  (`security.audit_records`, §2) and the Debezium-managed `lumo_outbox` publication/slot — both
  already covered by migrations, not drift.
- **Schema mapping (`@@map`/`@@schema`) differences:** none found.

## 7. Data Safety Assessment (Task 7)

Every one of the 61 tables was checked directly against `pg_stat_user_tables` in **both** `lumo` and
`lumo_test` (not assumed from "should be empty" — queried).

| Check                                                            | Result                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Row count, all 61 tables, `lumo`                                 | 0 (all)                                                    |
| Row count, all 61 tables, `lumo_test`                            | 0 (all)                                                    |
| Would any `DROP COLUMN` lose data                                | No — zero rows anywhere                                    |
| Would any `ADD COLUMN ... NOT NULL` (no default) fail            | No — empty tables never violate `NOT NULL` on `ADD COLUMN` |
| Would any index/constraint change be blocked by existing data    | No — no rows to violate uniqueness or check constraints    |
| Would any rename (`RENAME CONSTRAINT`/`RENAME INDEX`) touch data | No — metadata-only operations                              |

**Risk classification for all 61 tables: LOW.** No `MEDIUM`, `HIGH`, or `BLOCKED` items exist in this
drift set. This is the reason a single additive/corrective migration (§8) is sufficient and safe —
there is no data-migration problem to solve, only a schema-definition correction.

## 8. Remediation Plan (Task 8)

**Single decision for all 61 tables: "Migration required."** No table needed a different category
(no "manual object should remain," no "Prisma schema correction required" — the `.prisma` files are
correct; it is the applied migration that is wrong, and per the project's own rule an applied
migration is never edited, only superseded).

**Migration authored:** `packages/db/prisma/schema/migrations/20260814000000_a21_sprint5x_column_and_index_reconciliation/migration.sql`
— exactly the 519-line drift script from §3(b), applied verbatim as a new, forward-only migration.
Currently present in the working tree, **not yet applied to `lumo` or `lumo_test`**.

No items were classified `HIGH` or `BLOCKED` — nothing was deferred for a separate architectural
decision.

## 9. Disposable Reconciliation Test (Task 9) — PASSED

On `lumo-a21-fresh-pg` (disposable, exact clone of `lumo`'s 36-migration schema):

1. Seeded a representative row into an **unrelated** table (`orders.orders`, order number
   `ORD-A21-TEST`) to stand in for real application data that must survive.
2. Ran `prisma migrate deploy` — the new migration applied cleanly, no errors, no manual
   intervention.
3. Confirmed the seeded `orders.orders` row was **still present, unchanged**, after the migration.
4. Confirmed `\d automation.automation_workflows` now shows exactly the `schema.prisma`-declared
   columns (`name`, `trigger_type`, `event_type`, `cron_expression`), and every other drifted
   table's structure now matches `schema.prisma`.
5. Re-ran `prisma migrate diff --from-migrations --to-schema-datamodel` against a fresh disposable
   shadow — output: **`-- This is an empty migration.`** Zero remaining drift, machine-verified.
6. `prisma migrate status` → "Database schema is up to date!"; `prisma validate` → "The schemas...
   are valid."
7. **Direct proof of the production-risk claim, both directions:**
   - Regenerated Prisma Client, ran a real `create`/`findMany`/`delete` against
     `prisma.automationWorkflow` on the _patched_ database → **succeeded** (create id + name +
     triggerType returned correctly, count 1, delete succeeded).
   - The identical script, same generated client, run against a **separate** disposable container
     holding only the original unpatched 36 migrations → **failed identically to how it would fail
     in production today**: `PrismaClientKnownRequestError: The column 'name' does not exist in the
current database.` This is not a hypothetical risk; it is the current, live behavior of `lumo`.

## 10. Fresh-Environment Validation (Task 10) — PASSED

New, never-before-used `postgres:16-alpine` container (`lumo-a21-cleanroom-pg`): empty database, no
init SQL, no pre-created schemas/publications, no hidden dependencies of any kind.

```
prisma migrate deploy   → 37 migrations found, all applied, "All migrations have been successfully applied."
prisma migrate status   → "Database schema is up to date!"
prisma validate         → "The schemas at prisma\schema are valid 🚀"
```

A completely fresh environment reaches the same intended schema as `schema.prisma` — the canonical
source — in one unattended pass. Both disposable containers used for Tasks 9–10, plus the two used
transiently for the shadow-diff and the "before" proof, have been removed
(`docker rm -f lumo-a21-fresh-pg lumo-a21-shadow-pg lumo-a21-premigration-pg lumo-a21-cleanroom-pg`).
None of them touched `lumo` or `lumo_test`.

## 11. Existing Database Validation (Task 11) — APPLIED, with explicit user approval

User approved proceeding before any write touched `lumo`. Sequence actually run:

1. **Pre-apply safety backups** (full `pg_dump`, schema+data, not just schema-only): `lumo` (15 MB
   database → 200,439-byte dump) and `lumo_test` (14 MB → 448,075-byte dump), both taken via
   `docker exec` before any DDL ran. Database sizes and the full baseline (§2) were already on
   record from Task 1.
2. `prisma migrate deploy` against `lumo` (`localhost:5432/lumo`) — the one new migration applied
   cleanly: _"All migrations have been successfully applied."_ The 36 already-applied migrations
   were untouched.
3. Same command against `lumo_test` (needed for Task 12's real-database integration suites) — same
   clean result.
4. **Immediate post-apply verification against `lumo`:**
   - `prisma migrate status` → "Database schema is up to date!"
   - `prisma validate` → "The schemas at prisma\schema are valid 🚀"
   - `automation.automation_workflows` row count still 0 (sanity check — no accidental data write)
   - CDC publication intact: `lumo_outbox` still owns exactly `platform.outbox`, same 11 columns,
     no row filter
   - Replication slot `lumo_outbox` still present and `active = t` immediately after the migration
   - `prisma migrate diff --from-migrations --to-schema-datamodel` against a **fresh disposable
     shadow database** (`lumo-a21-postverify-shadow`, never `lumo` — removed immediately after) →
     **`-- This is an empty migration.`** Zero drift remains, for the whole 37-migration history,
     machine-verified against the actual post-apply migration set.

No destructive command was ever run against `lumo` or `lumo_test` directly — all diff/shadow
operations used disposable throwaway containers throughout, consistent with the Absolute
Constraints and the incident A.20 §9 exists to warn against.

## 12. Regression Validation (Task 12) — ALL GREEN

Run with `DATABASE_URL_TEST` pointed at the now-migrated `lumo_test`, so the real Prisma-backed
integration suites executed (not skipped):

| Suite                                                                           | Result                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Orders integration (`prisma-order-repository.integration.test.ts` + unit tests) | **71/71**                                                    |
| Security integration (3 Prisma-backed files + unit tests)                       | **107/107**                                                  |
| Customer-360 integration (5 Prisma-backed files + unit tests)                   | **392/392**                                                  |
| Full repo test suite (`pnpm test`, 78 packages)                                 | **78/78 packages green**                                     |
| Full repo typecheck (`pnpm typecheck`, 78 packages)                             | **78/78**                                                    |
| Full repo lint (`pnpm lint`, 78 packages)                                       | **78/78**                                                    |
| Architecture validation (`depcruise`)                                           | **0 violations** (1,566 modules, 6,789 dependencies cruised) |

All three counts (71/107/392) match A.20's baseline exactly — **zero regression** from applying the
reconciliation migration. No integration test files exist yet for the 33 newly-corrected contexts
(Automation/Growth/Licensing/Experience-Platform/etc. — only Orders/Security/Customer-360 have real
`*.integration.test.ts` files in the repo today); this is an honest pre-existing coverage gap, not
something this phase could paper over, and is flagged in §14.

## 13. Restart & Persistence Validation (Task 13) — PASSED, 1 operational finding

3 full stop/start cycles of `lumo-postgres-1` via the real `docker-compose.yml`:

| Cycle | Stop time | Start-to-healthy |
| ----- | --------- | ---------------- |
| 1     | 1.89s     | 7.22s            |
| 2     | 1.15s     | 6.23s            |
| 3     | 1.16s     | 6.50s            |

After the 3rd restart, verified directly against `lumo`:

- `prisma migrate status` → up to date (37/37)
- Table count 133, index count 332, constraint count 1,314 — all stable, no drift reappeared
- `automation.automation_workflows` still has `name`/`trigger_type`/`event_type`/`cron_expression`
  and the corrected unique index — the fix survived the restarts
- Publication `lumo_outbox` structurally intact

**One real, out-of-scope operational finding:** the replication slot's `active` flag went from `t`
(true, pre-restart baseline, §2) to `f` (false, no `active_pid`) after the restart cycles. Debezium's
container itself stayed `healthy` (its REST API responds), but its container logs show the
`lumo-outbox` connector task explicitly `Stopping down connector` when the Postgres TCP connection
dropped (`EOFException`), and — 5+ seconds of subsequent log activity showed only REST polling, no
reconnection attempt. **This is a Debezium/Kafka-Connect connector-resilience gap (no auto-restart
on source-disconnect), not schema drift** — the publication and slot _definitions_ the migration
history owns are fully intact and correct; what's missing is the _running connector task_
reattaching automatically. Out of scope for a schema-drift-remediation phase (no schema object is
wrong or missing); flagged for a dedicated CDC-pipeline-resilience phase, same treatment A.19/A.20
gave the crash-looping Ory stack.

## 14. Final Schema Fingerprint (Task 14)

A brand-new disposable `postgres:16-alpine` had all 37 migrations deployed, then both it and the
post-A.21 `lumo` were dumped with `pg_dump --schema-only --no-owner --no-privileges` and compared
line-by-line.

| Check                                                                                            | Result                                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Line count, fresh-37 dump                                                                        | 3,752                                                  |
| Line count, `lumo` post-A.21 dump                                                                | 3,752                                                  |
| `prisma migrate diff --from-migrations --to-schema-datamodel`                                    | `-- This is an empty migration.`                       |
| Line-by-line `Compare-Object`                                                                    | Only difference: `pg_dump`'s own per-invocation random |
| `\restrict`/`\unrestrict` session nonces (a dump-security feature, not schema content) — **every |
| one of the other 3,750 lines of actual DDL is byte-for-byte identical**                          |

**`lumo == fresh-migrations`, with zero undocumented differences.** The only intentional,
documented divergence between any two environments in this phase is operational (replication slot
`active` state, §13) — never structural.

## 15. Remaining Risks

- **Debezium connector does not auto-reattach after a Postgres restart** (§13) — real, newly
  observed, out of scope for this phase, needs a dedicated CDC-resilience follow-up.
- **No real-database integration test coverage for the 33 newly-corrected contexts** (§12) —
  Automation/Growth/Licensing/Experience-Platform/etc. have no `*.integration.test.ts` files at all
  yet, so this phase's fix is verified by direct Prisma Client evidence (§9) and structural
  fingerprint (§14), not by an existing test suite. Recommended follow-up, not blocking.
- **Docker Desktop's AF_UNIX socket fragility** (A.19 finding) — did not recur this session, remains
  an unaddressed environment-level risk on this machine.
- **`lumo-hydra-1`/`lumo-kratos-1`/`lumo-keto-1`/`lumo-web-1`** (Ory identity stack) — still crash-
  looping/dead, unrelated to PostgreSQL, out of scope.

No speculative risks are listed — everything above was directly observed this session.

## 16. Production Readiness Verdict

**CONDITIONALLY PRODUCTION READY.**

This phase closes A.20's central open question with real, end-to-end evidence: the 61-table drift is
fully explained (one hand-authored migration written without database access, that didn't exactly
match the schema files it targeted), fully classified (33 column / 2 constraint / 26 index, zero
unknowns), fully traced to its origin commit, and closed with a single corrective migration that was
proven on four separate disposable databases _before_ being applied to `lumo` and `lumo_test` with
explicit user approval. Post-apply: zero remaining drift (machine-verified against `schema.prisma`
directly, and via byte-for-byte fingerprint against a fresh 37-migration database), zero regression
across 71+107+392 real-database integration tests and all 78 repo packages' typecheck/lint/test/arch
gates, and the fix survives 3 real restart cycles of the persistent database.

The condition is no longer the 61-table drift — that is closed. It is now the two items in §15: a
CDC-pipeline resilience gap this phase correctly did not attempt to fix (different problem class,
different owner), and a pre-existing integration-test-coverage gap for the 33 newly-corrected
contexts. Neither blocks the schema itself from being correct and consistent, which was this phase's
actual mandate.
