# Phase A.43 — Vercel + Supabase + Prisma Production Integration Preparation

Preparation-only phase. No migrations were run, no database was written to, no destructive
operation was performed. All work is config/documentation-level, scoped narrowly on top of the
pre-existing uncommitted tree (which was left untouched).

## Executive Summary

- Added `directUrl = env("DIRECT_URL")` to the Prisma datasource block (`packages/db/prisma/schema/main.prisma`), the standard Prisma pattern for pooled-runtime + direct-migration connections. `prisma validate` passes.
- Added `DIRECT_URL` to `.env.example` next to `DATABASE_URL`, documented.
- Added `apps/admin-web/vercel.json`, mirroring the existing `apps/storefront/vercel.json` pattern. No other admin-web changes were made or needed.
- Confirmed both Vercel-bound apps (`storefront`, `admin-web`) contain **zero** Prisma/`@platform/db`/`@supabase/supabase-js` usage — they talk to `apps/runtime` exclusively over HTTP (`RUNTIME_API_URL`). Prisma lives only in `apps/runtime` and `apps/admin` (not Vercel deployment targets), which are not in scope for serverless cold-start concerns the way Next.js API routes would be.
- Full validation suite run: typecheck, lint, arch, test, and both app builds (`admin-web`, `storefront`) all pass, Docker-independent.
- `prisma migrate status` correctly failed with `P1001: Can't reach database server at localhost:5432` — no live DB, no Supabase credentials configured in this environment. Stopped there per the safety constraints, as instructed.
- No secrets found leaking into `NEXT_PUBLIC_*`, client bundles, or git history. `@supabase/supabase-js` is not a dependency anywhere and there's no evidence it's needed — Prisma is the sole DB access layer. Recommendation: do not add it.

## Baseline

```
git branch --show-current   -> main
git rev-parse HEAD          -> 22de4125cb61aaacddddc729e1b072f5c0dd5a6b
```

`git status --short` at start showed a large pre-existing uncommitted tree (Phase A.30–A.42 admin-web
auth/UI work, docker/k8s identity-plane infra, design-system tweaks, several `PHASE_A3x/A4x_*.md`
reports, `.claude/`, `scripts/dev/`, `scripts/ops/*`). None of it was touched, reverted, or staged.
`git diff --stat` on tracked files showed 51 files / 868 insertions / 240 deletions, all pre-existing
and unrelated to this phase.

## Prisma Configuration

- Schema location: `packages/db/prisma/schema/` — Prisma **multi-file schema** (Prisma ORM 6.5+
  feature), one `.prisma` file per bounded context (40 files), root datasource/generator in
  `main.prisma`.
