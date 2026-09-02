# Phase A.32 — Hydra/Kratos Authentication Recovery & Admin Login

**Status:** Golden path proven end-to-end in local dev. Not committed/pushed — awaiting approval of the commit plan below (Task 20).

## 1. Root cause — Hydra

`infrastructure/docker/hydra/` was an empty, untracked-looking directory. Hydra's own logs were unambiguous:

```
Error: open /etc/config/hydra/hydra.yml: no such file or directory
```

The file wasn't missing by omission — it existed, previously reviewed, on branch `reference/working-tree-2026-08-03` (commit `de46df9`), along with `infrastructure/docker/kratos/{kratos.yml,identity.schema.json}`, `infrastructure/docker/keto/keto.yml`, `scripts/dev/mint-local-token.mjs`, **and** the `docker-compose.yml` service blocks for `keto`/`kratos`/`hydra`/`temporal` themselves. None of it made it back to `main` during the repo's history reconstruction. This is the exact same failure class commit `3baada5` ("restore runtime image + reusable workflows dropped from main (C-02, C-03, H-09)") already fixed once for a different set of files — that commit's own message states it restored files "verbatim from `de46df9`" rather than rewriting them, which is the precedent this recovery follows.

The three containers (`lumo-hydra-1`, `lumo-kratos-1`, `lumo-keto-1`) had been crash-looping for **5 weeks** — they were created from a compose file version that once had these service definitions; `main`'s current `docker-compose.yml` has never had them, so `docker compose up` never recreated them correctly, and they just kept restarting against bind mounts pointing at empty directories.

## 2. Root cause — Kratos

Identical pattern, same commit, same missing-since-reconstruction cause:

```
Error: open /etc/config/kratos/kratos.yml: no such file or directory
```

## 3. Root cause — Keto

`infrastructure/docker/keto/keto.yml` was not a missing file but a **phantom empty directory** — Docker auto-creates a directory at a bind-mount source path that doesn't exist, which is exactly what happened here (same underlying cause: the real `keto.yml` was never restored). Removed the phantom directory before restoring the real file.

## 4. Fixes made

| #   | Change                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Restored `infrastructure/docker/hydra/hydra.yml`, `kratos/{kratos.yml,identity.schema.json}`, `keto/keto.yml` verbatim from `de46df9`                         | Proven root cause; reuses previously-reviewed config instead of writing new                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2   | Restored the `docker-compose.yml` **Identity & workflow plane** section (`keto`, `kratos`, `hydra` service blocks only) from `de46df9`                        | Same source; `temporal`'s block was in the same section but intentionally **excluded** — out of scope for auth, and its own orphan container was already running fine                                                                                                                                                                                                                                                                                                                                    |
| 3   | Corrected `hydra.yml`'s `urls.login`/`urls.consent` and `kratos.yml`'s `selfservice.*` / CORS URLs from `:3000` to `:3100`                                    | The restored files assumed port 3000, which is `apps/storefront`'s port, not `apps/admin-web`'s (`apps/admin-web/package.json`: `"dev": "next dev --port 3100"`). Nothing consumed the old value — storefront never had an authorization_code flow either — so this wasn't a speculative change, it was required for the only real consumer being wired up                                                                                                                                               |
| 4   | Restored `scripts/dev/mint-local-token.mjs` verbatim from `de46df9`                                                                                           | Same history-reconstruction casualty; referenced by two doc comments elsewhere in the repo but absent from disk                                                                                                                                                                                                                                                                                                                                                                                          |
| 5   | Added `scripts/dev/seed-auth-local.mjs` (new)                                                                                                                 | Hydra/Kratos/Keto all use `dsn: memory` by the _existing_ config's own design (documented in `hydra.yml`'s own header comment: "clients and signing keys are ephemeral across restarts — production uses a dedicated Hydra database") — nothing survives a restart. This idempotently recreates the `lumo-admin-web` OAuth2 client, one local Kratos admin identity, and the Keto grants every Admin Web read screen needs. Mirrors `mint-local-token.mjs`'s own established idempotent-recreate pattern |
| 6   | Implemented `apps/admin-web`'s login integration (was **completely absent** — zero auth code existed)                                                         | `middleware.ts` (route gate), `/login` (Hydra login-provider bridge into Kratos's self-service flow), `/consent` (auto-accept — first-party client, no third-party consent screen needed), `/auth/callback` (code exchange, sets httpOnly session cookie), `/logout`, `lib/auth/{config,session}.ts`                                                                                                                                                                                                     |
| 7   | Updated `lib/api/client.ts`                                                                                                                                   | Forwards the logged-in staff member's real session JWT when present; falls back to the pre-existing `ADMIN_API_TOKEN` server-to-server credential when absent (unchanged behavior for that path)                                                                                                                                                                                                                                                                                                         |
| 8   | Filled in `.env` / `.env.example` / `apps/admin-web/.env.local` (gitignored)                                                                                  | `AUTH_ISSUER_URL`/`AUTH_JWKS_URL`/`HYDRA_*`/`KRATOS_*`/`KETO_*` were already typed and validated in `apps/runtime/src/config.ts` but the env templates never populated them                                                                                                                                                                                                                                                                                                                              |
| 9   | Created one local Kratos identity (`admin@lumo.local`, `metadata_public.kind="staff"`, `roles=["admin"]`) and granted it 14 `:read` permission tuples in Keto | Permission strings were **grep'd** from `apps/admin/src/interfaces/*.admin-controller.ts` (`customers:read`, `products:read`, `categories:read`, `orders:read`, `fulfillment:read`, `shipping:read`, `returns:read`, `payments:read`, `content:read`, `automation:read`, `coupons:read`, `analytics:read`, `finance:read`, `inventory:read`) — not invented. No new role model; reuses Keto's existing relation-tuple mechanism exactly as `packages/auth/src/keto.ts` already implements it             |

