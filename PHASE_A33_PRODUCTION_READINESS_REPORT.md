# Phase A.33 — Production Readiness, Deployment Hardening & Vercel Preparation

**Scope:** Audit only. No code was changed, no dependency was upgraded, nothing was committed, pushed, or deployed. All findings below are evidence-based (file:line), gathered read-only against the working tree as of 2026-08-16.

**Question this report answers:** _Can `apps/admin-web` be safely deployed to Vercel today?_

**Short answer: No.** Mechanically, the Next.js app itself would build and deploy to Vercel with zero configuration — there is nothing in its code that is structurally incompatible with Vercel. But the _system_ it depends on is not production-ready: the authentication backend (Hydra/Kratos/Keto) has no production deployment target at all, its state is fully ephemeral even where it does run, the browser-facing login flow depends on a `localhost`-only cookie trick that has no cross-domain equivalent, there is no authorization enforcement beyond "has a valid token," and several env vars silently fall back to `localhost` and a hardcoded placeholder secret instead of failing closed. See the P0 list in Task 21.

---

## Task 1 — Repository Deployment Audit

| Component                          | Current deployment story                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin Web** (`apps/admin-web`)   | **None.** No `vercel.json`, no Dockerfile, no `docker-compose.yml` service, no Railway config. This audit is its first deployment story of any kind.                                                                                                                                                                                                                                                                         |
| **Storefront** (`apps/storefront`) | Dual path: `apps/storefront/vercel.json` (explicit monorepo-aware `installCommand`/`buildCommand` using `cd ../.. && pnpm turbo run build --filter=storefront...` and `turbo-ignore`) **and** `infrastructure/railway/storefront.railway.json` + `infrastructure/docker/web.Dockerfile`. Also runs as compose service `web` locally.                                                                                         |
| **Runtime/API** (`apps/runtime`)   | Docker-based: `infrastructure/docker/runtime.Dockerfile` (one image, three entrypoints via compose `command`: api/worker/scheduler). Has `infrastructure/railway/runtime-api.railway.json`, documented in `infrastructure/railway/README.md`. **This Railway path is explicitly demo-only**: `apps/runtime/src/api.ts:130` hard-throws at boot unless `APP_ENV=local`, because no production MFA/PSP/S3 providers exist yet. |
| **Infrastructure**                 | `infrastructure/docker/docker-compose.yml` runs ~20 local services. The canonical architecture doc, `docs/architecture/15-scalability-and-deployment.md:38-42`, states the intended production target is **Kubernetes (EKS) via Terraform + ArgoCD GitOps, with Vault for secrets** — this conflicts with the Railway configs that actually exist on disk. Vercel is not mentioned anywhere in `docs/`.                      |
| **Authentication**                 | Ory Hydra + Kratos + Keto, Docker-only. No hosted/managed Ory Cloud config anywhere.                                                                                                                                                                                                                                                                                                                                         |
| **Database**                       | PostgreSQL via Prisma. Railway Postgres plugin documented for the runtime-api demo path only; nothing for a Vercel-hosted admin-web.                                                                                                                                                                                                                                                                                         |
| **Observability**                  | Prometheus/Grafana/Loki/Tempo/OTel Collector — Docker-compose-only, no hosted equivalent for Railway or Vercel.                                                                                                                                                                                                                                                                                                              |

**Finding:** three uncoordinated deployment stories currently coexist (Kubernetes-per-docs, Railway-as-demo, Vercel-for-storefront-only). Admin Web has never been assigned to any of them.

---

## Task 2 — Admin Web Vercel Compatibility