- `packages/db/package.json`: `"prisma": { "schema": "prisma/schema", "seed": "tsx ../../apps/runtime/src/seed.ts" }`. Prisma version: `"prisma": "^6.5.0"`, `"@prisma/client": "^6.5.0"` (installed: 6.19.3 per `prisma validate` output). `directUrl` has been supported since Prisma 4.x, so this fits cleanly on 6.x.
- Generator: `prisma-client-js` (default output). No custom output path.
- Datasource before this phase: `provider = "postgresql"`, `url = env("DATABASE_URL")`, `schemas = [...40 Postgres schemas...]` (multiSchema preview feature implicitly enabled by usage — confirmed still valid after the edit).
- `PrismaClient` instantiation: exactly one call site outside tests — `packages/db/src/client.ts`'s `createPrismaClient(config)`, called from `packages/db/src/database.ts`'s `createDatabase(config)`, called once from `apps/runtime/src/composition.ts` (the app's single composition root) and once from `apps/admin/src/composition.ts`. Both are process-lifetime singletons built at boot, not per-request. All other `PrismaClient`/`@platform/db` references are integration tests, `apps/runtime/src/seed.ts`, and `packages/db/prisma/seed.ts`.
- Connection URL is dependency-injected (`config.url`, from `DatabaseConfig`), not read ambiently by app code — `buildDatasourceUrl()` layers `connection_limit`/`connect_timeout` query params onto it (Phase A.13). `DIRECT_URL` is deliberately **not** part of this DI path — see below.

## DATABASE_URL / DIRECT_URL Design

Edited `packages/db/prisma/schema/main.prisma`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
  schemas   = [...]
}
```

- `DATABASE_URL` → Supabase Transaction Pooler (port 6543, pgbouncer transaction mode) in production. Used by the running app (`apps/runtime`, `apps/admin`) for all runtime queries.
- `DIRECT_URL` → Supabase's direct/session connection (port 5432). Used exclusively by Prisma CLI tooling (`prisma migrate`, `prisma db pull`, `prisma studio`), which need a real session (prepared statements, advisory locks) that a transaction-mode pooler cannot provide.
- Only the datasource block changed — no models, no `@@schema` mappings, no field-level changes.
- **Deliberately not added** to `packages/config/src/server/env.ts`'s `serverEnvSchema` (the app-level Zod-validated `DATABASE_URL`/pool config used by `DatabaseConfig`/`createPrismaClient`). `DIRECT_URL` is read directly by the Prisma CLI via `env("DIRECT_URL")` at migration time, not by the running application, so adding it as an app-level required var would force every existing deployment/CI job (which doesn't currently set it) to fail boot validation for no functional reason. This keeps the change minimal and non-breaking.
- `.env.example` updated with a `DIRECT_URL` line next to `DATABASE_URL`, with a comment explaining the pooler/direct split, following the file's existing comment style.

## Migration Safety

- 35 pre-existing migrations remain untouched (verified via `git diff --name-only` — no file under `packages/db/prisma/schema/migrations/` appears).
- `pnpm exec prisma migrate status` was attempted (read-only) with local placeholder credentials (`postgresql://lumo:lumo@localhost:5432/lumo` for both `DATABASE_URL`/`DIRECT_URL` — the same values already in `.env.example`/local dev, no production secrets used or requested). Result:

  ```
  Datasource "db": PostgreSQL database "lumo", schemas "automation, cart, ... " at "localhost:5432"
  Error: P1001: Can't reach database server at `localhost:5432`
  ```

  This is the expected/correct outcome — no local Postgres is running in this environment and no
  Supabase production credentials are configured here. Per the safety constraints, execution
  stopped at this point; no attempt was made to source or supply real Supabase credentials.

- No `migrate deploy`, `migrate dev`, `db push`, `db pull`, seed script, or raw SQL was run against any database, local or remote.

## Storefront Vercel Readiness

`apps/storefront`:

- Framework: Next.js 15.5.22, App Router.
- `vercel.json` already present (pre-existing): turborepo-aware install/build/ignore commands (`turbo-ignore`), `outputDirectory: .next`.
- No Prisma / `@platform/db` import anywhere in `apps/storefront` — confirmed via repo-wide grep. All data access goes through `apps/runtime`'s HTTP API via `RUNTIME_API_URL` (see `apps/storefront/src/lib/runtime-api.ts` per `.env.example` comment).
- No Dockerfile-only assumptions found in app code.
- `next build` succeeds standalone (ran locally, Docker-independent): 5 routes, all dynamic (ƒ), clean compile, no errors.
- No `NEXT_PUBLIC_*` DB var found (only `NEXT_PUBLIC_APP_URL`).
- Conclusion: **storefront can run on Vercel without Docker as-is.** No changes made or needed.

## Admin Web Vercel Readiness

`apps/admin-web`:

