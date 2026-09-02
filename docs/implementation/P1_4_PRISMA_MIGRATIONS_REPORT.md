# P1.4 — Restore Prisma Migrations

**Milestone:** P1.4 — **executed before P1.3** (sequencing correction, §2)
**Closes:** [C-04](../investigations/C-04-migration-schema-drift.md)
**Baseline:** `0e9e374` (P1.2)
**Date:** 2026-08-04
**Method:** restore the dropped migrations from `de46df9`; diff schema against migrations; write one additive corrective migration for the drift the restore exposed; verify with `prisma validate` + `prisma generate`.

---

## 1. Objective

Investigation C-04 found **36 of 129 tables** declared in `prisma/schema/` had no `CREATE TABLE` in any migration. `prisma migrate deploy` on a fresh production database would report success while producing a schema missing 36 tables, and every Prisma call against them would fail with `relation … does not exist`.

The tables belonged to Sprints 5.1–5.6 and the Tracking platform — six migrations plus `tracking.prisma`, all written before and dropped from `main` during the history reconstruction.

---

## 2. Sequencing correction — P1.4 ran before P1.3

The brief orders P1.3 (tracking) before P1.4 (migrations). **P1.3 cannot compile before P1.4.** `apps/runtime/src/tracking/prisma-event-record-store.ts` references `db.trackingEventRecord` and `db.trackingEventRevision`, which are declared in `tracking.prisma` — a file absent from `main` and restored by _this_ milestone.

I restored the tracking runtime first, hit exactly that wall, reverted it cleanly, and ran the migrations milestone instead. No other order works. P1.3 follows immediately.

---

## 3. Restored files

| Migration                                       | Contexts                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `20260713010000_commerce_growth_sprint51`       | promotions, coupons, loyalty, wishlist                                  |
| `20260713020000_customer_experience_sprint52`   | reviews, search, recommendations                                        |
| `20260713030000_platform_intelligence_sprint53` | reporting, feature_flags, experiment, automation                        |
| `20260713040000_experience_platform_sprint54`   | content, localization, seo, components, theme, experience, pages, media |
| `20260713050000_saas_foundation_sprint55`       | tenancy, licensing                                                      |
| `20260713060000_saas_refinements_sprint56`      | tenancy/licensing refinements                                           |
| `20260719120000_tracking_platform_p5_m6`        | tracking                                                                |
| `packages/db/prisma/schema/tracking.prisma`     | the Tracking models themselves                                          |

**8 paths restored verbatim from `de46df9`. 0 restored migrations were edited.**

Chronological ordering verified: the restored `20260713*` directories slot cleanly between `20260712100000_notifications_core_sprint412` and `20260714000000_feature_registry_p1_1`; `20260719120000` sits between the security-session-federation and commerce-core-p7 migrations. No timestamp collision, no reordering of existing migrations.

`feature-flags.prisma` was **not** restored. `de46df9` carries it as `feature-flags.prisma` (hyphen) while `main` already has `feature_flags.prisma` (underscore) with the same models; restoring it would have produced duplicate model definitions. Verified `main`'s copy covers the restored migration's tables.

---

## 4. Files added / modified

### 4.1 `20260804000000_sprint5x_schema_reconciliation` — new corrective migration

Restoring the six migrations took the gap from 36 tables to **3**, and surfaced two _name mismatches_ the original audit could not see (they only become visible once the migrations exist):

| `prisma/schema` on `main`            | Restored migration creates                    | Nature                                       |
| ------------------------------------ | --------------------------------------------- | -------------------------------------------- |
| `media.folders` (`model Folder`)     | `media.media_folders` (`model MediaFolder`)   | renamed after the migration was authored     |
| `pages.templates` (`model Template`) | `pages.page_templates` (`model PageTemplate`) | renamed after the migration was authored     |
| `reporting.analytics_reports`        | _(nothing)_                                   | model added later; no migration ever written |

The differences are more than renames — comparing the restored SQL against `main`'s models:

- **media**: `key` column and its `(tenant_id, key)` unique index dropped; `parent_ref` → `parent_folder_ref`
- **pages**: `key` and `kind` dropped; `experience_ref` tightened to `NOT NULL`; uniqueness moved from `(tenant_id, key)` to `(tenant_id, name)`
- **reporting**: `analytics_reports` created with its `(tenant_id, report_definition_ref)` index

Written by hand — the same offline method `MIGRATIONS.md` §1 documents for the initial migration, since no database host is reachable here (G-41). It is **additive**: the restored migrations stay byte-for-byte as authored, per the repo's own rule _"never edit an applied migration; always add a new one."_ Every statement is safe on an empty database and on one that applied the restored migrations, because per G-41 these tables have never existed in any deployed database.

### 4.2 `packages/db/prisma/schema/main.prisma` — `tracking` added to the datasource

`prisma validate` failed with three `P1012` errors: _"This schema is not defined in the datasource"_ for `tracking.prisma`'s three models. When `tracking.prisma` was dropped from `main`, `"tracking"` was also removed from the datasource `schemas` array. Restored to match `de46df9`.

### 4.3 `packages/db/prisma/schema/media.prisma` — declare the retained index

The restored migration creates `media_folders_tenant_parent_idx`. `main`'s `Folder` model declared no index, so keeping it would have been permanent drift, and dropping it would have removed a real access path — `media-library.use-cases.ts` passes `parentFolderRef` when listing a folder's children. Added `@@index([tenantId, parentFolderRef])` so schema and database agree, and the corrective migration renames the index to Prisma's convention rather than dropping it.

### 4.4 `.github/workflows/db-integration.yml` — migration-drift gate

Deferred from P1.1 to this milestone precisely so it would go green in the same commit as the fix:

