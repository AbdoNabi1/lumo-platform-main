# Railway deployment — Runtime API + Storefront

> Step (1) of the storefront recovery plan: get the Runtime API actually serving HTTP in a hosted
> environment so the storefront reads live data instead of its Sprint 0.1 fallback text.

This directory holds Railway **config-as-code** files. Railway reads one config file per service,
and the path is set per service in the dashboard (Settings → Config-as-code), because a monorepo
deploying two services cannot share a single root `railway.json`.

| Service       | Config path                                       | Dockerfile                                 |
| ------------- | ------------------------------------------------- | ------------------------------------------ |
| `runtime-api` | `infrastructure/railway/runtime-api.railway.json` | `infrastructure/docker/runtime.Dockerfile` |
| `storefront`  | `infrastructure/railway/storefront.railway.json`  | `infrastructure/docker/web.Dockerfile`     |

Both Dockerfiles expect the **monorepo root** as build context, which is Railway's default.

---

## 1. Why `APP_ENV=local` — read this before deploying

`startApi` (`apps/runtime/src/api.ts:130`) throws unconditionally when `APP_ENV !== "local"`:

```
api: no production MfaProviderResolver is configured. The in-memory reference TOTP
provider (hardcoded validCode) must never answer MFA challenges outside APP_ENV=local (C2-4).
```

Three more guards behind it do the same for the PSP (V-1), Licensing billing (M2-3), and Media
object storage (M2-2). This is deliberate fail-closed design, not a bug — the platform refuses to
advertise production behaviour it does not have.

**Consequence: `APP_ENV=local` is currently the only value that boots.** That is the correct
setting for this deployment, whose stated purpose is verifying that the wired contexts answer HTTP.
It is a **demo/verification environment, not production**, and must be labelled as such. Lifting it
means building a real MFA provider, wiring Stripe, S3, and an Ory Kratos/Keto stack — separate work.

`APP_ENV=local` also relaxes two things that would otherwise block boot:

- `KETO_READ_URL` unset ⇒ permissive `accessControl` (`composition.ts:168`). Admin routes are
  therefore **unauthorized-by-default in this environment** — do not expose admin paths publicly.
- `KETO_WRITE_URL` / `KRATOS_PUBLIC_URL` / `KRATOS_ADMIN_URL` are not required (`config.ts:187`).

## 2. Infrastructure the API actually needs

Only two backing services. Kafka and Temporal are **not** required by the `api` entrypoint —
`createKafkaClient` is lazy (`composition.ts:137`) and consumers live in `worker.ts`, which this
deployment does not run.

- **Postgres** — Railway plugin. Supplies `DATABASE_URL`.
- **Redis** — Railway plugin. Supplies `REDIS_URL`. Used for rate limiting, idempotency, cache.

## 3. Environment variables — `runtime-api` service

Railway injects `PORT` itself; `config.ts` coerces it, and `api.ts` binds `0.0.0.0`.