No new authentication system, no bypass, no fake JWTs, no hardcoded admin credentials, no weakened authorization — every JWT in this recovery is real, signed by the running Hydra instance, and verified by the _unchanged_ `packages/auth/src/jwt-verifier.ts`.

## 5. Docker health — before / after

| Container         | Before                      | After                    |
| ----------------- | --------------------------- | ------------------------ |
| `lumo-hydra-1`    | `Restarting (255)`, 5 weeks | `Up, healthy`            |
| `lumo-kratos-1`   | `Restarting (1)`, 5 weeks   | `Up, healthy`            |
| `lumo-keto-1`     | `Exited (127)`              | `Up, healthy`            |
| `lumo-temporal-1` | orphan, running             | unchanged (out of scope) |

## 6. OAuth/OIDC configuration

- **Issuer:** `http://localhost:4444/`
- **JWKS:** `http://localhost:4444/.well-known/jwks.json` (RS256, `strategies.access_token: jwt`)
- **Client:** `lumo-admin-web` — `authorization_code` grant, `redirect_uri=http://localhost:3100/auth/callback`, `scope="openid lumo.admin"`, `audience=["lumo-admin"]`, `token_endpoint_auth_method=client_secret_post`
- **Kratos:** public `:4433` (whoami, self-service flows), admin `:4434`; password method; identity schema uses email as the password identifier
- **Keto:** read `:4466`, write `:4467`; `permissions` namespace, matching `packages/auth/src/keto.ts`'s existing `KetoAccessControl` contract exactly

## 7. JWT validation results

Verified three ways: (a) direct `jose.jwtVerify` against the live JWKS endpoint using the exact issuer/audience `JwtVerifier` uses, (b) the running `apps/runtime` API's own `JwtVerifier`, (c) the real browser flow end to end. `packages/auth/src/jwt-verifier.ts` was **not modified**.

## 8. Admin authorization results (Task 12)

Tested against the live `apps/runtime` API (`APP_ENV=local`, `KETO_READ_URL` set — real Keto check, not the permissive local escape hatch):

| Case                                                                 | Result                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| No token                                                             | `401`                                                              |
| Invalid/garbage token                                                | `401`                                                              |
| Valid token, no Keto grant (`lumo-dev-cli` client_credentials token) | `403 FORBIDDEN — Missing permission "orders:read"`                 |
| Valid token, granted identity, via real browser session              | `200` on `/api/v1/orders`, `/api/v1/customers`, `/api/v1/products` |

## 9. Browser golden-path result (Tasks 13, 14, 18)

Full flow driven through a real browser session against the live stack:

```
/  (unauthenticated)
 -> middleware redirects to Hydra /oauth2/auth
 -> Hydra redirects to /login?login_challenge=...
 -> no Kratos session -> redirect to Kratos /self-service/login/browser
 -> Kratos redirects to /login?flow=... (real Kratos-rendered form, password method)
 -> operator submits real credentials
 -> Kratos redirects back to /login?login_challenge=... (now with a session)
 -> /login reads Kratos whoami, accepts the Hydra login request
 -> Hydra redirects to /consent?consent_challenge=...
 -> /consent auto-accepts (first-party client), attaches kind/roles claims
 -> Hydra redirects to /auth/callback?code=...
 -> code exchanged for a real RS256 JWT at Hydra's /oauth2/token
 -> httpOnly session cookie set
 -> redirected to originally-requested page
```

- **Dashboard:** renders; "Recent orders" shows `Live` / "No orders yet" — real API call, real (empty) result, no demo-data fallback
- **Customers:** "No customers yet." — real empty state
- **Products:** search UI renders, no unauthorized error
- **Orders:** full status-filter UI renders, no unauthorized error
- **Logout → `/orders` direct access:** correctly bounced back to `/login` (session cleared)
- **Re-login:** returned to the originally-requested page (`/orders`), not just the dashboard — the `return_to` cookie round-trips correctly through the whole OAuth dance
- **Arabic/RTL:** toggling the language control while authenticated flips `<html lang="ar" dir="rtl">` with no re-authentication and no console errors
- **Console:** the only errors seen were three transient `Kratos rejected the login flow lookup: 403` entries from _before_ a mid-session fix (the flow-lookup fetch wasn't forwarding the browser's Kratos cookie yet); zero errors after that fix, across the entire remaining session

