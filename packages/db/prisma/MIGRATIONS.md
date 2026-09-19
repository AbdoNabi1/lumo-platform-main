# Migration strategy (`@platform/db`)

> Phase 2 Step 1. Schemas live in `prisma/schema/` (one file per bounded context + `platform`);
> one PostgreSQL schema per context (D-002); conventions in `schema/main.prisma`.

## 0. Migrations location (root-cause fix, 2026-07-05)

**`prisma/schema/migrations/` — INSIDE the schema folder.** With a multi-file schema, Prisma
anchors the migrations directory to the directory of the `.prisma` file containing the
`datasource` block (verified in the installed `prisma@6.19.3` build: `primaryDatasourceDirectory
?? schemaRootDir ?? cwd/prisma`), NOT to `prisma/` as with single-file schemas. The Sprint-2.1
offline bootstrap placed it at the single-file location by mistake; `migrate deploy`/`status`
therefore reported "No migration found". Fixed by `git mv` to the documented location. The
Prisma-7 `prisma.config.ts` migration (§4) will pin it explicitly via `migrations.path`.

## 1. Workflow

- **Bootstrap:** the initial migration (`20260704000000_init`) was generated **offline** with
  `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema --script` (that particular
  environment had no database host). **This paragraph is now stale — corrected 2026-09-09.** The
  platform since moved off local Docker onto managed cloud infrastructure (Supabase Postgres,
  `docs/operations/CLOUD_RUNBOOK.md`), and `20260704000000_init` through
  `20260814000000_a21_sprint5x_column_and_index_reconciliation` (37 migrations) were bulk-applied
  there on 2026-08-23 (`prisma migrate status` against the live `.env`-configured `DATABASE_URL`
  shows all 37 with a `finished_at` within an 11-minute window that day). Two more migrations exist
  **in the live database's `_prisma_migrations` table but nowhere in this repo's git history, on
  any branch**: `20260823000000_rls_tenant_isolation` and `20260823010000_rls_nullable_tenant_write_
check` — applied 2026-08-23 07:11 and 13:50 respectively (six and a half hours apart, so two
  separate manual interventions, not one script). Reconstructed from the live schema (Prisma stores
  a checksum, not the SQL text, so the original files are not recoverable): every business table
  gets `ENABLE`+`FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy
  (`tenant_id = current_setting('app.tenant_id', true)` for both `USING` and `WITH CHECK`, 130
  policies total across 128 tables), except `platform.outbox`/`platform.audit_events`, whose
  `USING` clause is `(tenant_id IS NULL) OR (tenant_id = current_setting(...))` — matching the
  second migration's "nullable" name and this file's own §3 RLS plan below. **This means the RLS
  layer §3 describes as a to-do is in fact already live in production** — see
  `docs/plans/BLOCKERS.md`'s 2026-09-09 entry for the full drift report.

  **Both halves of that drift are CLOSED as of 2026-09-19 — 40 migrations, files and history in
  agreement.** What closed them, and one correction worth keeping:

  - The two RLS migrations were reconstructed a second time from live introspection on 2026-09-19
    (130 tables carrying `tenant_id`, 130 `tenant_isolation` policies, 130 tables with `FORCE ROW
LEVEL SECURITY`, and — checked explicitly — **no** tenant-scoped table without a policy) and
    committed as real migration files. The nullable-read variant is on exactly two tables,
    `platform.audit_events` and `platform.outbox`, confirming the earlier reading.
  - **`prisma migrate resolve --applied` was NOT needed and does not work here.** Running it
    returns `P3008`, "already recorded as applied". The live database always had the history rows
    — that is precisely how `migrate status` surfaced the gap ("found in the database but not
    locally"). Only the files were missing, so committing them was the entire fix, with no write
    to the live database at all. `migrate resolve --applied` is for the opposite drift: a file
    that exists locally which the database has never recorded. Recorded here because the obvious
    reading of "the history is out of sync" points at the wrong command.
  - WP-11's `20260909000000_wp11_float_to_decimal_money_columns` was deployed on 2026-09-19 via
    `migrate deploy`, after confirming by direct query that all four affected tables
    (`licensing.usage_counters`, `licensing.credits`, `pricing.pricing_rules`,
    `finance.exchange_rates`) held **zero rows** — so the type change rewrote no data and the
    absent backup (Supabase free tier keeps none, and this environment has no `pg_dump`) bounded
    no real risk. Do not read that as a precedent for deploying without a backup; it was a
    measured, empty-table exception.

- **Development:** `pnpm db:migrate` (`prisma migrate dev`) against local compose Postgres —
  never edit an applied migration; always add a new one.
- **Production:** `prisma migrate deploy` in CD, before the new app version serves traffic.
  Migrations must stay **expand → migrate → contract** (additive first; destructive change only
  after the previous app version is retired) for zero-downtime deploys (doc 15 §2.4).

## 2. Invariants every migration must preserve

- `tenant_id` on every business row; tenant-led uniques/indexes (ADR-0008).
- `version` optimistic-locking column on every aggregate root table.
- Append-only tables (`orders.order_events`, `identity.consent_records`,
  `platform.audit_events`, `platform.outbox` until published) never gain UPDATE paths.
- No cross-context foreign keys — cross-context references are plain text columns (D-002).

## 3. Hand-written SQL (Prisma cannot express these — add as migration steps)

- **Row-Level Security** per business table: `ENABLE ROW LEVEL SECURITY` + a
  `tenant_id = current_setting('app.tenant_id')` policy — defense-in-depth behind the adapter
  scoping (ADR-0008 §3). Land with the first repository sprint, tested per adapter.
- **CHECK constraints** for closed state sets (e.g. `status IN ('pending','published')`).
- **`platform.outbox` monthly partitioning** by `created_at` when volume demands it
  (convert via new partitioned table + swap; doc 03).
- **UUIDv7 note:** ids are app-generated (`@platform/id`); no DB default needed.

## 4. Known deferrals

- `package.json#prisma` config is deprecated in favor of `prisma.config.ts` (Prisma 7) —
  migrate when upgrading Prisma major.
- Read models / projections are **not** in these schemas (G-8): they are CDC-fed and land with
  their own design; command-side tables here stay write-shaped.
- Metafields (G-34) intentionally absent: the ADR must precede the tables it attaches to.