| Variable            | Value                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`           | `local`                      | §1 — the only value that boots today                                                                                                                                                                                                                                                                                                                                                                                                               |
| `DATABASE_URL`      | `${{Postgres.DATABASE_URL}}` | required, no default                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `DIRECT_URL`        | `${{Postgres.DATABASE_URL}}` | required for `preDeployCommand`'s `prisma migrate deploy` — the Prisma CLI validates `directUrl = env("DIRECT_URL")` (`main.prisma`, Phase A.43) on every invocation, even when it isn't the connection actually used. Railway's own Postgres plugin isn't behind a transaction-mode pooler (unlike the Supabase deployment path in the PHASE_A42/A43 reports), so this is the _same_ value as `DATABASE_URL`, not a distinct pooled/direct split. |
| `REDIS_URL`         | `${{Redis.REDIS_URL}}`       | required, no default                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `AUTH_ISSUER_URL`   | any valid URL                | required unconditionally (`composition.ts:146`) — `JwtVerifier` is constructed at boot but only fetches JWKS when a token is actually verified, which public routes never do                                                                                                                                                                                                                                                                       |
| `AUTH_JWKS_URL`     | any valid URL                | same                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `TENANT_DEFAULT_ID` | `tenant-local`               | must match the seed's `TENANT_ID` (`apps/runtime/src/seed.ts:24`) or the API resolves to an empty tenant                                                                                                                                                                                                                                                                                                                                           |
| `TENANT_MODE`       | `single`                     | `multi` fails closed at boot (`composition.ts:120`)                                                                                                                                                                                                                                                                                                                                                                                                |

Leave every other variable unset — each optional group (S3, Stripe, KMS, HSM, threat feeds, OTel,
tracking ingest) fails closed if half-configured.

## 4. Environment variables — `storefront` service

| Variable            | Value                                                     |
| ------------------- | --------------------------------------------------------- |
| `RUNTIME_API_URL`   | the `runtime-api` service's public URL, no trailing slash |
| `TENANT_DEFAULT_ID` | `tenant-local`                                            |

`runtime-api.ts` sends `TENANT_DEFAULT_ID` as the `x-tenant-id` header, so it must match §3.

## 5. Deploy order

1. Create the Postgres and Redis plugins first.
2. Deploy `runtime-api`. Its `preDeployCommand` runs `prisma migrate deploy` (32 migrations,
   `packages/db/prisma/schema/migrations/`). Confirm `/healthz` returns 200 and `/readyz` reports
   both the `postgres` and `redis` probes healthy.
3. **Seed once, manually** — this is deliberately _not_ in `preDeployCommand`, because the seed
   creates a brand/category/products by slug and would fail on the second deploy:

   ```
   cd /app/packages/db && pnpm exec prisma db seed
   ```

   Seeds 3 products, 1 category, 1 collection, published prices, and 100 units of stock each.

4. Verify all five public reads directly before touching the storefront. Each must return flat DTOs
   — if any response contains `props` or `_domainEvents`, the mapping boundary (§6b) has regressed:

   ```
   for p in products categories collections prices inventory; do
     curl -sS -H 'x-tenant-id: tenant-local' "https://<runtime-api-url>/api/v1/public/$p"
   done
   ```

5. Set `RUNTIME_API_URL` on `storefront` and redeploy.

## 6. Two blockers found while preparing this deploy — both now fixed

Neither would have surfaced until the storefront was pointed at a live API, and both are closed in
`apps/admin/src/http/public-catalog-routes.ts` with a regression suite in
`public-catalog-routes.test.ts`.

**a. `/public/collections` did not exist.** `apps/storefront/src/lib/runtime-api.ts:91` had been
calling it since Phase 8.1; `publicCatalogRoutes` defined only four routes. `fetchList` swallows the
404, so the Collections card rendered fallback text permanently. The route is now wired through
`admin.publicReads.collections` — a public _read_ only; Collection still has no guarded write route
anywhere, so Sprint 7.0 §13 stays deferred.

**b. The public routes serialized raw domain aggregates.** Every `list()` use case returns
`Paginated<TAggregate>`. `Entity` holds `props`/`_id` as `protected`, which TypeScript erases at
runtime, so Fastify's `JSON.stringify` wrote the aggregate's internals to anonymous callers.
Verified output before the fix:

```json
{
  "items": [
    {
      "props": {
        "name": "Featured Toys",
        "slug": { "props": { "value": "featured-toys" } },
        "status": "draft",
        "productIds": [],
        "deleted": false
      },
      "_id": { "props": "01J..." },
      "_domainEvents": { "events": [{ "eventId": "evt-1", "eventName": "collection.created" }] },
      "_version": 0
    }
  ]
}
```

That leaked the unpublished domain-event stream, the optimistic-lock version, and the soft-delete
flag on an unauthenticated endpoint — and buried every real field under `props`, so the storefront's
`product.variants[0]` would have thrown and 500-ed the home page on first contact with live data.
Each route now projects through an explicit, primitive-only DTO. `cost` (merchant margin) and
`reservations` (other customers' in-flight carts) are deliberately withheld.

## 7. CLI

`@railway/cli` v5.30.4 is installed globally. `railway login` opens a browser and must be run
interactively — from your own terminal, not from an agent session:

```bash
railway login
```

Then, from the repo root:

```bash
railway link
```

`railway up` deploys the linked service; `railway variables --set 'KEY=value'` sets env vars;
`railway run <cmd>` executes a one-off command (use it for the manual seed in §5.3) with the
service's environment injected.