| Check                      | Result                                                                                                                                                                              | Evidence                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Next.js version            | 15.5.22                                                                                                                                                                             | `apps/admin-web/package.json:22`                              |
| React version              | 19.2.7 (resolved)                                                                                                                                                                   | `pnpm-lock.yaml`                                              |
| Node version               | `>=22`                                                                                                                                                                              | root `package.json:8`, `.nvmrc`                               |
| Package manager            | pnpm 11.9.0 via corepack                                                                                                                                                            | root `package.json:6`                                         |
| `next.config.ts`           | `output: "standalone"` (inert on Vercel — Vercel manages its own build output), `outputFileTracingRoot` at monorepo root, `transpilePackages: ["@platform/ui","@platform/design"]`  | `apps/admin-web/next.config.ts:5-11`                          |
| `middleware.ts` runtime    | Default **Edge** runtime (no override). Imports only `next/server` + `jose` — both Edge-safe (WebCrypto, no Node built-ins).                                                        | `apps/admin-web/src/middleware.ts`                            |
| Route handlers             | `auth/callback/route.ts`, `logout/route.ts` — default Node runtime, plain `fetch()` to Hydra/Kratos                                                                                 | —                                                             |
| Cookies                    | Read/set via `next/headers` `cookies()` and `NextResponse.cookies.set()`                                                                                                            | `src/lib/auth/session.ts:1,28`                                |
| JWT verification           | `jose` `createRemoteJWKSet` + `jwtVerify`, duplicated between `middleware.ts` and `lib/auth/session.ts` (Edge can't import the same Node module — deliberate, but duplicated logic) | both files                                                    |
| Client components          | 13 files with `"use client"`, all leaf/interactive (toolbars, pagination, search, nav). All pages themselves are async Server Components.                                           | `src/components/**`                                           |
| Backend calls              | 100% server-side; `client.ts`'s own comment states a bearer credential must never reach client code                                                                                 | `src/lib/api/client.ts:4-6`                                   |
| `runtime = 'edge'` exports | None found                                                                                                                                                                          | grep, 0 matches                                               |
| Static generation          | None — no `generateStaticParams`, no `force-static`; every page calls `cookies()`, which auto-opts into dynamic rendering                                                           | confirmed by build output: all 18 routes render `ƒ` (Dynamic) |

**Verdict:** No structural Vercel incompatibility. The app **can** deploy to Vercel with a zero-config Next.js build. It is **not**, however, production-ready independent of hosting mechanics:

1. Every auth/backend URL defaults to `localhost` (`middleware.ts:14-18`, `lib/auth/config.ts:6-17`) — deployed with no env overrides, the app would try to redirect users to `http://localhost:4444/oauth2/auth`, meaningless from Vercel's network.
2. `src/app/page.tsx:27-34` hardcodes the displayed operator (`CURRENT_USER = { name: "Abdullah Nabil", ... }`) with a comment claiming "no authenticated session exists yet" — **stale**, since real JWT-session auth (Phase A.32) already exists. The dashboard chrome shows a fake identity regardless of who is actually logged in.
3. `AUTH_CLIENT_SECRET` silently falls back to a hardcoded placeholder if unset (`lib/auth/config.ts:16`) — see Task 4/21.

---

## Task 3 — Environment Variable Matrix

Canonical source: `.env.example` (153 lines, tracked in git). Local `.env`/`apps/admin-web/.env.local` both exist on disk, both correctly gitignored, neither committed.

### Vercel-relevant variables (admin-web)

| Var                                                                   | Purpose                               | Req/Opt                  | Secret     | Local source                      | Production source                  | Used by                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------- | ------------------------ | ---------- | --------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                                                 | Public base URL                       | Optional                 | No         | `.env.example`                    | Vercel public env                  | Declared in `@platform/config` schema; **not actually read anywhere in `apps/`** — dead config |
| `RUNTIME_API_URL`                                                     | Admin API base URL                    | Required                 | No         | `.env.example` (`localhost:3080`) | Vercel server env                  | `lib/api/client.ts`                                                                            |
| `TENANT_DEFAULT_ID`                                                   | Tenant header                         | Optional                 | No         | `.env.example`                    | Vercel server env                  | `lib/api/client.ts`                                                                            |
| `ADMIN_API_TOKEN`                                                     | Fallback bearer when no staff session | Optional                 | **Secret** | Empty by design (forces 401)      | Secret manager → Vercel server env | `lib/api/client.ts`                                                                            |
| `AUTH_ISSUER_URL`, `AUTH_JWKS_URL`, `AUTH_AUDIENCE`, `AUTH_CLIENT_ID` | Hydra OAuth2 config                   | Required                 | No         | `.env.example` (localhost ports)  | Production Hydra                   | `lib/auth/config.ts`, `middleware.ts`                                                          |
| `AUTH_CLIENT_SECRET`                                                  | Hydra token-exchange secret           | Required                 | **Secret** | Not in `.env.example` by design   | Secret manager                     | `lib/auth/config.ts` → `auth/callback/route.ts` — **has a hardcoded fallback, see Task 4**     |
| `HYDRA_PUBLIC_URL`, `HYDRA_ADMIN_URL`                                 | Hydra API bases                       | Required                 | No         | `.env.example`                    | Production Hydra                   | `middleware.ts`, `lib/auth/config.ts`                                                          |
| `KRATOS_PUBLIC_URL`, `KRATOS_ADMIN_URL`                               | Kratos identity API                   | Required outside `local` | No         | `.env.example`                    | Production Kratos                  | runtime; declared in admin-web too                                                             |

### Backend-only (not relevant to the Vercel deploy, relevant once the backend is redeployed)

`DATABASE_URL`, `REDIS_URL` (both secret-bearing connection strings), `KETO_READ_URL`/`KETO_WRITE_URL`, ClickHouse/S3/MinIO/Kafka/CDC vars, `OTEL_*`, and ~50 optional Security/KMS/HSM/threat-intel/Vault/cloud-provider vars defined in `apps/runtime/src/config.ts` that are **entirely undocumented in `.env.example`** (all optional/gated, `superRefine`-enforced when a provider is selected).

**Documentation gaps found:** `DATABASE_URL_TEST`/`REDIS_URL_TEST` (used by ~15 integration test files) are undocumented; ~50 Security-context vars are undocumented; `NEXT_PUBLIC_APP_URL` is documented but dead (never read).

---

## Task 4 — Secret Boundary Audit

| Check                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env`/`.env.local` gitignored                           | ✅ `.gitignore:20` covers `.env.*`, `!.env.example` carves out the example. Confirmed neither real file is tracked.                                                                                                                                                                                                                                                                                                         |
| `NEXT_PUBLIC_*` usage in admin-web                       | ✅ Zero matches — no public env vars in use, nothing to leak via this channel.                                                                                                                                                                                                                                                                                                                                              |
| Client Components reading `process.env`                  | ✅ None of the 13 `"use client"` files touch `process.env` or import the auth/API modules that hold secrets.                                                                                                                                                                                                                                                                                                                |
| `middleware.ts` (Edge, browser-adjacent) secret exposure | ✅ Deliberately excludes `AUTH_CLIENT_SECRET` — only reads public JWKS/issuer/audience values.                                                                                                                                                                                                                                                                                                                              |
| `lib/api/client.ts` / `lib/auth/config.ts` boundary      | ✅ Server-only by construction (no `"use client"`, not imported by any client component); own header comment states the bearer credential must never reach client code.                                                                                                                                                                                                                                                     |
| Hardcoded secrets elsewhere in repo                      | All are labeled dev-only placeholders (Postgres `lumo/lumo`, MinIO `minioadmin/minioadmin`, Hydra `SECRETS_SYSTEM: dev-hydra-system-secret-change-me-32`, Grafana `admin/admin`), consistently commented "LOCAL DEVELOPMENT ONLY." `infrastructure/k8s/secret.example.yaml` uses `REPLACE_ME__` placeholders, not real values. No committed `.pem`/`.key`/`.p12` files found.                                               |
| **Hardcoded OAuth client-secret fallback**               | ⚠️ **`apps/admin-web/src/lib/auth/config.ts:16`**: `clientSecret: process.env["AUTH_CLIENT_SECRET"] ?? "lumo-admin-web-secret-change-me"`. Runs server-only (not a browser leak), but if the real env var is simply left unset in a production deploy, the app **does not fail to boot** — it silently authenticates against Hydra using this well-known string. This is the single most important finding in this section. |

---

## Task 5 — Authentication Production Audit

**Hydra** (`infrastructure/docker/hydra/hydra.yml`): `dsn: memory` (line 6, no persistence). Issuer `http://localhost:4444/` (line 15); login/consent URLs hardcoded to `http://localhost:3100/login`/`/consent` (lines 20-21) with **no environment-variable templating anywhere in this file**. `strategies.access_token: jwt` → RS256, JWKS auto-published. `ttl.access_token: 15m`; **no refresh-token grant configured** (`scripts/dev/seed-auth-local.mjs:59` registers only `authorization_code`). Cookie `same_site_mode: Lax`. Token/cookie encryption secret (`SECRETS_SYSTEM`) is a plaintext dev placeholder in `docker-compose.yml:401`, no secret-manager integration.

**Kratos** (`infrastructure/docker/kratos/kratos.yml`): `dsn: memory` (line 6). CORS allows exactly one origin, `http://localhost:3100` (lines 11-14). `default_browser_return_url`/`allowed_return_urls` hardcoded to the same localhost origin (lines 21-23). `secrets.cookie`/`secrets.cipher` are plaintext, checked-in placeholders (lines 46-49) — the cipher key is a trivially guessable hex sequence. `hashers.bcrypt.cost: 8` — weak for production (OWASP recommends ≥10-12).

**Keto** (`infrastructure/docker/keto/keto.yml`): `dsn: memory` (line 6). Write API has no auth layer of its own (relies on Docker network isolation).

**admin-web auth code:**

- `middleware.ts` verifies the session JWT at the Edge via `jose.jwtVerify`; on failure, redirects into Hydra `/oauth2/auth`.
- `lib/auth/config.ts` — all five Hydra/Kratos URLs plus the client secret fall back to `localhost`/a placeholder if unset (see Task 4).
- `login/page.tsx:21-23` — its own comment explains the flow relies on `localhost` cookies being **host-only/port-blind** (RFC 6265) so a Kratos cookie set at `:4433` reaches admin-web at `:3100`. **This exact mechanism has no cross-domain equivalent** — see Task 7.
- `auth/callback/route.ts:42-47` sets the session cookie `httpOnly: true, sameSite: "lax"` but **no `secure: true`** — same gap on the two OAuth-flow cookies in `middleware.ts:65-76`.
- `logout/route.ts` clears the local cookie and best-effort calls Kratos logout, but **does not revoke Hydra's own remembered-login session** (documented limitation, `logout/route.ts:10-12`) — a re-login within the 1-hour `remember_for` window can skip Kratos's UI entirely.

**`localhost`/`127.0.0.1`/`:3100`/`:3000` grep across the entire repo — classification:**

Most occurrences (test fixtures, dev scripts, docker-compose healthchecks, doc prose, code-level fallback defaults intended only for local dev) are **acceptable local-only**. Three items rise to **production blocker**:

1. **Hydra/Kratos YAML files have zero environment-variable templating** — issuer/login/consent/CORS/return-URL values can only be changed today by hand-editing the committed config file per environment.
2. **`apps/admin-web/src/lib/auth/config.ts:16`**'s hardcoded client-secret fallback (Task 4).
3. **No Kubernetes manifests exist anywhere for admin-web, Hydra, Kratos, or Keto** — confirmed absent by directory search (`infrastructure/k8s/` has a production-shaped ConfigMap only for `apps/runtime`). There is currently nowhere for a production URL to even point.

---

## Task 6 — Vercel ↔ Backend Architecture

```
Browser
  → Next.js Middleware (Edge runtime) — verifies session JWT, redirects to Hydra if absent/invalid
  → Server Component / Route Handler (lib/api/client.ts:getAdminApi)
      - reads the httpOnly session cookie server-side
      - attaches it as "Authorization: Bearer <jwt>"
      - fetch(`${RUNTIME_API_URL}${path}`) — server-to-server, never exposed to client JS
  → Admin API (apps/runtime / apps/admin controllers)
  → Postgres / backing services
```

The session JWT lives **only** in an `httpOnly` cookie — never in `localStorage`/`sessionStorage`, never passed as a prop to a Client Component, never embedded in page HTML. `client.ts`'s own comment states this explicitly, and it's corroborated by the finding that the Admin API has no CORS configuration anywhere (confirmed by grep across `packages/http/src/*.ts` and `apps/runtime/src/*.ts`) — the architecture assumes, correctly, that the browser never calls it directly.

**This pattern is fully Vercel-compatible as-is** — Server Components, Route Handlers, and Middleware all run server-side (Edge or Node) on Vercel too, so the token-forwarding design holds without modification. The only requirement is that `RUNTIME_API_URL` point at a real, reachable API origin.

---

## Task 7 — CORS / CSRF / Cookie Audit

**CORS today:** Kratos allows exactly `http://localhost:3100` (`kratos.yml:11-14`). Hydra has no CORS block (server-to-server only, none needed). The Admin API has no CORS at all — correct given Task 6's architecture, but would need adding if that assumption ever changes.

**CSRF today:** No explicit CSRF mechanism in admin-web's own code. Protection currently comes from `SameSite=Lax` on all admin-web cookies plus the OAuth2 `state` parameter round-trip (`middleware.ts:55,62` sets it, `auth/callback/route.ts:19-20` validates it). Kratos's own login form carries its own CSRF hidden input, owned by Kratos.

**Cookies today:**

| Cookie               | httpOnly | SameSite | Secure     | Domain           | Path |
| -------------------- | -------- | -------- | ---------- | ---------------- | ---- |
| `lumo_admin_session` | ✅       | Lax      | ❌ not set | none (host-only) | `/`  |
| `lumo_oauth_state`   | ✅       | Lax      | ❌ not set | none             | `/`  |
| `lumo_return_to`     | ✅       | Lax      | ❌ not set | none             | `/`  |

**Production requirements for a real domain split** (`admin.example.com` ↔ `api.example.com` ↔ `auth.example.com`):

1. The `localhost` port-blindness trick that lets Kratos's cookie reach admin-web today (Task 5) has **no cross-domain equivalent**. If Hydra/Kratos and admin-web don't share a registrable parent domain with `Domain=.example.com` cookie scoping, this login flow as currently coded will not work at all.
2. `Secure: true` must be added to all three admin-web-set cookies.
3. If Kratos and admin-web end up on genuinely different domains (not subdomains of one parent), `SameSite=Lax` won't reliably survive the redirect chain — `SameSite=None; Secure` would be required, which raises CSRF exposure and makes explicit CSRF tokens mandatory rather than optional.
4. Kratos's `allowed_origins`/`default_browser_return_url`/`allowed_return_urls` must be updated from `localhost:3100` to the real admin-web origin.
5. Hydra's `urls.login`/`urls.consent`/`urls.self.issuer` must be updated to real HTTPS URLs, matching exactly what `AUTH_ISSUER_URL` is set to everywhere it's checked.
6. The Hydra client's `redirect_uris` (currently only registered via the dev seed script, targeting `localhost:3100/auth/callback`) must be re-registered for the production callback URL — **there is no production client-registration path in the repo at all today.**

---

## Task 8 — Domain & URL Matrix

| Purpose              | Current local value                   | Configured in                                                                                                       | Production placeholder                                                                                  |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Admin Web origin     | `http://localhost:3100`               | `package.json` dev script; referenced in `hydra.yml`, `kratos.yml`, `seed-auth-local.mjs`                           | `https://admin.example.com`                                                                             |
| Runtime/Admin API    | `http://localhost:3080`               | `lib/api/client.ts:19` default, `.env.example`                                                                      | `https://api.example.com`                                                                               |
| Hydra public         | `http://localhost:4444`               | `hydra.yml:15`, `.env`, `middleware.ts`, `lib/auth/config.ts`                                                       | `https://auth.example.com`                                                                              |
| Hydra admin          | `http://localhost:4445`               | `docker-compose.yml`, `.env`, `lib/auth/config.ts`                                                                  | internal-only, never public                                                                             |
| Kratos public        | `http://localhost:4433`               | `kratos.yml:10`, `.env`, `lib/auth/config.ts`                                                                       | `https://auth.example.com` (or dedicated `identity.example.com`)                                        |
| Kratos admin         | `http://localhost:4434`               | `docker-compose.yml`, `.env`, `seed-auth-local.mjs`                                                                 | internal-only                                                                                           |
| Keto read/write      | `:4466`/`:4467`                       | `keto.yml`, `.env`, `seed-auth-local.mjs`                                                                           | internal-only, matches existing `infrastructure/k8s/10-config.yaml` pattern                             |
| OAuth `redirect_uri` | `http://localhost:3100/auth/callback` | `seed-auth-local.mjs:22`; derived from request origin at runtime (good) in `middleware.ts`/`auth/callback/route.ts` | `https://admin.example.com/auth/callback` — must be re-registered as the Hydra client's `redirect_uris` |

**Gap:** `infrastructure/k8s/` has a production-shaped ConfigMap for `apps/runtime` only (`10-config.yaml`). No equivalent manifest exists for admin-web, Hydra, Kratos, or Keto — every URL above outside that one file is local-dev-only with no production counterpart on disk.

---

## Task 9 — Database / Persistence Audit

| Service                       | Persistent volume?      | Classification                                                               |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| PostgreSQL                    | ✅ `postgres-data`      | Required (backend) — already production-shaped                               |
| Redis                         | ✅ `redis-data` + AOF   | Required (backend) — already production-shaped                               |
| ClickHouse                    | ✅ `clickhouse-data`    | Required (Analytics, gated) — already production-shaped                      |
| MinIO                         | ✅ `minio-data`         | **Production blocker** — real S3/equivalent needed; MinIO itself is dev-only |
| Redpanda (Kafka)              | ✅ `redpanda-data`      | Required (event backbone/CDC) — already production-shaped                    |
| Apicurio (schema registry)    | ✅ (backed by Postgres) | Required — correctly configured                                              |
| **Ory Hydra**                 | ❌ `dsn: memory`        | **Production blocker — fully ephemeral**                                     |
| **Ory Kratos**                | ❌ `dsn: memory`        | **Production blocker — fully ephemeral**                                     |
| **Ory Keto**                  | ❌ `dsn: memory`        | **Production blocker — fully ephemeral**                                     |
| Mailpit (dev SMTP sink)       | n/a                     | Local-dev-only — must be replaced with a real transactional email provider   |
| Prometheus/Grafana/Loki/Tempo | ✅ (own volumes)        | Optional; likely replaced by a managed service in real production            |

**Confirmed by the project's own prior report:** `PHASE_A32_AUTHENTICATION_RECOVERY_REPORT.md:139` states every `docker compose restart hydra kratos keto` wipes the OAuth2 client, the admin identity, and every Keto grant — corroborated by the existence of `scripts/dev/seed-auth-local.mjs`, whose entire purpose is to re-seed that state after every restart.

**What must change:** point `hydra.yml`'s, `kratos.yml`'s, and `keto.yml`'s `dsn` at real Postgres databases (the existing `postgres` service, with dedicated logical databases, is the simplest path), drop `--dev` from each service's compose command, and run explicit migrations rather than relying on dev auto-migration.

---

## Task 10 — Docker vs Production Configuration: Blocker List

Full detail gathered against `docker-compose.yml`, `docker-compose.runtime.yml`, and the Hydra/Kratos/Keto configs. Condensed to the items that matter for a production decision (23 total items found; grouped below):

**Ephemeral auth state:** Hydra/Kratos/Keto all `dsn: memory` (Task 9).

**Dev-mode flags loosening security:** Hydra and Kratos both run with `--dev` (`docker-compose.yml:373,398`), which relaxes HTTPS-issuer enforcement and dev-secret-strength checks.

**Weak/default credentials checked into the repo** (all explicitly commented as dev-only, but still real values on disk): Postgres `lumo/lumo`, ClickHouse `lumo/lumo` (username=password), MinIO `minioadmin/minioadmin`, Grafana `admin/admin`, Hydra `SECRETS_SYSTEM` placeholder, Kratos `secrets.cookie`/`secrets.cipher` placeholders, Postgres bootstrap roles `lumo_app`/`debezium`/`apicurio` all using username-as-password (`infrastructure/docker/postgres/init/01-roles-and-cdc.sql:11,21,24`).

**Weak hashing:** Kratos `bcrypt.cost: 8`.

**Permissive/hardcoded network config:** Kratos CORS single-origin localhost; Hydra/Kratos self-service/return URLs hardcoded to localhost with no templating; nearly every stateful service port published directly to the host with no auth layer in front of several (Keto's write API in particular).

**Local-only integrations that need real replacements:** Mailpit (dev SMTP, STARTTLS explicitly disabled) needs a real transactional email provider; MinIO needs real object storage.

**Runtime compose overlay ships non-functional auth wiring today:** `docker-compose.runtime.yml:24-25` sets `AUTH_ISSUER_URL`/`AUTH_JWKS_URL` to `localhost:4444` with a comment explicitly acknowledging no Ory stack runs in that compose file yet — an authenticated request there fails verifying against an unreachable JWKS endpoint by design, self-documented as a placeholder.

**Note on scope:** `apps/admin-web` is not containerized anywhere in this stack — consistent with the plan to host it separately on Vercel. The Hydra/Kratos/Keto blockers above are the ones that most directly gate Admin Web's login path once it leaves `localhost:3100`.

---

## Task 11 — Vercel Deployment Configuration

No `vercel.json` exists for `apps/admin-web` (only `apps/storefront/vercel.json` exists). Given the root `pnpm-workspace.yaml` lists `apps/*`/`packages/*`/`services/*` and `pnpm-lock.yaml` is committed at the repo root, Vercel's zero-config Next.js detection **should** work with Root Directory set to `apps/admin-web` — Vercel walks up to find the workspace lockfile automatically.

**Gap:** without a `vercel.json` (no `ignoreCommand`/`turbo-ignore`), every commit anywhere in the monorepo would trigger a full admin-web rebuild — a cost/noise issue, not a correctness one. Storefront already solved this with an explicit `vercel.json`; admin-web currently relies on implicit behavior only.

**Assessment (not acted on, per instructions):** defaults are probably sufficient for a working build; a `vercel.json` mirroring storefront's pattern would be the safer, more explicit choice once this app is actually scheduled for deployment.

---

## Task 12 — Build Reproducibility

Ran as part of the validation suite (Task 22): `pnpm install --frozen-lockfile` then `pnpm --filter admin-web build` — **both succeeded from the current checkout with no manual steps.**

Every env-var read reachable from the build graph was traced by source inspection:

- `middleware.ts:14-18` and `lib/auth/config.ts:6-17` — module-scope `const`s with `??` fallback defaults, no I/O performed at import time.
- `lib/api/client.ts:33-34` — env reads happen inside the exported function body, evaluated only per-request, never during `next build`.
- `next.config.ts` itself reads **no** `process.env` at all.

**Conclusion:** the build requires no local `.env`, no generated token, no running Docker service, and no reachable localhost backend. `apps/admin-web/.env.local` (present locally, gitignored) is confirmed **not required** — every var it would set has a hardcoded fallback in source. The build is reproducible on a clean checkout with zero env files present; the _resulting app_ is only functionally correct once those defaults are overridden at runtime for whatever environment it's actually serving.

---

## Task 13 — Runtime Dependency Audit

| Package                                     | Classification         | Notes                                                                                                                                                |
| ------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next`, `react`, `react-dom`                | Framework / isomorphic | Standard                                                                                                                                             |
| `jose`                                      | **Edge-compatible**    | Pure WebCrypto, no Node built-ins; used in both `middleware.ts` (Edge) and `lib/auth/session.ts` (Node) — both usages compatible with where they run |
| `next-themes`, `lucide-react`               | Browser-safe           | Client-side UI                                                                                                                                       |
| `geist`, `@fontsource/ibm-plex-sans-arabic` | Build-time-only        | Font assets                                                                                                                                          |
| `@platform/ui`, `@platform/design`          | Browser+server         | Transpiled via `transpilePackages`                                                                                                                   |

No database client, no Docker-only libraries, no native/node-gyp modules anywhere in admin-web's dependency tree. Grep for `node:fs`/`node:crypto`/`node:path`/`require("fs")` across `apps/admin-web/src` returned **zero matches**. The only Node-ish-looking API in use, `crypto.randomUUID()` in `middleware.ts:55`, is the Web Crypto global (not the `node:crypto` module) and is Edge-safe. `middleware.ts` imports only `next/server` and `jose` — no Edge-runtime compatibility issues found.

---

## Task 14 — Admin Routes Production Audit

Auth gate: `middleware.ts` matcher covers everything except `/login`, `/consent`, `/auth/callback`, `/logout`. Verifies the session JWT; on failure/expiry, redirects into Hydra.

**Critical finding: no authorization beyond "has a valid JWT."** `payload.roles`/`payload.kind` are parsed in `lib/auth/session.ts:40-45` and referenced in `consent/page.tsx`/`login/page.tsx`, but **never checked anywhere else in admin-web** (grep for `.roles`, `hasRole`, `kind ===` outside those two files returns nothing). Any authenticated principal, regardless of role, currently gets full access to every screen.

**Stale bug, present on 15 of 17 pages:** each carries the comment "No authenticated session in admin-web yet" and a hardcoded `CURRENT_USER = { name: "Abdullah Nabil", role: "Owner" }` shown in the chrome — stale relative to the real session-reading code already implemented in Phase A.32.

| Route                                                    | Auth     | Backend calls                                                                                                  | Empty/error states                                                                                         | Demo/mock data?                                                    |
| -------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/` (Dashboard)                                          | required | `getDashboardData()` — **hardcoded, no live path exists**; Recent Orders widget uses a real `GET /orders` call | Suspense skeleton; visible "demo" badge                                                                    | **Yes — permanently.** Not a failure fallback; it's the only mode. |
| `/analytics`, `/integrations`, `/marketing`, `/settings` | required | none — no backend exists yet                                                                                   | static "unavailable" card                                                                                  | No — honest gap                                                    |
| `/automations`, `/content`, `/discounts`                 | required | real list APIs                                                                                                 | typed unauthorized/error/empty states                                                                      | No                                                                 |
| `/customers`, `/customers/[id]`                          | required | real APIs                                                                                                      | typed states                                                                                               | No                                                                 |
| `/orders`, `/orders/[id]`                                | required | real APIs (parallel Suspense fetches for related contexts)                                                     | typed states, per-section                                                                                  | No                                                                 |
| `/products`, `/products/[id]`                            | required | real APIs                                                                                                      | typed states                                                                                               | No                                                                 |
| `/login`, `/consent`, `/auth/callback`, `/logout`        | public   | Kratos/Hydra flows                                                                                             | `/consent` throws a raw `Error` on Hydra rejection with **no `error.tsx` anywhere in the app** to catch it | No                                                                 |

**Global gap:** zero `error.tsx` files exist anywhere in `src/app`. An uncaught throw (e.g. the `/consent` Hydra-rejection case) falls through to Next's built-in error UI instead of the app's design system, and is not logged anywhere.

---

## Task 15 — Error Handling Audit

Central client `lib/api/client.ts` collapses every non-OK response into one of four outcomes:

| Condition                | Handling                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401, 403                 | Collapsed into a single `{ outcome: "unauthorized" }` — **no distinction between "not logged in" and "logged in but forbidden"**                      |
| 404                      | `{ outcome: "not_found" }`                                                                                                                            |
| 409, 429, 500, any other | Generic `{ outcome: "error", message: "Admin API responded with status ${status}" }` — no retry-after handling for 429, no distinct messaging for 409 |
| Network failure          | Caught; raw JS error message (may contain hostnames/ports) captured internally                                                                        |
| Timeout                  | **No `AbortController`/timeout anywhere** — a hung backend hangs the UI's Suspense boundary indefinitely                                              |
| Expired/invalid session  | Handled in `middleware.ts` — caught `jwtVerify` throw → redirect to Hydra re-auth, cookie deleted                                                     |

**Leak check — clean.** `result.message` (the potentially-sensitive raw string, e.g. containing `ECONNREFUSED 127.0.0.1:3080`) is **never rendered into the UI** — grepped across `src/app`, zero interpolations found; pages render only fixed translated strings.

**Logging gap (not a leak):** zero `console.log`/`console.error`/`console.warn` calls found anywhere in `src/app`, `src/lib`, `src/data`, `src/components`. Errors are converted to typed outcomes and silently dropped — no sensitive data ever reaches a console, but there is also zero operational visibility into what's failing and how often (ties directly into Task 16).

---

## Task 16 — Observability Audit

A real, established pattern exists elsewhere in the repo: `packages/observability` (OpenTelemetry tracing/metrics/structured logging/error reporting), consumed by `apps/runtime`. The full Docker stack (OTel Collector, Loki, Tempo, Prometheus, Grafana, Alertmanager) is wired to the backend, not decorative.

**`apps/admin-web` has none of it.** No `@opentelemetry/*`, no error-tracking SDK, no structured logging, no request-ID propagation, no tracing, no metrics — confirmed against its full `package.json` dependency list.

**Verdict:** admin-web currently has zero observability instrumentation. Adding it is justified by an already-established repo pattern (adopting `@platform/observability`, as `apps/runtime` already does) rather than inventing net-new infrastructure.

---

## Task 17 — Security Headers

`next.config.ts` has no `headers()` function. No `vercel.json` exists. `middleware.ts` never attaches response headers (only sets/deletes cookies). **None of the following exist anywhere in this app:** Content-Security-Policy, X-Frame-Options/`frame-ancestors`, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Strict-Transport-Security — confirmed by grep, zero matches for any of these header names.

Background (general knowledge, not specific to this repo's hosting): Vercel does not inject CSP or X-Frame-Options by default — that responsibility sits with the app. Since `next.config.ts` sets `output: "standalone"` (a container/self-host signal, inert on Vercel), this reinforces that headers were never configured with any particular host in mind.

**Where to add them:** either `next.config.ts`'s async `headers()` function, or `middleware.ts` by attaching headers to the `NextResponse` before returning (would need updating on every early-return path, not just the redirect path). Both locations are currently unused; either is viable.

---

## Task 18 — Dependency / Supply Chain Audit

`pnpm-lock.yaml` is committed at the repo root and tracked. `pnpm outdated --filter admin-web` (read-only, network reachable):

| Package                                | Current | Latest | Assessment                                                      |
| -------------------------------------- | ------- | ------ | --------------------------------------------------------------- |
| `next`                                 | 15.5.22 | 16.3.1 | One major behind; 15.x still actively supported, not EOL        |
| `react`/`react-dom`                    | 19.2.7  | 19.2.8 | Patch behind                                                    |
| `jose`                                 | 5.10.0  | 6.2.8  | One major behind; no known critical advisory found in this pass |
| `typescript`, `vitest`, `eslint` (dev) | —       | —      | One-to-two majors behind, dev-only                              |
| `lucide-react`                         | 0.460.0 | 1.31.0 | Pre-1.0 → 1.x, icon library, low risk                           |

No duplicate major-version splits found for `react`, `react-dom`, `next`, or `jose` across the lockfile (each resolves to exactly one version). Root `pnpm-workspace.yaml` already carries deliberate `overrides` and a documented `auditConfig.ignoreGhsas` allowlist with per-advisory justification — `pnpm audit` is already a live, governed CI gate elsewhere in this repo.

**No concrete security/build/runtime reason found to force any upgrade in admin-web right now.**

---

## Task 19 — Production Data Safety

**Fails silently in exactly one place.** The Dashboard's KPI/sales/top-products/channels data (`src/data/dashboard.ts:120-239`) is unconditionally hardcoded — there is no live path at all yet. It's disclosed via a visible "demo" badge, so it isn't a silent lie to the operator, but it **will render in production exactly as it does today** — this isn't a failure fallback, it's the only mode that currently exists. Every other screen (orders, products, customers, automations, content, discounts) explicitly documents and implements "never falls back to demo data on failure," showing honest unauthorized/error/empty states instead.

**Hardcoded `localhost` fallbacks — the most important finding in this section.** The following all use `process.env["X"] ?? "http://localhost:..."` (or a placeholder secret) instead of failing at startup:

- `lib/api/client.ts:19` — `RUNTIME_API_URL` defaults to `localhost:3080`; `TENANT_DEFAULT_ID` defaults to `tenant-local`.
- `lib/auth/config.ts:7-11` — five Hydra/Kratos URLs default to `localhost`.
- `lib/auth/config.ts:16` — `AUTH_CLIENT_SECRET` defaults to a hardcoded placeholder (Task 4).
- `middleware.ts:14-16` — the same five URLs, re-declared (Edge can't import the Node module).
- `login/page.tsx:73` — falls back to `"localhost:3100"` if no `Host`/`X-Forwarded-Host` header is present (defensible as a defensive fallback behind a real proxy, but still part of the same pattern).

**Net effect:** if these env vars are simply left unset in a production deployment, the app does **not** fail to boot. It silently targets `localhost` and a known placeholder secret, then fails at request time with connection-refused errors — caught and shown as a generic error panel (Task 15), not a startup failure. There is no env-var presence validation at startup anywhere in `apps/admin-web` (no schema check of `process.env`, unlike `apps/runtime`'s Zod-validated `config.ts`).

No evidence of demo-customer/demo-order seeding logic inside admin-web itself (seeding lives entirely in `scripts/dev/seed-auth-local.mjs`, outside this app).

---

## Task 20 — Vercel Deployment Checklist

**Before Vercel**

- [ ] Decide and stand up a real target for Hydra/Kratos/Keto (currently: nowhere) — needs persistent Postgres-backed `dsn`, HTTPS issuer, and a way to template the config per environment
- [ ] Register a production Hydra OAuth2 client with the real `redirect_uris` (no path for this exists today beyond the dev seed script)
- [ ] Decide the production admin/API/auth domains (Task 8 matrix)
- [ ] Provision `AUTH_CLIENT_SECRET`, `ADMIN_API_TOKEN`, `DATABASE_URL`, `REDIS_URL`, etc. in a real secret manager
- [ ] Decide whether Kratos/Hydra will share a parent domain with admin-web (required for the current cookie-bridge design to work at all — Task 7)

**Vercel**

- [ ] Set Project Root Directory to `apps/admin-web`
- [ ] Confirm zero-config build works, or add a `vercel.json` mirroring `apps/storefront/vercel.json` (recommended for `ignoreCommand`/turbo-ignore, not strictly required)
- [ ] Set all env vars from the Task 3 matrix in Vercel project settings (server-only where marked secret)
- [ ] Configure the production domain and any deployment protection needed

**Backend**

- [ ] Add CORS to Kratos for the real admin-web origin
- [ ] Update Hydra's issuer/login/consent URLs to real HTTPS values
- [ ] Confirm JWT issuer/JWKS match exactly between Hydra and what `middleware.ts`/`lib/auth/session.ts` verify against
- [ ] Add authorization checks (role/kind enforcement) before this is a safe multi-operator surface (Task 14)

**After deployment**

- [ ] Login, logout, session-expiry, re-login redirect preservation
- [ ] Customers, Products, Orders real-data paths
- [ ] Arabic/RTL
- [ ] 401/403/unauthorized behavior end-to-end
- [ ] Confirm the Dashboard's demo badge is still visibly disclosed (or the fake data is removed/replaced first)

---

## Task 21 — Deployment Blockers

### P0 — MUST FIX BEFORE PRODUCTION

1. **Hydra/Kratos/Keto are fully ephemeral** (`dsn: memory` in all three configs) — no production deploy of the auth stack can hold state across a restart.
2. **No production deployment target exists for Hydra/Kratos/Keto at all** — no k8s manifests, no hosted Ory, no Railway/Vercel config. Admin Web on Vercel would have nothing to authenticate against.
3. **Hardcoded fallback OAuth client secret** (`lib/auth/config.ts:16`) — must fail closed instead of silently defaulting when `AUTH_CLIENT_SECRET` is unset.
4. **No authorization enforcement beyond "has a valid JWT"** — roles are parsed but never checked; any authenticated principal gets full access to every admin screen.
5. **Session cookies missing `Secure`** on all three admin-web-set cookies — must be set before serving over HTTPS.
6. **The Kratos↔admin-web login bridge relies on `localhost` port-blindness** with no cross-domain equivalent — the login flow as coded will not function once Hydra/Kratos and admin-web are on different real domains without a redesign (shared parent domain + `Domain=` cookie, or a different token-passing mechanism).
7. **No startup env validation** — a misconfigured production deploy doesn't fail to boot, it silently targets `localhost` and a known secret, then fails opaquely at request time.
8. **Weak/default credentials checked into Docker config** (Postgres, ClickHouse, MinIO, Grafana, Hydra, Kratos) — none may be reused in production.
9. **Kratos `bcrypt.cost: 8`** — too weak for production password hashing.
10. **No production OAuth client registration path** — only the dev seed script exists, targeting `localhost:3100`.

### P1 — SHOULD FIX BEFORE PRODUCTION

1. Stale hardcoded `CURRENT_USER = "Abdullah Nabil"` shown regardless of who's actually logged in — contradicts the real session code already in place.
2. Dashboard KPIs are permanently fake demo data with no live path — will ship to production as-is.
3. Zero security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS).
4. Zero observability in admin-web despite an established pattern already used by the backend.
5. No `error.tsx` anywhere — uncaught throws fall through to Next's default error UI, unlogged.
6. No request timeout/`AbortController` on backend fetches — a hung backend hangs the UI indefinitely.
7. Logout doesn't revoke Hydra's own remembered-login session (documented limitation).
8. No `vercel.json` for admin-web — every monorepo commit would trigger a full rebuild without one.
9. Doc/reality mismatch: architecture docs mandate Kubernetes/EKS+ArgoCD+Vault; only Railway (demo-only) and Vercel (storefront-only) configs exist on disk. Decide the real target.
10. `.env.example` documentation gaps (~50 undocumented backend vars, undocumented test-DB vars, one dead public var).
11. 401 and 403 collapsed into a single generic outcome client-side.

### P2 — CAN FOLLOW AFTER FIRST DEPLOYMENT

1. Dependency version gaps (Next 15→16, jose 5→6, dev tooling) — no known critical advisories, not urgent.
2. Duplicated JWT-verification logic between `middleware.ts` and `lib/auth/session.ts`.
3. `output: "standalone"` in `next.config.ts` is inert on Vercel — harmless, but worth a comment or removal for clarity.
4. Hydra/Kratos config YAML has no env-var templating mechanism — fine if generated per-environment via CI for now, but needed before routine multi-environment (staging+prod) operation.
5. Redis/ClickHouse/MinIO/Redpanda need managed equivalents when the backend itself is moved to production — outside admin-web's own Vercel scope.

---

## Task 22 — Full Validation Results

All commands run from a clean state, in order, exactly as specified:

| Command                          | Result                                                                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | ✅ Pass — "Lockfile passes supply-chain policies," 82 workspace projects, no changes needed                                                                                                                                                                                                   |
| `pnpm typecheck`                 | ✅ Pass — 78/78 packages, `admin-web` and `storefront` both included                                                                                                                                                                                                                          |
| `pnpm lint`                      | ✅ Pass — 78/78 packages                                                                                                                                                                                                                                                                      |
| `pnpm arch`                      | ✅ Pass — "no dependency violations found" (1,572 modules, 6,857 dependencies cruised)                                                                                                                                                                                                        |
| `pnpm test`                      | ✅ Pass — all test files green across all 78 packages, including `apps/runtime`'s 30 test files / 184 tests. One stderr line from `composition.test.ts` (`FAILS CLOSED outside local without a production MFA provider`) is a **passing** test verifying fail-closed behavior, not a failure. |
| `pnpm --filter admin-web build`  | ✅ Pass — Next.js 15.5.22, compiled in 7.2s, 18/18 static pages generated (all routes render `ƒ` Dynamic, as expected — none are static), middleware bundle 39.5 kB                                                                                                                           |

No test was skipped; none were marked skipped in output. No integration tests requiring live Docker/Postgres/Redis were part of this validation pass (matching Task 22's "if appropriate" wording — the standard suite above is what CI already gates on).

---

## Task 23 — No Deployment Occurred

Confirmed: no deploy to Vercel, no backend deploy, no DNS change, no production secret change, no production OAuth client created, no production database modified. `git status` was checked before and after this audit — the working tree is byte-for-byte unchanged from the pre-existing Phase A.32 diff (see Task 25).

---

## Final Verdict

**Can `apps/admin-web` be deployed to Vercel today? Mechanically, yes — the build succeeds, nothing in the code is Vercel-incompatible, and the token-forwarding architecture (Task 6) works unmodified on Vercel's Edge/Node runtimes.**

**Should it be? No.** The 10 P0 items above are all real: the auth backend it depends on doesn't exist in any production-reachable form, its state is fully ephemeral where it does run, the login flow's cookie mechanism doesn't survive a real domain split, there's no authorization layer, and misconfiguration degrades silently rather than failing closed. Fix the P0 list — primarily items 1, 2, 4, 6, and 7 — before scheduling an actual deploy. The P1 list should follow shortly after; the P2 list can trail the first real deployment.

---

## Task 25 — Commit Plan (NOT executed — awaiting explicit approval)

### 1. Exact files changed by this Phase A.33 session

One file: this report, `PHASE_A33_PRODUCTION_READINESS_REPORT.md` (newly created). No source code, configuration, or dependency file was modified, added, or deleted during this audit. `git status`/`git diff --stat` were checked before and after — identical except for this new file.

### 2. Files proposed for commit (this phase only)

- `PHASE_A33_PRODUCTION_READINESS_REPORT.md` (new)

### 3. Pre-existing uncommitted files — outside this phase's scope

The working tree already carries the Phase A.32 authentication implementation, per the task context: _"The latest Phase A.32 changes have an approved commit plan but must be treated as already completed implementation work."_ This audit did not re-examine or re-approve that plan, and did not touch any of these files:

```
Modified:
  .env.example
  apps/admin-web/package.json
  apps/admin-web/src/lib/api/client.ts
  apps/admin-web/src/lib/api/orders.test.ts
  infrastructure/docker/docker-compose.yml
  pnpm-lock.yaml

Untracked:
  PHASE_A32_AUTHENTICATION_RECOVERY_REPORT.md
  apps/admin-web/src/app/auth/
  apps/admin-web/src/app/consent/
  apps/admin-web/src/app/login/
  apps/admin-web/src/app/logout/
  apps/admin-web/src/lib/auth/
  apps/admin-web/src/middleware.ts
  infrastructure/docker/hydra/
  infrastructure/docker/keto/
  infrastructure/docker/kratos/
  scripts/dev/
```

These remain governed by Phase A.32's own already-approved plan, not by this one. `.claude/` is untracked and was not touched, per the standing rule not to modify it.

### 4. Intentionally excluded files

- `.claude/` — never modified or staged, per standing rule
- Root `.env` / `apps/admin-web/.env.local` — real local secrets, correctly gitignored, never staged
- `.turbo/`, `.pnpm-store/`, `node_modules/`, `.next/` build output — build artifacts, gitignored

### 5. Security blockers to commit

None found in the new report file itself (it reproduces no real secret values). The pre-existing A.32 diff was not re-audited for this purpose here — see Task 4/5 findings above for what it contains (dev-only placeholder secrets, consistently labeled as such in-repo).

### 6. Production blockers

See Task 21 — 10 P0, 11 P1, 5 P2 items. None are blockers to committing _this report_; all are blockers to an actual Vercel deployment.

### 7. Proposed commit message (for this phase only, once approved)

```
docs: add Phase A.33 production readiness & Vercel deployment audit

Audit-only pass over apps/admin-web's Vercel deployment readiness,
covering deployment config, env/secret boundaries, Hydra/Kratos/Keto
production posture, CORS/CSRF/cookies, persistence, security headers,
and dependency/runtime compatibility. No code changed; full validation
suite (typecheck/lint/arch/test/build) re-confirmed green. Verdict:
mechanically Vercel-deployable, not production-ready — 10 P0 blockers
identified, primarily around ephemeral auth state, missing authorization
enforcement, and no production deployment target for Hydra/Kratos/Keto.
```

### 8. Is anything truly required, or is the repo already production-ready?

**Not already production-ready.** Changes are required — see the P0 list (Task 21) — before a real Vercel deployment of `apps/admin-web` should be attempted. This report itself requires nothing further to be "correct" as a deliverable; it is ready to commit once you approve, standing alone as documentation and not depending on the P0 fixes being done first.

---

**STOP — awaiting explicit approval before any commit, push, or deployment action.**