- Framework: Next.js 15.5.22, App Router. No `@platform/db`/`@prisma/client`/`@supabase/supabase-js` dependency in `package.json` — confirmed no direct DB access; talks to `apps/runtime` via `RUNTIME_API_URL` same as storefront.
- `next.config.ts` sets `output: "standalone"` and `outputFileTracingRoot` pointing at the monorepo root — this is why A.42 flagged it as Docker/standalone-oriented. `infrastructure/docker/admin-web.Dockerfile` explicitly depends on this (`COPY --from=builder .../.next/standalone ...`), so it is load-bearing for the existing Docker deployment path and was **not** changed — removing it would break Docker without being necessary for Vercel (Vercel's Next.js builder handles `output: "standalone"` fine; it's not a blocker, just unnecessary for Vercel specifically).
- No hardcoded Docker-internal hostnames (`postgres:5432`, `hydra:4444`, `kratos:4433`, `keto:4466`, `redpanda:9092`, etc.) found anywhere in `apps/admin-web` source — all identity-plane URLs (`KRATOS_PUBLIC_URL`, `HYDRA_PUBLIC_URL`, etc.) are already environment-variable driven (see `next.config.ts`'s `authOrigin()` helper and `middleware.ts`).
- No `vercel.json` existed prior to this phase — **added** `apps/admin-web/vercel.json`, mirroring the storefront's existing file (turbo-aware install/build/ignore commands, `.next` output). This is additive only; it does not touch `next.config.ts`, routing, auth, or the Docker path.
- `next build` succeeds standalone (ran locally, Docker-independent): 20 routes, all dynamic (ƒ), clean compile, middleware present (40 kB), no errors.
- Conclusion: **admin-web can run on Vercel with the one additive change made (`vercel.json`).** The `output: "standalone"` setting is harmless on Vercel and was deliberately left alone to avoid touching the working Docker deployment path — no architectural change was needed or made.

## Serverless Prisma Analysis

- `PrismaClient` is created exactly once per process, at boot, in each composition root (`apps/runtime/src/composition.ts`, `apps/admin/src/composition.ts`) — a true singleton (not a `globalThis`-cached Next.js pattern, but architecturally equivalent: one client per long-lived process, dependency-injected everywhere else).
- Neither Vercel-bound app (`storefront`, `admin-web`) instantiates `PrismaClient` at all — they have no DB dependency, so the classic Next.js-serverless "PrismaClient exhausts connections because every route/lambda makes a new one" failure mode does not apply to the two apps actually being prepared for Vercel in this phase.
- `apps/runtime`/`apps/admin` (where Prisma actually lives) are not part of this phase's Vercel deployment target per the objective ("Vercel hosts Storefront + Admin Web") — they appear to be intended for a persistent Node process/container deployment, which is exactly where a boot-time singleton is correct and no additional serverless-safety change is needed.
- No fix was made because no real issue was demonstrated for the apps in scope.

## Security Findings

Grepped repo-wide for `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_PASSWORD`, `POSTGRES_USER`,
`POSTGRES_HOST`, `POSTGRES_PORT`, `NEXT_PUBLIC_DATABASE`, `SUPABASE_SERVICE_ROLE`,
`SUPABASE_ANON_KEY`:

- All matches are either: (a) placeholder/local-dev values (`lumo`/`lumo` in `docker-compose.yml`, `postgresql://lumo:lumo@localhost:5432/lumo` in `.env.example`), (b) `env(...)` references in Prisma/K8s config, (c) doc/report prose, or (d) test files using local placeholder connection strings.
- Zero matches for `NEXT_PUBLIC_DATABASE`, `SUPABASE_SERVICE_ROLE`, `SUPABASE_ANON_KEY` anywhere in the repo — confirms no such variables exist yet, so nothing to leak.
- No `NEXT_PUBLIC_*` variable carries a DB URL, DB credential, or Supabase service key (only `NEXT_PUBLIC_APP_URL`, a public base URL, was found).
- No real secrets, of any kind, found committed to git-tracked files.

## Environment Variable Contract (DB/Supabase-relevant)

| Var                             | Purpose                                                                                       | Required                                                                 | Exposure                                                                           | Secret | Consumer                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| `DATABASE_URL`                  | Runtime Postgres connection (Supabase Transaction Pooler, port 6543, in prod)                 | Required (`serverEnvSchema`, `z.string().min(1)`)                        | Server-only                                                                        | Yes    | `apps/runtime`, `apps/admin` via `@platform/db`         |
| `DIRECT_URL`                    | Prisma CLI migration/introspection connection (Supabase direct/session, port 5432, in prod)   | Required only when running Prisma CLI tooling; not validated by app boot | Server/CI-only, never shipped to a running app process                             | Yes    | Prisma CLI only (`prisma migrate`, `db pull`, `studio`) |
| `DATABASE_POOL_MAX`             | Prisma `connection_limit` override                                                            | Optional (default 10)                                                    | Server-only                                                                        | No     | `@platform/db`                                          |
| `DATABASE_CONNECT_TIMEOUT_MS`   | Prisma `connect_timeout` override                                                             | Optional (default 10000)                                                 | Server-only                                                                        | No     | `@platform/db`                                          |
| `DATABASE_STATEMENT_TIMEOUT_MS` | Documented only; not currently enforceable via Prisma URL param (see `client.ts` doc comment) | Optional (default 30000)                                                 | Server-only                                                                        | No     | `@platform/config` (exposed, unused by Prisma directly) |
| `DATABASE_LOG_QUERIES`          | Enables Prisma query logging                                                                  | Optional (default false)                                                 | Server-only                                                                        | No     | `@platform/db`                                          |
| `NEXT_PUBLIC_APP_URL`           | Public base URL of the web app                                                                | Required                                                                 | Client-exposed (by design)                                                         | No     | admin-web/storefront                                    |
| `RUNTIME_API_URL`               | Base URL admin-web/storefront call for all data, including anything DB-backed                 | Required                                                                 | Server-only (used in server components/route handlers, not shipped to the browser) | No     | admin-web, storefront                                   |

No other production-required Supabase-specific env vars (e.g. `SUPABASE_URL`, `SUPABASE_ANON_KEY`) exist in code — consistent with Prisma being the sole DB access layer (see next section).

## Supabase Client Decision

- `@supabase/supabase-js` is **not** a dependency anywhere in the monorepo (checked every `package.json` transitively via repo-wide grep — zero matches).
- No code references Supabase Auth, Storage, or Realtime features — auth is Ory Hydra/Kratos/Keto (self-hosted, already wired per Phase A.32/P2.0.x), object storage is a dedicated S3/MinIO port (`@platform/storage`), and DB access is 100% Prisma.
- **Recommendation: do not add `@supabase/supabase-js`.** Supabase's role in this deployment is exclusively "managed Postgres" — Prisma via `DATABASE_URL`/`DIRECT_URL` is sufficient and is the existing, already-audited access pattern. Adding the JS client would introduce an unused dependency and a second, redundant DB-access surface with no functional benefit.

## Changes Made

1. `packages/db/prisma/schema/main.prisma` — added `directUrl = env("DIRECT_URL")` to the `datasource db` block, with an explanatory comment. No models, mappings, or other schema content changed.
2. `.env.example` — added `DIRECT_URL=postgresql://lumo:lumo@localhost:5432/lumo` next to `DATABASE_URL`, with an explanatory comment in the existing style.
3. `apps/admin-web/vercel.json` (new file) — Vercel build config mirroring `apps/storefront/vercel.json` (turbo-aware install/build/ignore commands).

No migration files, Prisma models, event contracts, public APIs, auth architecture, or business logic were touched. No commits were made.

## Changes Intentionally Not Made

- `DIRECT_URL` was **not** added to `packages/config/src/server/env.ts`'s `serverEnvSchema` — it's Prisma-CLI-only, not app-runtime-consumed; making it a required app-level var would break existing local/CI boots that don't set it, for no functional gain.
- `apps/admin-web/next.config.ts`'s `output: "standalone"` was **not** removed or changed — it is load-bearing for the existing `infrastructure/docker/admin-web.Dockerfile` production image and is not actually a Vercel blocker (Vercel's builder tolerates it), so changing it would trade a working Docker path for no real Vercel benefit.
- No Dockerfile, k8s manifest, or docker-compose file was touched.
- No `@supabase/supabase-js` dependency was added (see decision above).
- No `prisma.config.ts` migration was performed, despite Prisma 6.19.3's deprecation warning about `package.json#prisma` (removed in Prisma 7) — out of scope for this phase; flagged as a future-risk item below.

