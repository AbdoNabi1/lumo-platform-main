# Phase A.34 — Production Blockers Remediation Report

**Scope:** Remediate the 10 P0 blockers and the highest-impact P1 issues Phase A.33 identified for
`apps/admin-web` and its Hydra/Kratos/Keto identity plane. No redesign, no new bounded contexts, no
public API changes beyond what P0 security fixes required, no fake production data, no security
weakened to pass a test, no deployment, no commit/push.

**Bottom line:** All 10 P0 blockers are closed or have a concrete, working production path. Several
P1s are closed; a few are explicitly deferred (documented, not silently dropped). Full validation
suite is green. The one item this report cannot close is **live browser verification** — Docker
Desktop's WSL2 backend is down in this environment (see Task 22), the same failure mode recorded in
four prior phases (A.12, A.14, A.19-pre-fix). Verdict is at the bottom.

---

## 1. Deployment-target decision (governs several fixes below)

A.33's Task 1 found three uncoordinated deployment stories (K8s-per-docs, Railway-as-demo,
Vercel-for-storefront-only) and admin-web assigned to none of them. A.33's Task 6 also surfaced a
real tension nobody had named yet: `login/page.tsx` and `consent/page.tsx` call **Hydra's admin
API** (`/admin/oauth2/auth/requests/...`) server-side — an endpoint with zero authentication of its
own that must never be reachable outside a trusted network. If admin-web deployed to Vercel (an
external network relative to the cluster), there would be no way to reach that endpoint without
either exposing it publicly (unacceptable) or moving the login/consent logic into a new in-cluster
service (a redesign this phase was told not to do).

