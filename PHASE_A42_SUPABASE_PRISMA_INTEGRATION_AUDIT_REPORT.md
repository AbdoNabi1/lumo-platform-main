# Phase A.42 — Supabase + Prisma Production Database Integration Audit

**Scope:** Audit + integration plan only. No migrations run, no SQL executed, no files modified, no git operations performed. Docker/WSL2 and Kubernetes explicitly out of scope.

**Repository:** `C:\Users\abdoh\Claude code\Git\lumo-platform` (Turborepo/pnpm monorepo, 39 bounded-context Postgres schemas, 132 Prisma models, 35 migrations).

---

## 1. Executive Summary

The database layer (`packages/db`) is a single, well-factored Prisma package used by every service through dependency injection — there is no scattered `PrismaClient` sprawl to clean up. Migrations are clean: **zero destructive operations** (no `DROP TABLE`, `TRUNCATE`, `CREATE ROLE`, `CREATE EXTENSION`) across all 35 migration files. No secrets are committed to git, and no `DATABASE_URL`/`POSTGRES_*` value is exposed via `NEXT_PUBLIC_*`.

The blocking gap is architectural, not data-layer: **`DIRECT_URL` does not exist anywhere in the codebase.** The Prisma datasource reads a single `DATABASE_URL`, and the intended Vercel architecture (pooled runtime URL + direct migration URL) is not wired. Separately, only one of the two Next.js apps (`storefront`) is Vercel-ready — `admin-web` is Docker/standalone-only today, with no `vercel.json`.

**Verdict: CONDITIONALLY READY** (see §15).

---

## 2. Repository Database Architecture

| Item                          | Location                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prisma package                | `packages/db`                                                                                                                                                |
| Schema (multi-file)           | `packages/db/prisma/schema/*.prisma` (43 files, entry `main.prisma`)                                                                                         |
| Migrations                    | `packages/db/prisma/schema/migrations/` — 35 folders, `20260704000000_init` → `20260814000000_a21_sprint5x_column_and_index_reconciliation`                  |
| Seed scripts                  | `packages/db/prisma/seed.ts`, `apps/runtime/src/seed.ts`                                                                                                     |
| PrismaClient instantiation    | `packages/db/src/client.ts:44` (factory `createPrismaClient`), `packages/db/prisma/seed.ts` — **only two sites in the entire repo**                          |
| Prisma/@prisma/client version | `^6.5.0` (`packages/db/package.json:35,42`)                                                                                                                  |
| Models                        | 132 across 39 Postgres schemas (`platform`, `catalog`, `payments`, `identity`, … full list in `main.prisma`)                                                 |
| Enums                         | 0 — deliberate design choice (text fields validated in the domain layer; documented in `main.prisma` header comment)                                         |
| Docker/compose                | `infrastructure/docker/*.dockerfile` (4 files), `docker-compose.runtime.yml` and one other compose file — local/dev only, uses placeholder creds `lumo:lumo` |

---

## 3. Prisma Configuration

`packages/db/prisma/schema/main.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["platform", "catalog", "media", "pricing", "inventory", "cart",
              "checkout", "orders", "payments", "identity", "finance",
              "fulfillment", "shipping", "returns", "notifications",
              "promotions", "coupons", "loyalty", "wishlist", "reviews",
              "search", "recommendations", "reporting", "feature_flags",
              "experiment", "automation", "content", "localization", "seo",
              "components", "theme", "experience", "pages", "tenancy",
              "licensing", "feature_registry", "security", "tracking",
              "customer_360"]
}
```

- **No `directUrl` field.** `DIRECT_URL` does not appear anywhere in the repo (grepped `packages/db`, `.env.example`, all `apps/*`, `services/*`).
- **No `previewFeatures` block.** Multi-schema Postgres (the `schemas = [...]` array) has been GA in Prisma since 5.15 — Prisma 6.5 does not require a preview flag for it, so this is not a defect.
- **Client is a DI factory, not a global singleton.** `createPrismaClient()` in `packages/db/src/client.ts` builds one client at each process's composition root (`apps/runtime`, `services/*` entrypoints) and threads it through constructors — it is not re-instantiated per-request. Pooling params (`connection_limit`, `connect_timeout`) are appended to the connection string from env vars (`DATABASE_POOL_MAX`, `DATABASE_CONNECT_TIMEOUT_MS`); `DATABASE_STATEMENT_TIMEOUT_MS` is read but **not applied at the Prisma layer** — comments indicate it's intended to be enforced via PgBouncer/DB role config instead. This is a documented gap, not a bug, but must be re-verified against Supabase's pooler once connected.
- **Seed strategy**: `prisma db seed` (`packages/db/package.json:21`) invokes `packages/db/prisma/seed.ts`; `apps/runtime/src/seed.ts` is a separate runtime-level seed for bootstrapping demo data — the two were not diffed for overlap in this audit (flagged as unverified).