## Validation Results

| Command                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec prisma validate` (packages/db)                                | PASS — "The schemas at prisma\schema are valid"                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm exec prisma format --check` (packages/db)                          | Reports pre-existing "unformatted files" — verified via diff against a freshly-formatted copy that this is caused by CRLF line endings repo-wide (a pre-existing Windows-checkout convention affecting every `.prisma` file, matching the `LF will be replaced by CRLF` warnings git already emits on this tree), not schema content — including on files this phase never touched. Not caused by this phase's edit; not fixed, to avoid a repo-wide line-ending change out of scope. |
| `pnpm exec prisma migrate status` (packages/db, local placeholder creds) | Correctly failed: `P1001: Can't reach database server at localhost:5432` — no live DB in this environment; stopped per safety constraints                                                                                                                                                                                                                                                                                                                                             |
| `pnpm typecheck` (root, all 78 tasks)                                    | PASS (78/78; two tasks initially hit a tool-side timeout at 200s and were re-run individually with more time — both pass)                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm lint` (root, all 78 tasks)                                         | PASS (78/78)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm arch`                                                              | PASS — "no dependency violations found (1572 modules, 6857 dependencies cruised)"                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm test` (root, all 78 tasks)                                         | PASS (78/78 task-level; e.g. `@platform/admin` 153/153 tests, `@platform/runtime` 184/184 tests)                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm --filter admin-web build`                                          | PASS — 20 routes, clean compile                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm --filter storefront build`                                         | PASS — 5 routes, clean compile                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

All validation was Docker-independent, run directly against the working tree.

## Remaining Risks

1. **`prisma migrate status` against real Supabase is unverified** — no credentials/network access available in this environment; this is expected at this phase and is the next operator action (see below), not a defect.
2. **Prisma 6→7 major version and `package.json#prisma` config deprecation** — `prisma format`/`validate` both warn that `package.json#prisma` config is removed in Prisma 7 in favor of `prisma.config.ts`; not urgent (6.19.3 is current-supported), but should be tracked before any future Prisma major upgrade.
3. **CRLF line-ending drift in `.prisma` files** — pre-existing, repo-wide, not caused by this phase; cosmetic (`prisma format --check` flags it) but worth a deliberate one-time repo formatting pass outside this phase's narrow scope.
4. **`DATABASE_STATEMENT_TIMEOUT_MS` is validated but not enforced** — documented limitation already flagged in `packages/db/src/client.ts` (Phase A.13); Prisma has no URL-level parameter for Postgres `statement_timeout`; would need a Supabase-side role setting or PgBouncer config. Unchanged by this phase.
5. **Supabase Transaction Pooler + Prisma prepared statements** — Supabase's transaction-mode pooler (port 6543) requires disabling Prisma's use of prepared statements for some query patterns; this is a well-documented Supabase+Prisma interaction (typically handled by adding `?pgbouncer=true` to `DATABASE_URL` in production). This wasn't added here because it's an actual production connection-string value decision, not a schema change — flagged for the operator to set when constructing the real production `DATABASE_URL`.