**Decision:** deploy admin-web in-cluster (EKS/K8s — the platform's own documented production
target, `docs/architecture/15-scalability-and-deployment.md`, "Requires ADR to change"), not
Vercel. This is not a new architecture — `apps/storefront` already has this exact dual posture
(both a `vercel.json` and a full k8s Deployment), and admin-web's `next.config.ts` already had
`output: "standalone"` (a container signal, previously called "inert on Vercel" by A.33 — it's
`admin-web.Dockerfile` that actually uses it now). Running in-cluster resolves the Hydra-admin-API
reachability problem for free: admin-web reaches `hydra:4445`/`kratos:4434` pod-to-pod, over a
`NetworkPolicy` that allows only admin-web's pods to reach them (`infrastructure/k8s/
50-networkpolicy.yaml`).

Vercel remains mechanically viable per A.33's own Task 2 verdict (nothing in the code is
Vercel-incompatible) — if that path is chosen later instead, the Hydra-admin-API reachability gap
above becomes an **open item requiring its own design work**, not something this phase solved for
that path.

---

## 2. P0 findings — disposition

| #   | A.33 finding                                                           | Status                                                        | Remediation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Hydra/Kratos/Keto fully ephemeral (`dsn: memory`)                      | **FIXED** (production path)                                   | Dedicated Postgres role+database per service (`infrastructure/docker/postgres/init/01-roles-and-cdc.sql`); production DSN supplied via k8s Secret + Ory's native env-var config override (`infrastructure/k8s/71-hydra.yaml`, `72-kratos.yaml`, `73-keto.yaml`). Local dev `docker-compose.yml` **unchanged** — still `dsn: memory` by design, per "don't modify local dev unnecessarily."                                                                                                                                                                                                                                                                         |
| 2   | No production deployment target for Hydra/Kratos/Keto                  | **FIXED**                                                     | New k8s manifests: ConfigMaps, migration Jobs, Deployments, Services for all three (`71/72/73-*.yaml`), public Ingresses for their public APIs only (`74-ingress-identity.yaml`), NetworkPolicy additions. Admin API ports (Hydra 4445, Kratos 4434, Keto 4466/4467) stay cluster-internal.                                                                                                                                                                                                                                                                                                                                                                        |
| 3   | Hardcoded fallback OAuth client secret                                 | **FIXED**                                                     | `apps/admin-web/src/lib/env.ts`'s `requireProdEnv` — `AUTH_CLIENT_SECRET` (and every `localhost`-defaulted URL) throws at import time outside `APP_ENV=local\|development`. No fallback string exists anywhere in the code path outside those two envs.                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4   | No authorization beyond "has a valid JWT"                              | **FIXED**                                                     | `middleware.ts` now maps every route to a minimum role tier (`viewer`/`operator`/`admin`, reusing the existing `roles` JWT claim — no new claim shape) and redirects insufficient-role requests to `/forbidden`. Deny-by-default for unlisted routes. 12 new tests (`middleware.test.ts`) cover unauthenticated→redirect, expired-token→redirect, viewer-denied-on-admin-route, operator-denied-on-admin-route, admin-full-access, unrecognized-role→denied, unlisted-route→denied, and the `/forbidden` redirect-loop guard.                                                                                                                                      |
| 5   | Session cookies missing `Secure`                                       | **FIXED**                                                     | All three admin-web cookies (`lumo_admin_session`, `lumo_oauth_state`, `lumo_return_to`) now set `secure: true` unconditionally, in `middleware.ts` and `auth/callback/route.ts`. Works over `http://localhost` too — modern browsers treat `localhost` as a secure context.                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | `localhost` port-blindness login bridge has no cross-domain equivalent | **PARTIALLY FIXED**                                           | Added the actual mechanism cross-domain deployment needs: `COOKIE_DOMAIN` (admin-web) and `SESSION_COOKIE_DOMAIN` (Kratos) both scope to a shared parent domain (e.g. `.lumo.example.com`) when set — documented in `kratos.yml`'s own comment and `docs/operations/ADMIN_WEB_ENVIRONMENT_CONTRACT.md`. **Still requires** the real production domains to share a registrable parent; if they can't, the login flow needs a different mechanism entirely, which is out of this phase's "no redesign" scope. Graded partial because the fix is real but conditional on a domain decision this phase can't make (Task 17 — no real domains exist to decide against). |
| 7   | No startup env validation                                              | **FIXED**                                                     | Same `lib/env.ts` as #3, applied to every `localhost`-defaulted var: `HYDRA_PUBLIC_URL`, `HYDRA_ADMIN_URL`, `KRATOS_PUBLIC_URL`, `AUTH_ISSUER_URL`, `AUTH_JWKS_URL`, `RUNTIME_API_URL`, `TENANT_DEFAULT_ID`, plus the `login/page.tsx` Host-header fallback (now throws outside local/dev instead of guessing `localhost:3100`).                                                                                                                                                                                                                                                                                                                                   |
| 8   | Weak/default credentials checked into Docker config                    | **ACCEPTED RISK (local dev, unchanged) / FIXED (production)** | Local `docker-compose.yml` placeholders (Postgres `lumo/lumo`, etc.) are untouched, per instruction — they're already consistently labeled dev-only (A.33's own finding). Production path uses k8s Secrets with `REPLACE_ME__` placeholders only (`secret.example.yaml`), never applied by kustomize, provisioned out-of-band.                                                                                                                                                                                                                                                                                                                                     |
| 9   | Kratos `bcrypt.cost: 8`                                                | **FIXED**                                                     | Raised to 12 (OWASP floor) in `kratos.yml` — applies everywhere, including local dev (negligible cost, no reason to keep a weak default anywhere).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 10  | No production OAuth client registration path                           | **FIXED**                                                     | `scripts/ops/register-oauth-client.mjs` — no defaults, refuses to run without every required var, verifies (doesn't silently overwrite) an already-registered client unless `OAUTH_CLIENT_ROTATE=true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 3. P1 findings — disposition

| #   | A.33 finding                                           | Status                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Stale hardcoded `CURRENT_USER = "Abdullah Nabil"`      | **FIXED**                                         | All 15 occurrences replaced with `getCurrentUser()` (`lib/auth/current-user.ts`), reading the real session. `name` is the identity's email (Kratos's schema has no separate display-name trait — email is the only real value available, never invented). `role` is derived from the JWT `roles` claim via the same role-rank logic middleware uses.                                                                                                       |
| 2   | Dashboard KPIs permanently fake demo data              | **ALREADY FIXED** (pre-A.34, verified this phase) | `page.tsx`/`dashboard.ts` already gate all fake figures behind `provenance === "demo"` and render **only** the disclosure note + real Recent Orders in that case — no KPI/chart/table numbers render at all. This was closed in Phase A.30/A.31 (`git log`: "stop rendering demo dashboard data"); A.33's own report already noted the disclosure was honest, just didn't credit the fix as complete. Re-verified by reading the current code — confirmed. |
| 3   | Zero security headers                                  | **PARTIALLY FIXED**                               | Added via `next.config.ts`: CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy. CSP's `script-src`/`style-src` include `'unsafe-inline'` — removing it needs per-request nonce wiring (Next.js's hydration payload is an inline `<script>`), which doesn't exist in this app yet. Same tradeoff already accepted for the storefront's Ingress. Tracked as a follow-up, not silently dropped.                          |
| 4   | Zero observability in admin-web                        | **NOT FIXED**                                     | Genuinely out of this phase's scope (time-boxed remediation, not a rewrite). `@platform/observability` is the correct adoption path (same pattern `apps/runtime` uses) — no second system should be invented. Documented here as the exact remaining gap.                                                                                                                                                                                                  |
| 5   | No `error.tsx` anywhere                                | **FIXED**                                         | Root `error.tsx` (client component; reads the locale cookie manually since error boundaries can't use `next/headers`), root `loading.tsx`. `not-found.tsx` already existed and is now wired to the real session too.                                                                                                                                                                                                                                       |
| 6   | No request timeout/`AbortController`                   | **FIXED**                                         | `lib/fetch-with-timeout.ts` (8s default), applied to every external `fetch` in the app — `lib/api/client.ts`, `login/page.tsx`, `consent/page.tsx`, `auth/callback/route.ts`, `logout/route.ts`. Verified zero remaining bare `fetch(` calls outside the wrapper itself.                                                                                                                                                                                   |
| 7   | Logout doesn't revoke Hydra's remembered-login session | **NOT FIXED**                                     | Unchanged, still a documented limitation in `logout/route.ts`'s comment. Out of this phase's P0/high-impact-P1 bar.                                                                                                                                                                                                                                                                                                                                        |
| 8   | No `vercel.json` for admin-web                         | **NOT APPLICABLE** (superseded by §1)             | Deployment-target decision is k8s, not Vercel — a `vercel.json` would only matter if that decision changes.                                                                                                                                                                                                                                                                                                                                                |
| 9   | Doc/reality deployment-target mismatch                 | **FIXED**                                         | Resolved per §1 — admin-web now has a k8s deployment matching the documented architecture instead of no deployment at all.                                                                                                                                                                                                                                                                                                                                 |
| 10  | `.env.example` documentation gaps                      | **PARTIALLY FIXED**                               | Added the new admin-web vars this phase introduced (`COOKIE_DOMAIN`, `COOKIE_SAME_SITE`). The pre-existing ~50 undocumented Security-context vars and `DATABASE_URL_TEST`/`REDIS_URL_TEST` gaps A.33 found are untouched — out of this phase's scope.                                                                                                                                                                                                      |
| 11  | 401/403 collapsed into one outcome                     | **NOT FIXED**                                     | Unchanged; low-priority per A.33's own ranking, out of scope here.                                                                                                                                                                                                                                                                                                                                                                                         |

## 4. P2 findings — disposition

| #   | Finding                                                          | Status                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Dependency version gaps                                          | Not touched — no evidence of urgency (A.33's own conclusion, unchanged).                                                                                                                   |
| 2   | Duplicated JWT-verification logic (`middleware.ts`/`session.ts`) | Not touched — same duplication convention deliberately preserved (see `lib/env.ts`'s own doc comment on why).                                                                              |
| 3   | `output: "standalone"` inert on Vercel                           | **RESOLVED** — no longer inert; `admin-web.Dockerfile` now uses it.                                                                                                                        |
| 4   | Hydra/Kratos config YAML has no env-var templating               | **FIXED** — documented reliance on Ory's native config-path env-var override (`DSN`, `URLS_SELF_ISSUER`, `SERVE_PUBLIC_CORS_ALLOWED_ORIGINS`, etc.), wired through k8s ConfigMaps/Secrets. |
| 5   | Redis/ClickHouse/MinIO managed equivalents                       | Not touched — outside admin-web's own scope.                                                                                                                                               |

---

## 5. Files changed

**New:**

```
apps/admin-web/src/app/api/healthz/route.ts
apps/admin-web/src/app/error.tsx
apps/admin-web/src/app/forbidden/page.tsx
apps/admin-web/src/app/loading.tsx
apps/admin-web/src/lib/env.ts
apps/admin-web/src/lib/env.test.ts
apps/admin-web/src/lib/fetch-with-timeout.ts
apps/admin-web/src/lib/auth/current-user.ts
apps/admin-web/src/middleware.test.ts
docs/operations/ADMIN_WEB_ENVIRONMENT_CONTRACT.md
infrastructure/docker/admin-web.Dockerfile
infrastructure/k8s/71-hydra.yaml
infrastructure/k8s/72-kratos.yaml
infrastructure/k8s/73-keto.yaml
infrastructure/k8s/74-ingress-identity.yaml
infrastructure/k8s/76-admin-web-config.yaml
infrastructure/k8s/77-deployment-admin-web.yaml
scripts/ops/production-check.mjs
scripts/ops/register-oauth-client.mjs
PHASE_A34_PRODUCTION_REMEDIATION_REPORT.md (this file)
```

**Modified (Phase A.34 only):**

```
.env.example
package.json (root — added "production:check" script)
apps/admin-web/next.config.ts
apps/admin-web/src/middleware.ts                        (already existed, untracked from A.32 — rewritten)
apps/admin-web/src/lib/auth/config.ts                    (already existed, untracked from A.32 — extended)
apps/admin-web/src/lib/auth/session.ts                   (already existed, untracked from A.32 — extended)
apps/admin-web/src/lib/auth/session.test.ts               (already existed, untracked from A.32 — extended)
apps/admin-web/src/lib/api/client.ts
apps/admin-web/src/app/login/page.tsx                     (already existed, untracked from A.32 — extended)
apps/admin-web/src/app/auth/callback/route.ts              (already existed, untracked from A.32 — extended)
apps/admin-web/src/app/logout/route.ts                    (already existed, untracked from A.32 — extended)
apps/admin-web/src/app/consent/page.tsx                   (already existed, untracked from A.32 — extended)
apps/admin-web/src/app/{page,not-found,analytics,automations,content,customers,customers/[customerId],
  discounts,integrations,marketing,orders,orders/[orderId],products,products/[productId],settings}/page.tsx
apps/admin-web/src/messages/en.ts
apps/admin-web/src/messages/ar.ts
infrastructure/docker/postgres/init/01-roles-and-cdc.sql
infrastructure/docker/hydra/hydra.yml                     (already existed, untracked from A.32 — extended)
infrastructure/docker/kratos/kratos.yml                   (already existed, untracked from A.32 — extended)
infrastructure/docker/keto/keto.yml                       (already existed, untracked from A.32 — extended)
infrastructure/k8s/30-services.yaml
infrastructure/k8s/40-autoscaling.yaml
infrastructure/k8s/50-networkpolicy.yaml
infrastructure/k8s/60-ingress.yaml
infrastructure/k8s/kustomization.yaml
infrastructure/k8s/secret.example.yaml
```

**Explicitly NOT touched by this phase** (pre-existing Phase A.32 diff, or unrelated concurrent
work already present in the working tree at various points during this session): `apps/admin-web/
package.json`, `apps/admin-web/src/lib/api/orders.test.ts`, `infrastructure/docker/docker-compose.yml`,
`pnpm-lock.yaml`, `apps/admin-web/src/components/**`, `packages/design/**`, `packages/ui/**`,
`PHASE_A32_AUTHENTICATION_RECOVERY_REPORT.md`, `PHASE_A33_PRODUCTION_READINESS_REPORT.md`,
`PHASE_A35_DELETION_MANIFEST.md`, `scripts/dev/**`. These were not reviewed or altered as part of
this phase's own scope.

## 6. Tests added

- `apps/admin-web/src/lib/env.test.ts` — 8 tests: `requireProdEnv` returns the dev default under
  `local`/`development`/unset `APP_ENV`, throws under `production`/`staging` when unset, always
  prefers a real value when set; `optionalEnv` behavior.
- `apps/admin-web/src/middleware.test.ts` — 12 tests covering the full RBAC matrix required by
  Task 18/19: unauthenticated → redirect to Hydra; expired/invalid token → redirect; public routes
  bypass; `/api/healthz` bypasses; viewer allowed on viewer routes; viewer denied (→`/forbidden`)
  on admin routes; operator allowed on operator routes; operator denied on admin routes; admin full
  access across all tiers; unrecognized role denied; unlisted routes deny-by-default; `/forbidden`
  itself reachable by any authenticated session (no redirect loop).
- `apps/admin-web/src/lib/auth/session.test.ts` — extended with 2 new cases (email claim
  propagation, email left `undefined` when absent) + a new `highestRole` describe block (3 cases).

## 7. Validation evidence

All commands run from the current working tree, in order:

| Command                          | Result                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | ✅ "Already up to date," 82 workspace projects                                                                                                                                             |
| `pnpm typecheck`                 | ✅ 78/78 packages (including `admin-web`)                                                                                                                                                  |
| `pnpm lint`                      | ✅ 78/78 packages, 0 errors (one `@next/no-html-link-for-pages` error was found and fixed in `error.tsx` during this pass)                                                                 |
| `pnpm arch`                      | ✅ 0 dependency violations, 1,572 modules, 6,857 dependencies                                                                                                                              |
| `pnpm test`                      | ✅ 78/78 tasks — `admin-web`: 86/86 tests (10 files, including the 2 new suites); `@platform/runtime`: 184/184 tests, same "FAILS CLOSED outside local" pass-not-fail line A.33 documented |
| `pnpm --filter admin-web build`  | ✅ Next.js 15.5.22, 20/20 routes generated (18 existing + `/api/healthz` + `/forbidden`), all dynamic (`ƒ`) as before, middleware bundle 40 kB (was 39.5 kB)                               |

`scripts/ops/production-check.mjs` was manually exercised twice: with no env vars (12 failures
listed, all correct — every required var, every DSN, CORS, all reported); with a complete
production-shaped env (passed, 0 failures, 1 informational warning). Not run as an automated
vitest suite — it's a standalone operational script, verified by direct execution instead.

## 8. Browser golden path (Task 22) — BLOCKED

Docker Desktop's WSL2 backend (`docker-desktop` distro) is `Stopped` despite the Docker Desktop GUI
process running; `docker info`/`docker version` hang indefinitely rather than erroring. This is the
same failure mode recorded in Phase A.12 and A.14 (see project memory) — WSL2 broken at the OS
level in this environment, not a code issue. No live Hydra/Kratos/Keto stack could be brought up,
so the full login→dashboard→logout→re-login→RTL→role-authorization walkthrough could **not** be
executed this phase.

**What this means for the verdict:** every fix above is verified by static analysis, unit tests,
and a successful build — not by an end-to-end browser run. The RBAC logic in particular
(`middleware.test.ts`) is tested against real `NextRequest`/`jose` behavior with `jwtVerify` mocked
at the boundary, which is a meaningful test but not a substitute for watching the actual OAuth2
redirect chain complete against a real Hydra/Kratos.

## 9. Remaining risks (not fixed this phase, carried forward honestly)

1. No live verification of the full auth flow (§8) — highest-priority follow-up once
   Docker/WSL2 is repaired or a real cluster is available.
2. Zero observability in `apps/admin-web` (P1 #4).
3. CSP still needs `'unsafe-inline'` for scripts/styles pending nonce wiring (P1 #3).
4. Logout doesn't revoke Hydra's own remembered-login session (P1 #7).
5. Cross-domain login bridge (P0 #6) is mechanism-complete but unverified against a real
   multi-domain deployment, and depends on an actual domain decision this phase couldn't make.
6. `.env.example`'s pre-existing ~50-var documentation gap (P1 #10) is untouched.

## 10. Production deployment requirements (what an operator still has to do)

1. Decide real domains for `ADMIN_WEB_ORIGIN`/`AUTH_ORIGIN`/`IDENTITY_ORIGIN`, sharing a
   registrable parent domain (§2, P0 #6). Update the `*.lumo.example.com` placeholders throughout
   `infrastructure/k8s/71-74-*.yaml` and `76-admin-web-config.yaml` to match.
2. Provision real Postgres roles/databases for `hydra`/`kratos`/`keto` (the init script is ready;
   apply it to the real cluster) and populate `lumo-{hydra,kratos,keto}-secrets` with real DSNs.
3. Generate real `SECRETS_SYSTEM`/`SECRETS_COOKIE`/`SECRETS_CIPHER`/`AUTH_CLIENT_SECRET` values
   (`openssl rand -hex 32`) into the secret manager — never the committed dev placeholders.
4. Build and push `lumo-admin-web` and confirm the three identity images against a real registry;
   update the `:local` image tags in the Deployments to real, pinned tags/digests.
5. Run `71/72/73-*.yaml`'s migration Jobs once before the Deployments come up (first install only).
6. Run `scripts/ops/register-oauth-client.mjs` against the real `HYDRA_ADMIN_URL` to register the
   production OAuth2 client.
7. Provision TLS certs for `admin-web-tls`/`hydra-tls`/`kratos-tls` (cert-manager or external).
8. Run `pnpm production:check` against the compiled real environment before cutover.
9. Complete the browser golden path (§8) against the real deployment before declaring go-live.

## 11. Environment contract

See [`docs/operations/ADMIN_WEB_ENVIRONMENT_CONTRACT.md`](docs/operations/ADMIN_WEB_ENVIRONMENT_CONTRACT.md)
for the full Auth/API/Database/CORS/Observability contract with every var's required-ness and
production value.

## 12. Final security assessment

The five most severe findings from A.33 — ephemeral auth state, no production deployment target,
a hardcoded auth secret fallback, no authorization enforcement, and insecure cookies — are all
closed with working code and tests, not just documentation. The cross-domain login bridge (P0 #6)
has the right mechanism now but is conditional on a real domain decision and unverified end-to-end.
Observability, full CSP hardening, and a handful of lower-priority P1s remain open by explicit,
documented choice rather than oversight.

---

## 13. Verdict

**NOT PRODUCTION READY.**

Exact remaining blockers to a real go-live:

1. **No live verification exists that the OAuth2/OIDC flow actually works end-to-end** — Docker/WSL2
   is down in this environment; this was never executed against a real Hydra/Kratos this phase, only
   unit-tested at the boundary.
2. **No real domains, secrets, or database credentials are provisioned** — every value in the k8s
   manifests is a documented placeholder (`*.lumo.example.com`, `REPLACE_ME__`); Task 10's
   9-item checklist in §10 is entirely outstanding operator work.
3. **Zero observability** in admin-web — an incident in production would be invisible until a user
   reports it.
4. The cross-domain cookie mechanism (P0 #6) is implemented but has never been exercised against
   two real, different hosts.

None of these are "silently accepted" — each is called out above with its exact status. Once
Docker/WSL2 is available, the next session should prioritize: (a) the browser golden path against
the local stack with the new persistence/RBAC/cookie code, then (b) a real staging deployment using
§10's checklist, in that order.

---

**STOP — awaiting explicit approval before any commit, push, or deployment action**, per this
phase's Git Rules. Suggested commit grouping (not executed):

1. `feat(admin-web): fail-closed env validation + RBAC enforcement + secure cross-domain cookies`
   — `lib/env.ts`, `lib/auth/*`, `middleware.ts`, `middleware.test.ts`, `env.test.ts`,
   `auth/callback/route.ts`, `logout/route.ts`, `login/page.tsx`, `consent/page.tsx`,
   `app/forbidden/`, `messages/{en,ar}.ts` (forbidden/error strings), `.env.example`.
2. `feat(admin-web): real session identity across all screens, error/loading boundaries, security headers, request timeouts`
   — all 15 page files, `app/error.tsx`, `app/loading.tsx`, `app/not-found.tsx`,
   `app/api/healthz/`, `lib/fetch-with-timeout.ts`, `lib/api/client.ts`, `next.config.ts`.
3. `feat(infra): production persistence + k8s deployment target for Hydra/Kratos/Keto/admin-web`
   — `infrastructure/docker/{hydra,kratos,keto}/*.yml`, `postgres/init/01-roles-and-cdc.sql`,
   `admin-web.Dockerfile`, `infrastructure/k8s/71-77-*.yaml`, `30/40/50/60-*.yaml`,
   `kustomization.yaml`, `secret.example.yaml`.
4. `chore(ops): production OAuth client registration + production config validation scripts`
   — `scripts/ops/register-oauth-client.mjs`, `scripts/ops/production-check.mjs`, root
   `package.json`.
5. `docs: Phase A.34 production remediation report + environment contract`
   — this file, `docs/operations/ADMIN_WEB_ENVIRONMENT_CONTRACT.md`.