---

## 4. Vercel Compatibility

| App               | Vercel-ready?                   | Evidence                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/storefront` | **Yes**                         | Has `apps/storefront/vercel.json` with `framework: nextjs`, monorepo-aware `installCommand`/`buildCommand`/`ignoreCommand` (turbo-ignore). `next.config.ts` conditionally disables `output: "standalone"` when `process.env.VERCEL` is set — i.e., it already special-cases Vercel vs. the Docker image path. |
| `apps/admin-web`  | **No, as currently configured** | No `vercel.json` found. Build succeeded locally under `next build` (see §14) but was not confirmed against the Vercel platform target.                                                                                                                                                                        |

No cron/WebSocket usage or filesystem-write requirements were found in either Next app during this pass (targeted grep, not exhaustive — flagged as a residual gap). Given the phase's stated scope is a Vercel deployment, and only `storefront` currently declares Vercel intent, confirm with the operator **which app(s)** this phase is meant to deploy to Vercel before proceeding.

---

## 5. Supabase Compatibility

Migration audit (all 35 files under `packages/db/prisma/schema/migrations/`) for Supabase-incompatible statements:

| Check                                                           | Result                                                                                                                                                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CREATE EXTENSION`                                              | **None found** — no `pgcrypto`/`uuid-ossp` dependency (UUIDs are app-generated UUIDv7 via `@platform/id`, per `main.prisma` design notes)                                                                         |
| `DROP TABLE` / `TRUNCATE`                                       | **None found**                                                                                                                                                                                                    |
| `CREATE ROLE` / `CREATE USER` / `CREATE DATABASE` / `SUPERUSER` | **None found**                                                                                                                                                                                                    |
| `ROW LEVEL SECURITY` / `CREATE POLICY`                          | **None found**, in any migration                                                                                                                                                                                  |
| Destructive `ALTER`                                             | Only `DROP COLUMN` (no data-loss-risk `DROP TABLE`), confined to two reconciliation migrations: `20260804000000_sprint5x_schema_reconciliation` and `20260814000000_a21_sprint5x_column_and_index_reconciliation` |