No mock data, no fake API responses, at any point.

## 10. Tests (Task 16)

New:

- `apps/admin-web/src/lib/auth/session.test.ts` — 6 cases: no cookie, `cookies()` throwing (no request scope), verification failure, valid claims → session, missing optional claims default correctly, missing `sub` → null
- `apps/admin-web/src/lib/api/orders.test.ts` — 1 new case: the logged-in staff member's session token is forwarded ahead of `ADMIN_API_TOKEN` when both are present

Reused existing infrastructure only (vitest, the repo's existing `vi.mock`/`vi.hoisted` conventions) — no new test framework.

## 11. Full validation (Task 17)

| Gate                            | Result                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                | 78/78 packages pass                                                                            |
| `pnpm lint`                     | 78/78 packages pass                                                                            |
| `pnpm test`                     | 78/78 task groups pass (includes the 7 new cases above)                                        |
| `pnpm arch`                     | `no dependency violations found (1572 modules, 6857 dependencies cruised)`                     |
| `pnpm --filter admin-web build` | production build succeeds; all 19 routes generated; `middleware` compiles for the Edge runtime |

## 12. Security scan (Task 15)

**PASS.** Every changed/new file was scanned for passwords, API keys, JWT secrets, private keys, connection strings, and OAuth client secrets:

- The one generated local-dev admin password was never written to any tracked _or untracked_ repository file (grep-verified against every changed file) — it lived only in an env var and a scratchpad file outside the repo.
- All literal values present (`lumo-admin-web-secret-change-me`, `lumo-dev-cli-secret-change-me`, `dev-only-cookie-secret-change-me-32chars`, `SECRETS_SYSTEM: dev-hydra-system-secret-change-me-32`) are clearly-labeled, non-production placeholders matching this repo's own **pre-existing** convention (already committed elsewhere in `docker-compose.yml`: `POSTGRES_PASSWORD=lumo`, `MINIO_ROOT_PASSWORD=minioadmin`) — not something newly introduced by this phase.
- The historical pgAdmin credential finding (Phase A.23) remains fixed and untouched by this change — confirmed `.env.example`'s `PGADMIN_DEFAULT_PASSWORD` line is unmodified by this diff.
- `docker-compose.yml`'s diff is a pure 78-line addition — zero deletions, so nothing pre-existing (including the pgAdmin fix) was touched.

## 13. Remaining blockers / known limitations (documented, not fixed)

1. **Port collision, pre-existing, unrelated to auth:** `apps/admin-web`'s own committed dev port (`3100`) collides with the `loki` container, which also publishes `3100`. Discovered while verifying — I stopped `loki` temporarily to run the browser test and restarted it afterward. Did not change either port; that's a call for the user (move Loki's port vs. admin-web's dev port).
2. **Ephemeral Ory state:** all three services use `dsn: memory` by the _existing_ config's own design — every `docker compose restart hydra kratos keto` wipes the OAuth2 client, the admin identity, and the Keto grants. Re-run `node scripts/dev/seed-auth-local.mjs` (with `ADMIN_DEV_PASSWORD` set) after any restart.
3. **Hydra's "remembered" login session:** `/login` and `/consent` accept with `remember_for: 3600`. `/logout` clears admin-web's own session cookie and best-effort triggers Kratos's self-service logout, but does not independently revoke Hydra's own remembered-login cookie — a re-login within that hour could skip re-prompting Kratos's UI. Documented in `logout/route.ts`'s own comment; left as-is per the smallest-possible-integration bar.
4. **`CURRENT_USER` placeholder:** every admin-web page still hardcodes `{ name: "Abdullah Nabil", role: "Owner" }` in its chrome. Pre-existing, explicitly deferred by its own code comment ("Replace this with the real session read once Identity is wired in — nothing else on the page has to change"). Left untouched — wiring it up touches every page file, which is rebuilding admin screens, out of scope for this phase.
5. **No committed deployment for the Ory stack:** `infrastructure/k8s/` references `KRATOS_PUBLIC_URL`/`HYDRA` URLs in `10-config.yaml` but has no Deployment/Service manifest for Hydra, Kratos, or Keto — this recovery is local-dev only.

## 14. Production readiness verdict

**NOT production-ready as shipped — by explicit design of the config being restored, not a gap introduced here.** The restored `hydra.yml`/`kratos.yml`/`keto.yml` are dev configs (`dsn: memory`, dev-only cookie/cipher/system secrets, documented in their own header comments as such — "production uses a dedicated Hydra database"). Local golden path is fully proven and reproducible. Before any non-local environment: provision real Postgres-backed DSNs for Hydra/Kratos/Keto, source all `*_SECRET`/`SECRETS_SYSTEM` values from the secret manager, and write the missing k8s manifests for all three services.
