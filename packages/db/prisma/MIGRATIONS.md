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
  `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema --script` (this
  environment has no database host). It has **not run against a real database yet** — the first
  Docker-host session must run `prisma migrate deploy` against a fresh Postgres 16 and fix any
  drift before anything else builds on it.
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