```yaml
- name: Migration drift (schema vs migrations)
  run: |
    pnpm --filter @platform/db exec prisma migrate diff \
      --from-migrations prisma/schema/migrations \
      --to-schema-datamodel prisma/schema \
      --shadow-database-url "$DATABASE_URL" \
      --exit-code
```

**This is the check whose absence allowed 36 tables to go missing unnoticed.** `--exit-code` returns non-zero on any drift.

### 4.5 `apps/runtime/src/metrics.test.ts` — type error from P1.2 fixed

Regenerating the Prisma client invalidated the turbo cache and typechecked `metrics.test.ts` for the first time, exposing two errors: `HealthReport` requires `checkedAt`, and `ComponentHealth` requires `durationMs`.

**This was my process error in P1.2.** I ran `pnpm typecheck` _before_ adding the test file, then ran only `lint`/`test`/`arch` afterwards — and `pnpm test` runs vitest, which does not typecheck. The P1.2 gate table is therefore accurate for what was run but the file was never typechecked. Corrected here with real values rather than a cast; the assertions are unchanged.

---

## 5. Verification

### 5.1 Table parity — exact, accounting for renames

The same analysis that found the 36-table gap, re-run with `ALTER TABLE … RENAME TO` resolution:

```
SCHEMA TABLES   : 132
MIGRATION TABLES: 132

MISSING FROM MIGRATIONS: 0
EXTRA IN MIGRATIONS   : 0
```

Before this milestone: 129 schema tables, 93 in migrations, **36 missing**.

### 5.2 `prisma validate` — actually executed

```
$ DATABASE_URL=… npx prisma validate
Prisma schema loaded from prisma\schema
The schemas at prisma\schema are valid 🚀
```

(Without `DATABASE_URL` set, validate fails on `env("DATABASE_URL")` alone — an environment artefact, not a schema defect.)

### 5.3 `prisma generate` — actually executed

```
✔ Generated Prisma Client (v6.19.3) … in 2.30s
```

The client now exposes the Tracking models, which is the precondition for P1.3.

### 5.4 Not verified — `prisma migrate deploy`

No database host is reachable (`docker info` → daemon unreachable; the G-41 blocker). The corrective migration's SQL has **not been executed**. It is verified by construction and by parity analysis only. `db-integration.yml` runs `migrate deploy` + the drift gate against a real Postgres 16 on the first CI run — that is where this milestone gets its final proof. Recorded as risk R1.

---

## 6. Quality gate results

| Gate            | Command           | Result                                                        |
| --------------- | ----------------- | ------------------------------------------------------------- |
| Typecheck       | `pnpm typecheck`  | ✅ 76 successful, 76 total                                    |
| Lint            | `pnpm lint`       | ✅ 76 successful, 76 total                                    |
| Test            | `pnpm test`       | ✅ 76 successful, 76 total                                    |
| Architecture    | `pnpm arch`       | ✅ no dependency violations (1531 modules, 6529 dependencies) |
| Prisma validate | `prisma validate` | ✅ schemas are valid                                          |
| Prisma generate | `prisma generate` | ✅ client generated (v6.19.3)                                 |
| Governance      | `pnpm governance` | ⚪ not available (see P1.1 §7)                                |

---

## 7. Risks

| #   | Risk                                                                                                                                                                              | Severity | Mitigation                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | No migration in this repository has ever been applied to a real database, including the corrective one. `migrate deploy` could still fail on a statement `validate` cannot catch. | **High** | `db-integration.yml` (restored in P1.1) runs `migrate deploy` + the new drift gate against Postgres 16 on the first CI run. Local verification blocked by G-41 / C-09. |
| R2  | The corrective migration assumes the restored migrations ran first. Applied out of order, `ALTER TABLE "media"."media_folders" RENAME TO "folders"` fails.                        | Low      | Prisma applies migrations in lexicographic timestamp order; `20260804000000` sorts last. Ordering verified in §3.                                                      |
| R3  | 36 previously-unmigrated tables will exist for the first time. The 70 currently-skipped integration tests will run against them for the first time and may fail.                  | Medium   | Intended, not a regression — those failures are pre-existing defects that were invisible. Triage on the first CI run.                                                  |
| R4  | `@@index([tenantId, parentFolderRef])` is a schema addition, not a pure restore.                                                                                                  | Low      | Justified by a real access path and by the alternative being permanent drift. Recorded here rather than made silently.                                                 |
| R5  | The restored Sprint 5.x tables belong to contexts that still run in-memory (C-01), so the schema is correct but unused.                                                           | Medium   | By design — C-04 had to land first, or fixing C-01 would crash. This is exactly the ordering constraint the investigation index records. **P1.5** consumes it.         |

---

## 8. Deferred items

| Item                                                   | Reason                                                      | Where it belongs                                                |
| ------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------- |
| Executing `migrate deploy`                             | No database host (G-41).                                    | First CI run of `db-integration.yml`; C-09 for the local stack. |
| Wiring the 35 in-memory contexts onto these tables     | Distinct milestone.                                         | **P1.5**                                                        |
| Tracking runtime consuming `tracking.prisma`           | Unblocked by this milestone.                                | **P1.3**, next                                                  |
| `feature-flags.prisma` / `feature_flags.prisma` naming | Resolved by not restoring the duplicate; no further action. | —                                                               |

---

## 9. State after this milestone

**C-04 closed.** Schema and migrations are at exact parity (132/132). The drift gate that would have prevented the original defect is now in CI. `prisma validate` and `prisma generate` both pass, and the generated client exposes the Tracking models — the precondition P1.3 needs.

---

## 10. Commit

Single isolated commit; working tree clean. No public TypeScript API changed. The generated Prisma Client gains the Tracking models and the three reconciled tables — additive; no existing accessor is removed or renamed.