## Production Deployment Procedure (future — not executed in this phase)

1. Provision production env vars in Vercel (Storefront, Admin Web) and wherever `apps/runtime`/`apps/admin` are hosted: `DATABASE_URL` (Supabase pooler, port 6543, `?pgbouncer=true`), `DIRECT_URL` (Supabase direct, port 5432), plus the existing Redis/ClickHouse/S3/Auth/PSP vars per `.env.example`.
2. Confirm `DATABASE_URL`/`directUrl` config in `schema.prisma` (this phase) is present in the deployed commit.
3. Run `prisma validate` (and `prisma format --check` if desired) against the deployed schema as a CI gate.
4. Run `prisma migrate deploy` (future only — not part of this phase) against `DIRECT_URL`, applying all 35 existing migrations to the fresh/target Supabase database.
5. Verify schema: re-run `prisma migrate status` and confirm "Database schema is up to date"; spot-check table counts against the 35 migrations.
6. Deploy Storefront to Vercel (`apps/storefront`, existing `vercel.json`).
7. Deploy Admin Web to Vercel (`apps/admin-web`, this phase's new `vercel.json`).
8. Run smoke tests against both deployed apps (health endpoints, key pages render, `RUNTIME_API_URL` connectivity).
9. Run auth/OAuth/RBAC tests (Hydra/Kratos/Keto flows) against the deployed Admin Web, since A.30 flagged this as previously blocked locally by container crash-loops — production Docker/K8s hosting should not have this constraint.
10. Run DB integrity checks (row counts, foreign-key/tenant-scoping spot checks, RLS policy checks if any) against the live Supabase database.
11. Declare production readiness only after 1–10 all pass with evidence, per this repo's existing "CONDITIONALLY PRODUCTION READY" evidentiary standard.

---

## VERDICT: CONDITIONALLY READY

The Prisma/Supabase/Vercel configuration groundwork is complete, minimal, and fully validated
offline (schema valid, all builds/tests/lint/arch green, no secrets leaked, no destructive
operation performed). It is not "READY FOR MIGRATION" because the live-Supabase leg
(`prisma migrate status`/`deploy` against real credentials) is entirely unverified in this
environment — that is expected and out of scope for a preparation phase, not a defect. It is not
"BLOCKED" because nothing found here prevents proceeding once real credentials are available.

**NEXT EXACT STEP:** Operator sets `DATABASE_URL` (Supabase Transaction Pooler, port 6543,
`?pgbouncer=true`) and `DIRECT_URL` (Supabase direct connection, port 5432) as real environment
variables in a secure context (local `.env.local` or Vercel/secret-manager env config — never
committed), then runs `pnpm --filter @platform/db exec prisma migrate status` to confirm the
Supabase database's actual migration state before any `migrate deploy`.
