# Admin Web + Identity Plane — Production Environment Contract

> Phase A.34. Scope: `apps/admin-web` and the Hydra/Kratos/Keto identity plane it depends on
> (`infrastructure/k8s/71-hydra.yaml`, `72-kratos.yaml`, `73-keto.yaml`, `76/77-*-admin-web.yaml`).
> Every var below is validated at request/boot time — see `apps/admin-web/src/lib/env.ts` for
> admin-web's own fail-closed logic, and `scripts/ops/production-check.mjs` for a pre-deploy check
> covering this whole contract. None of these vars have a `localhost`/placeholder fallback usable
> outside `APP_ENV=local|development`.

## Domain placeholders

Every URL below is expressed in terms of three placeholder origins. Real domain names are not
invented here (Task 17) — substitute your actual registered domains, keeping the **shared parent
domain** requirement intact (see Cookies, below).

| Placeholder        | Used for            | Example in this repo's manifests                         |
| ------------------ | ------------------- | -------------------------------------------------------- |
| `ADMIN_WEB_ORIGIN` | admin-web itself    | `https://admin.morbeh.example.com`                       |
| `AUTH_ORIGIN`      | Hydra's public API  | `https://auth.morbeh.example.com`                        |
| `IDENTITY_ORIGIN`  | Kratos's public API | `https://identity.morbeh.example.com`                    |
| `API_ORIGIN`       | Runtime Admin API   | in-cluster only — never public for admin-web's own calls |

`AUTH_ORIGIN`/`IDENTITY_ORIGIN` and `ADMIN_WEB_ORIGIN` **must** share a registrable parent domain
(e.g. all three under `.morbeh.example.com`) — this is what lets Kratos's session cookie and
admin-web's own cookies both carry `Domain=.morbeh.example.com` and reach each other across the
split (A.33 P0 #6). If your real domains can't share a parent, the login bridge in
`login/page.tsx`/`middleware.ts` needs a different mechanism — that redesign is out of this
phase's scope; treat it as an open item until decided.

## Auth (admin-web)

| Var                  | Required outside local/dev           | Value                                                                                                                          |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_ISSUER_URL`    | yes                                  | `https://AUTH_ORIGIN/` — must equal Hydra's `URLS_SELF_ISSUER` exactly                                                         |
| `AUTH_JWKS_URL`      | yes                                  | in-cluster: `http://hydra.morbeh-runtime.svc.cluster.local:4444/.well-known/jwks.json`                                         |
| `AUTH_AUDIENCE`      | no (safe default `morbeh-admin`)     | must match the Hydra client's registered `audience`                                                                            |
| `AUTH_CLIENT_ID`     | no (safe default `morbeh-admin-web`) | must match the Hydra client's `client_id`                                                                                      |
| `AUTH_CLIENT_SECRET` | **yes, no fallback ever**            | from the secret manager; register via `scripts/ops/register-oauth-client.mjs`                                                  |
| `HYDRA_PUBLIC_URL`   | yes                                  | `https://AUTH_ORIGIN` — the browser is redirected here                                                                         |
| `HYDRA_ADMIN_URL`    | yes                                  | in-cluster only: `http://hydra.morbeh-runtime.svc.cluster.local:4445` — **never public**                                       |
| `KRATOS_PUBLIC_URL`  | yes                                  | `https://IDENTITY_ORIGIN` — the browser is redirected here too                                                                 |
| `COOKIE_DOMAIN`      | no (host-only cookie if unset)       | `.morbeh.example.com` — required if Hydra/Kratos are on a sibling subdomain                                                    |
| `COOKIE_SAME_SITE`   | no (default `lax`)                   | `lax`\|`strict`\|`none` — `none` requires an explicit CSRF review (see report)                                                 |
| Logout URI           | —                                    | `https://ADMIN_WEB_ORIGIN/logout` (best-effort Kratos logout; Hydra's own remembered-login session is a documented limitation) |
| Redirect URI         | —                                    | `https://ADMIN_WEB_ORIGIN/auth/callback` — must exactly match the Hydra client's `redirect_uris`                               |

## API

| Var                 | Required outside local/dev | Value                                                                                                                                            |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RUNTIME_API_URL`   | yes                        | in-cluster: `http://runtime-api.morbeh-runtime.svc.cluster.local:3080`                                                                           |
| `TENANT_DEFAULT_ID` | yes                        | `tenant-local` (single-tenant mode, ADR-0008) or the real tenant id                                                                              |
| Timeout             | —                          | 8s, hardcoded in `apps/admin-web/src/lib/fetch-with-timeout.ts` — not env-configurable (no evidence a different value is needed per environment) |

## Database (auth plane persistence)

| Service | DSN source                              | Notes                                                                                        |
| ------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Hydra   | `morbeh-hydra-secrets.DSN` (k8s Secret) | dedicated `hydra` role/database (`infrastructure/docker/postgres/init/01-roles-and-cdc.sql`) |
| Kratos  | `morbeh-kratos-secrets.DSN`             | dedicated `kratos` role/database                                                             |
| Keto    | `morbeh-keto-secrets.DSN`               | dedicated `keto` role/database                                                               |

All three must use `sslmode=require` (or stricter) against the production Postgres cluster. Never
`dsn: memory` outside local dev.

## CORS

| Var                                          | Required outside local/dev | Value                                                                    |
| -------------------------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `SERVE_PUBLIC_CORS_ALLOWED_ORIGINS` (Kratos) | yes                        | exactly `https://ADMIN_WEB_ORIGIN` — never `*`, never a localhost origin |

The Admin API (`apps/runtime`) has no CORS layer by design — the browser never calls it directly
(admin-web forwards the session token server-side, `lib/api/client.ts`). Adding CORS there would
only be needed if that architecture changes.

## Observability

| Var                                                                                               | Status                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_ENABLED`, `OTEL_METRICS_ENABLED` | Exist for `apps/runtime`/`@platform/observability` today. **`apps/admin-web` has none of this instrumented** — see PHASE_A34_PRODUCTION_REMEDIATION_REPORT.md's Observability section for the exact gap and the adoption path (reuse `@platform/observability`, not a second system). |

## Secrets summary (never committed — see `infrastructure/k8s/secret.example.yaml`)

`AUTH_CLIENT_SECRET`, Hydra `SECRETS_SYSTEM`, Kratos `SECRETS_COOKIE`/`SECRETS_CIPHER`, and all
three `DSN`s. Provision via a secret manager / External Secrets Operator / Sealed Secrets — never
`kubectl apply` the example file directly.
