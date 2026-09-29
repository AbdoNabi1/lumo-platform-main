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
| `TENANT_MODE`       | `single`                     | leave `single`: `multi` is possible, not safe (T10.5 unwritten); the worker refuses it (G-64)                                                                                                                                                                                                                                                                                                                                                      |

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

## 8. Kafka (Redpanda) and the worker — the asynchronous half

Everything above runs the **API only**. The platform also writes every business event (an order
paid, a product created, a subscription entering grace) to the `platform.outbox` table in the same
transaction as the change, and a **worker** relays those rows to Kafka and runs the consumers that
act on them. Without a broker and a worker none of that happens: the rows accumulate in the outbox
and nothing reads them. Concretely, these do not run today:

| Consumer (topic)                                  | What it does                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `payments.payment_intent.captured.v1`             | marks the order paid; Finance posts the fee entry                         |
| `payments.payment_intent.refunded.v1`             | Finance posts the contra entry                                            |
| `orders.order.paid.v1` (four consumers)           | ledger entry, loyalty points, customer profile, confirmation notification |
| `licensing.subscription.*` (three dunning events) | opens the dunning notification record                                     |
| `platform.usage.recorded.v1`                      | counts usage into Licensing's usage counters (G-79)                       |
| `identity.user.*`, `identity.membership.created`  | principal provisioning — only if `SECURITY_PRINCIPAL_PROVISIONING` is on  |
| `tracking.event.captured.v1`                      | tracking ingest — only if `TRACKING_INGEST_ENABLED` is on                 |

This section adds two Railway services, **`redpanda`** and **`worker`**. Do the steps in order.

### 8.1 First: the migrations — they apply on the next `runtime-api` deploy

`runtime-api.railway.json`'s `preDeployCommand` runs `prisma migrate deploy` against whatever
`DATABASE_URL` points at — **for this deployment, Supabase**. So the next `runtime-api` deploy of a
branch that contains pending migrations APPLIES them. Six are pending today (created, never
applied): `20260923000000_wp13_merchant_payments`, `20260924000000_wp14_platform_plans`,
`20260924010000_open_payment_provider_registry`, `20260924020000_billing_payment_methods`,
`20260927000000_billing_payment_methods_invoice_ref`, `20260928000000_billing_coupons`.

Apply them **deliberately, before the worker's first start** — the worker's consumers read tables
these migrations change. Check which branch Railway deploys `runtime-api` from before merging
anything into it, so this happens when you decide and not as a side effect of a merge.

### 8.2 The `redpanda` service

Create an empty service from the Docker image **`redpandadata/redpanda:v24.2.7`** (the version the
compose stack pins) and name it exactly `redpanda`: the name is its private DNS name,
`redpanda.railway.internal` (Railway: services are reachable at `SERVICE_NAME.railway.internal`).

- **Volume:** mount one at `/var/lib/redpanda/data`, or every restart loses every topic and message.
- **Start command:** the compose flags (`infrastructure/docker/docker-compose.yml`, `redpanda`
  service), with the addresses changed for Railway's private network and no external listener:

  ```
  redpanda start --smp=1 --memory=3G --overprovisioned
    --kafka-addr=internal://0.0.0.0:9092
    --advertise-kafka-addr=internal://redpanda.railway.internal:9092
    --rpc-addr=0.0.0.0:33145
    --advertise-rpc-addr=redpanda.railway.internal:33145
  ```