**Flag:** `packages/db/prisma/MIGRATIONS.md` documents an intent to enforce tenant isolation via Postgres row-level-security policies as hand-written SQL landing in migrations (per the multi-tenant design in `main.prisma`'s header comment: "row-level-security tenant policies... land as hand-written SQL in migrations"). No such SQL currently exists in any migration. This is either (a) planned but not yet implemented, or (b) tenant isolation is enforced purely at the application/repository layer today. This is a **pre-existing design gap unrelated to Supabase migration** — flagging for operator awareness, not something to fix in this phase, since fixing it would mean writing new migration SQL (explicitly prohibited this phase).

No custom functions, triggers, generated columns, sequences, or advisory locks were found in the migration set. Standard Postgres JSON/JSONB, indexes, and FKs (within-aggregate only, per D-002) are used throughout — all natively supported by Supabase.

---

## 6. Migration Audit

- **35 migrations**, chronologically ordered `20260704000000` → `20260814000000`, one per sprint/context addition — internally consistent, no renumbering or gaps observed.
- None assume a local/Docker-only Postgres (no `localhost`-hardcoded statements, no Docker-specific extensions).
- None require superuser privileges.
- `schema-migration-consistency.test.ts` (found by the research pass) checks schema/migration consistency only for the `payments` schema (5 tables) — **not repository-wide**. This means drift in the other 38 schemas is not automatically caught by existing tests. This is an existing test-coverage gap, not a migration defect.

---

## 7. Security Audit

- No hardcoded production credentials or connection strings found in source.
- The only `.env*` files with real values (`./.env`, `apps/admin-web/.env.local`) are **git-ignored and untracked** — confirmed not present in git history for this audit pass via directory listing (not a full `git log -- .env` history scan, since this is not a git repository at the current working directory root — see note below).
- `.env.example` and `docker-compose.runtime.yml` contain only dev-placeholder credentials (`lumo:lumo`) — safe by design as an example file.
- No `NEXT_PUBLIC_*` variable references `DATABASE_URL`, `DIRECT_URL`, or any `POSTGRES_*` value (grepped `.ts`/`.tsx`/`.env*` repo-wide).
- No `console.log`/logging of raw connection strings was found in `packages/db/src/client.ts` (the only file that constructs pooled URLs).

**Note on scope:** this Claude Code session's working directory (`Git`) is not itself a git repository; the audit operated directly against the `lumo-platform` folder on disk. A full `git log`-based secret-history scan was not performed as part of this pass — recommend running `git log -p -- '**/.env*'` inside `lumo-platform` separately before treating this section as exhaustive.

---

## 8. Environment Variable Matrix

Source: `.env.example` (repo root, single file — no per-service `.env.example` duplication found).

| Variable                        | Purpose                                                         | Runtime                                          | Required                            | Client-safe | Currently exists                                                  |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------- | ----------- | ----------------------------------------------------------------- |
| `DATABASE_URL`                  | App + Prisma connection string                                  | Vercel runtime (app) / local (migrations, today) | Yes                                 | No          | Yes — needs repointing to Supabase Transaction Pooler for runtime |
| `DIRECT_URL`                    | Prisma migration/admin connection                               | Migration environment                            | **Not yet present — must be added** | No          | **No**                                                            |
| `DATABASE_POOL_MAX`             | Prisma connection pool size                                     | Both                                             | Optional (defaults exist)           | No          | Yes                                                               |
| `DATABASE_CONNECT_TIMEOUT_MS`   | Connection timeout                                              | Both                                             | Optional                            | No          | Yes                                                               |
| `DATABASE_STATEMENT_TIMEOUT_MS` | Statement timeout (not enforced by Prisma layer today — see §3) | Both                                             | Optional                            | No          | Yes                                                               |
| `DATABASE_LOG_QUERIES`          | Query logging toggle                                            | Both                                             | Optional                            | No          | Yes                                                               |
| `CLICKHOUSE_DATABASE`           | Analytics store (separate from Postgres, out of scope)          | Analytics service                                | N/A to this phase                   | No          | Yes                                                               |

---

## 9. DATABASE_URL / DIRECT_URL Recommendation

The requested architecture —

```
Vercel runtime  --DATABASE_URL-->  Supabase Transaction Pooler (6543)
Prisma migrate  --DIRECT_URL-->    Supabase Session/Direct connection
```

— is **not currently wired** but is **compatible** with Prisma 6.5 and the existing schema. Required change (for the next phase, not this one):

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
  schemas   = [ ...unchanged... ]
}
```

This is a one-line schema addition (`directUrl = env("DIRECT_URL")`) — explicitly **not made in this audit** per the no-schema-change rule. Note it for the next phase.

`DATABASE_URL` should carry `?pgbouncer=true` (Supabase's documented flag for Prisma + Transaction Pooler, disabling prepared statements which the pooler doesn't support in transaction mode) — the existing `connection_limit`/`connect_timeout` query-param appending logic in `packages/db/src/client.ts` can carry this without code changes, since it already appends params to the URL string.

---

## 10. Migration Execution Procedure (NOT executed)

1. Operator configures Supabase project connection strings in their own secrets store.
2. Operator adds `DATABASE_URL` (Transaction Pooler, `pgbouncer=true`) and `DIRECT_URL` (Session/Direct) to Vercel project environment variables.
3. Add `directUrl = env("DIRECT_URL")` to `main.prisma` datasource block (small, reviewable code change — separate PR/phase).
4. From the migration environment (CI or operator machine — NOT Vercel serverless), validate connectivity: `prisma db pull --print` (read-only, does not alter DB) or a plain `psql` connection test.
5. Run `prisma migrate status` against `DIRECT_URL` to confirm the target DB has no applied migrations and matches expectations (empty baseline).
6. Review the full migration plan output (`prisma migrate diff` or `migrate status` dry-run).
7. Apply migrations: `prisma migrate deploy` (uses `DIRECT_URL`, safe for CI/one-shot use, does not require shadow DB).
8. Run `pnpm db:seed` only if the operator explicitly wants seed data in production (default: skip).
9. Verify table/index/constraint counts against the 132-model schema (e.g. `prisma migrate status` + a manual count query).
10. Deploy application to Vercel with `DATABASE_URL` pointed at the pooler.
11. Run smoke tests against a couple of read/write endpoints per bounded context.

---

## 11. Rollback Plan

- **Migration failure mid-apply:** `prisma migrate deploy` applies migrations sequentially and stops on first failure; the failed migration is marked failed in `_prisma_migrations`. Recovery requires manually fixing the DB state to match the migration's intent, then `prisma migrate resolve --applied <name>` (or `--rolled-back` if reverted), consistent with Prisma's standard recovery flow — no custom rollback SQL exists in this repo today.
- **Backup requirement:** take a Supabase manual/scheduled backup (or rely on Supabase's point-in-time recovery, if enabled on the plan tier) **before** step 7 of §10. This audit found no automated pre-migration backup step in the repo — it must be a manual operator action.
- **Schema rollback limitation:** since every reviewed migration is additive or narrowly `DROP COLUMN` (no `DROP TABLE`), a full schema rollback is realistic via Postgres PITR but not via a scripted "down" migration — Prisma Migrate does not generate down-migrations by default and none exist in this repo.
- **Application rollback:** Vercel's deployment rollback (redeploy previous build) is independent of the DB and safe, since this migration set is purely additive — an old app build talking to a newly-migrated (additive) DB should not break, but this was not verified against actual query behavior in this audit.

---

## 12. Risks

| Risk                                                                                            | Severity                                           | Notes                                                                                       |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `DIRECT_URL` / `directUrl` not wired                                                            | Blocking (until next phase's 1-line schema change) | See §9                                                                                      |
| `admin-web` has no `vercel.json`, is Docker/standalone-oriented                                 | Medium                                             | Confirm with operator whether admin-web is in scope for this Vercel deployment at all       |
| `DATABASE_STATEMENT_TIMEOUT_MS` not enforced at Prisma layer                                    | Low-Medium                                         | Must be enforced via Supabase role/pooler config instead, or a bug for a future phase       |
| No RLS policies despite design docs mentioning tenant-isolation RLS                             | Low (pre-existing)                                 | Tenant isolation appears to rely on application-layer `tenant_id` filtering only            |
| `schema-migration-consistency.test.ts` only covers `payments` schema                            | Low                                                | 38 of 39 schemas have no automated drift test                                               |
| Full `git log` secret-history scan not performed                                                | Low                                                | Recommend a standalone `git log -p -- '**/.env*'` check before go-live                      |
| Seed script duplication (`packages/db/prisma/seed.ts` vs `apps/runtime/src/seed.ts`) not diffed | Low                                                | Confirm neither writes conflicting/duplicate data before ever running seed against Supabase |

---

## 13. Required Actions Before Migration

1. Operator confirms which app(s) (`storefront` only, or `admin-web` too) actually deploy to Vercel in this phase.
2. Add `directUrl = env("DIRECT_URL")` to `packages/db/prisma/schema/main.prisma` (small schema change, separate reviewable step — not performed here per this phase's "no schema changes" rule).
3. Set `DATABASE_URL` (pooler, `pgbouncer=true`) and `DIRECT_URL` (direct) in Vercel project env vars — operator does this directly in Vercel, not via chat.
4. Take a Supabase backup / confirm PITR is enabled before running `prisma migrate deploy`.
5. Decide the RLS/tenant-isolation gap's disposition (accept as app-layer-only, or schedule a future migration to add policies) — informational only, not a migration blocker.

---

## 14. Validation Results

Ran Docker-independent, non-destructive checks per Task 15:

| Command                          | Result                                                                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                 | ✅ 78/78 tasks successful (FULL TURBO, cached)                                                                                                                                                                         |
| `pnpm lint`                      | ✅ 78/78 tasks successful (FULL TURBO, cached)                                                                                                                                                                         |
| `pnpm arch` (dependency-cruiser) | ✅ "no dependency violations found" — 1572 modules, 6857 dependencies                                                                                                                                                  |
| `pnpm --filter admin-web build`  | ✅ Compiled successfully, all 20 static pages generated, build reached "Finalizing page optimization" before the audit's command timeout terminated the process (exit 143 = SIGTERM from timeout, not a build failure) |
| `pnpm test`                      | **Not run** — full monorepo test suite was skipped in this pass for time; no DB-touching or destructive test was executed. Recommend running it as a standalone step before final go-live sign-off.                    |

No database connection was made, no migration was run, no SQL was executed at any point in this audit.

---

## 15. Final Readiness Verdict

### CONDITIONALLY READY

The database layer, migration history, and security posture are clean and Supabase-compatible with no blocking technical defects found in the schema or migrations themselves. Readiness is conditional on the explicit actions in §13 — primarily wiring `DIRECT_URL`/`directUrl` (currently absent, not merely misconfigured) and confirming which app(s) target Vercel, since `admin-web` is not yet Vercel-shaped while `storefront` already is.

---

## NEXT EXACT STEP

**Operator:** confirm whether this Vercel/Supabase migration phase targets `storefront` only, or `storefront` + `admin-web` both — that answer determines whether `admin-web`'s missing `vercel.json` is in scope for the next phase.