- **Memory:** `--memory=3G` is not arbitrary. Redpanda reserves ~4 MiB per partition
  (`topic_memory_per_partition`, recorded live in the compose file's comment), and the platform
  needs 430 topics, which is 430 partitions at the Railway default of 1 each, about 1.7 GiB before
  any data. Give the service more RAM than `--memory`: Redpanda needs headroom beyond its own
  allocation.
- **Do NOT copy compose's `--mode=dev-container`** unless losing events is acceptable. Redpanda's
  own documentation says development mode "Bypasses `fsync` … which results in unrealistically
  fast clusters and may result in data loss." An event the relay has marked published and Redpanda
  then loses is gone for good — ledger postings included.
- **Not verified — check these first if the worker cannot connect:**
  - Railway environments created **after 16 Oct 2025** resolve private DNS to IPv4 **and** IPv6;
    **older ("legacy") environments resolve to IPv6 only** (Railway docs, private networking, "how
    it works"). `0.0.0.0` listens on IPv4 only, so in a legacy environment Redpanda must listen on
    IPv6 instead. The exact Redpanda address syntax for that was not verified.
  - Whether Redpanda without `--mode` (fsync on) starts cleanly in a Railway container without its
    host tuners. `--overprovisioned` is set for exactly that reason.
  - The file-descriptor ceiling. The compose stack hit "Refusing to create 6 partitions as total
    partition count 210 would exceed FD limit 204" until it raised `ulimits.nofile`. If topic
    creation fails with `INVALID_PARTITIONS … hardware constraints`, this is the likely cause.

### 8.3 The `worker` service

Create a service from this repo with the config-as-code path
**`infrastructure/railway/worker.railway.json`**. It builds the same image as `runtime-api` and
differs only in what it runs:

- **Pre-deploy:** `provision-topics.ts` creates every topic the platform needs, from the one
  inventory in `apps/runtime/src/kafka-topics/topic-inventory.ts`. It is idempotent, logs each
  created or failed topic, and **exits non-zero if any topic could not be created**, which on
  Railway blocks the deploy. Railway: "If your command fails, it will not be retried and the
  deployment will not proceed"; pre-deploy commands "execute within your private network and have
  access to your application's environment variables."
- **Start:** `node --import tsx src/worker.ts`; health on `/healthz`.

Variables: **everything `runtime-api` has** (§3: `APP_ENV`, `DATABASE_URL`, `DIRECT_URL`,
`REDIS_URL`, and the rest), plus:

| Variable                         | Value                            | Why                                                 |
| -------------------------------- | -------------------------------- | --------------------------------------------------- |
| `KAFKA_BROKERS`                  | `redpanda.railway.internal:9092` | the private address from §8.2                       |
| `OUTBOX_RELAY_ENABLED`           | `true`                           | the worker relays the outbox — **read §8.4 first**  |
| `KAFKA_TOPIC_PARTITIONS`         | `1`                              | a consumed topic's partitions (others always get 1) |
| `KAFKA_TOPIC_REPLICATION_FACTOR` | `1`                              | one broker                                          |

**Never set `TENANT_MODE=multi`.** Whether the worker boots under `APP_ENV=local` was **not
verified**: it has not been started against a real broker.

### 8.4 Decide about the backlog BEFORE the worker's first start

The relay publishes **every** `pending` row in `platform.outbox`, oldest first — including every
row written since the relay was switched off (`docs/operations/CLOUD_RUNBOOK.md` §3.3 counted 94
then). The consumers in the table above then act on events that may be weeks old: ledger postings,
loyalty points, notifications. Look first (read-only):

```sql
SELECT topic, count(*) FROM platform.outbox WHERE status = 'pending' GROUP BY topic ORDER BY 2 DESC;
```

Then choose. **Replay:** start the worker as is. **Skip:** mark the backlog published before the
first start, so it is never delivered:

```sql
UPDATE platform.outbox SET status = 'published', published_at = now() WHERE status = 'pending';
```

Skipping cannot be undone in effect: those events will never reach a consumer. Nothing in this repo
makes this choice for you.

### 8.5 Verify

1. The worker's pre-deploy log ends with `topic provisioning finished` and `failed: 0`.
2. The worker's `/healthz` returns 200.
3. Create a product, then read the `PRODUCT` usage counter
   (`GET /api/v1/usage-counters?tenantRef=<tenant>&resource=PRODUCT`, as an admin). It should read
   **1**: the first time G-79's metering runs outside a test.

### 8.6 Known limits

- **A type emitted outside its context's list still stalls the relay.** The inventory is exactly as
  complete as each context's `*_PUBLISHED_EVENTS` list. Licensing, Finance and Media are pinned to
  what their translators emit; the other contexts' lists are hand-kept (G-80). The symptom is the
  worker logging `outbox relay failed` on every pass while `pending` rows stop draining. Find the
  oldest pending row's `topic` in `platform.outbox`, add that type to its context's list, then
  redeploy the worker so its pre-deploy provisions it.
- **No SASL/TLS.** `createKafkaClient` (`packages/kafka/src/index.ts`) passes only `clientId`,
  `brokers` and `logLevel`. That is fine inside Railway's private network and not enough for a
  managed broker on the internet (Confluent, Redpanda Cloud); using one needs a code change first.
- **The compose stack is separate.** It provisions from `infrastructure/docker/redpanda/topics.manifest`,
  generated from the same inventory (`pnpm --filter @platform/runtime run topics:manifest`).
