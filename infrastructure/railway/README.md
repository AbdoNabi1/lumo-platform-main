# Railway deployment — Runtime API + Storefront

> Step (1) of the storefront recovery plan: get the Runtime API actually serving HTTP in a hosted
> environment so the storefront reads live data instead of its Sprint 0.1 fallback text.

This directory holds Railway **config-as-code** files, one per service, because a monorepo
deploying several services cannot describe them all in one file.

**The repository root has a `railway.json`, and it defines the BUILD ONLY — deliberately no
`startCommand`.** Railway "looks for `railway.toml` or `railway.json` files by default"
(config-as-code reference), so every service built from this repo gets the runtime image with no
dashboard field required. It exists because three deploys in a row instead fell back to Railpack and
failed with `No start command detected`.

**Why it must not pin a start command.** Railway: "Configuration defined in code will always
override values from the dashboard." A `startCommand` at the root would therefore beat the start
command set on any individual service, and every service built from this repo would run the API.
That is what happened: the worker service logged `api listening` and consumed nothing, through two
deploys, while its own config file sat unread.

**And the per-service config file cannot fix it any more.** Railway has deprecated config-as-code
("Existing config files keep working until 2026-12-01"), and **"starting 2026-08-28, services that
have never used Config as Code cannot opt in"** — which is every service created from that date,
including that worker. The field is visible in its settings and does nothing.

So what a service runs is decided in this order, and only this order:

1. the **start command set on the service** in its Railway settings — the only per-service lever a
   new service has; or
2. the **image's `CMD`**, which is `node --import tsx src/api.ts`, when no start command is set.

Which makes the API the thing a service runs when nobody says otherwise, and the worker a
deliberate act. `apps/runtime/src/railway-config.test.ts` pins all of it, including that the root
config has no `startCommand` and that the image default is still the API.

The files under `infrastructure/railway/` remain the record of what each service should run; for a
service that can still read one they work as before, and for one that cannot they are the text to
copy into its start-command field.

| Service       | Start command to set on the service | Dockerfile                                 |
| ------------- | ----------------------------------- | ------------------------------------------ |
| `runtime-api` | none — the image default is the API | `infrastructure/docker/runtime.Dockerfile` |
| `worker`      | `node --import tsx src/worker.ts`   | `infrastructure/docker/runtime.Dockerfile` |
| `storefront`  | `node apps/storefront/server.js`    | `infrastructure/docker/web.Dockerfile`     |

The storefront also needs its own Dockerfile, which the root config does not give it — that service
still needs a config file (if it can read one) or its build settings set in the dashboard.

A build log whose first lines are `Railpack` and `No start command detected` means no config was
read at all — with the root `railway.json` present that should no longer happen, so if it does,
check which branch and environment the service builds from before anything else. Railpack's own line
`Found workspace with N packages` names the branch it read: `main` has 82, `morbeh/w0-w17-w12`
has 83.

**`preDeployCommand` has never been observed to run** on this project — the root config carries one
(`prisma migrate deploy`) and three migrations stayed unapplied through several deploys while the
API reported healthy. Treat migrations as a manual step (§8.1) until that is understood.

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

**Once this service has a public domain, that relaxation is reachable by anyone.** Measured against
the live deployment on 2026-10-01, unauthenticated, with nothing but the hostname:

| Path            | Status | What comes back                                                        |
| --------------- | ------ | ---------------------------------------------------------------------- |
| `/openapi.json` | 200    | 244 KB — the entire API surface, every route and schema                |
| `/docs`         | 200    | the Swagger UI over it                                                 |
| `/readyz`       | 503    | the database host and the driver's literal authentication-failure text |
| `/metrics`      | 200    | process memory and request counts                                      |

`/docs`, `/openapi.json` and `/readyz`'s detail are gated on `APP_ENV === "local"`
(`api.ts:552-553`) — the one value that boots — so this deployment cannot have the HTTP surface
without them. `/healthz`, `/readyz` (status only) and `/metrics` are registered unconditionally
(`packages/http/src/server.ts`), so those stay public in every mode.

Treat the domain as the secret: hand it only to people who should see an unfinished API, and do not
put real customer data behind it. G-82.

## 2. Infrastructure the API actually needs

Only two backing services. Kafka and Temporal are **not** required by the `api` entrypoint —
`createKafkaClient` is lazy (`composition.ts:137`) and consumers live in `worker.ts`, which this
deployment does not run.

- **Postgres** — Railway plugin, or an external database. Supplies `DATABASE_URL`.
- **Redis** — Railway plugin. Supplies `REDIS_URL`. Used for rate limiting, idempotency, cache,
  and the worker's single-flight lock. There is **no in-memory fallback**: `REDIS_URL` has no
  default, so a service without it exits at boot with `Invalid runtime configuration`.

**This deployment uses Supabase for Postgres, so there is no Railway Postgres plugin** — but Redis
is still a Railway service to add (New → Database → Redis), whatever the database is. Deploying the
API with neither produced exactly this, on a loop, which is what an unset required variable looks
like:

```
Error: Invalid runtime configuration: DATABASE_URL: Required; REDIS_URL: Required
```

## 3. Environment variables — `runtime-api` service

Railway injects `PORT` itself; `config.ts` coerces it, and `api.ts` binds `0.0.0.0`.

| Variable            | Value                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`           | `local`                      | §1 — the only value that boots today                                                                                                                                                                                                                                                                                                                                                                                                               |
| `DATABASE_URL`      | `${{Postgres.DATABASE_URL}}` | required, no default. **On Supabase** this is that project's connection string instead — its POOLED one (Supabase → Connect → Transaction pooler), which is what an app with many short-lived connections should hold.                                                                                                                                                                                                                             |
| `DIRECT_URL`        | `${{Postgres.DATABASE_URL}}` | required for `preDeployCommand`'s `prisma migrate deploy` — the Prisma CLI validates `directUrl = env("DIRECT_URL")` (`main.prisma`, Phase A.43) on every invocation, even when it isn't the connection actually used. Railway's own Postgres plugin isn't behind a transaction-mode pooler (unlike the Supabase deployment path in the PHASE_A42/A43 reports), so this is the _same_ value as `DATABASE_URL`, not a distinct pooled/direct split. |
| `REDIS_URL`         | `${{Redis.REDIS_URL}}`       | required, no default                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `AUTH_ISSUER_URL`   | any valid URL                | required unconditionally (`composition.ts:146`) — `JwtVerifier` is constructed at boot but only fetches JWKS when a token is actually verified, which public routes never do                                                                                                                                                                                                                                                                       |
| `AUTH_JWKS_URL`     | any valid URL                | same                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `TENANT_DEFAULT_ID` | `tenant-local`               | must match the seed's `TENANT_ID` (`apps/runtime/src/seed.ts:24`) or the API resolves to an empty tenant                                                                                                                                                                                                                                                                                                                                           |
| `TENANT_MODE`       | `single`                     | leave `single`: `multi` is possible, not safe (T10.5 unwritten); the worker refuses it (G-64)                                                                                                                                                                                                                                                                                                                                                      |

`AUTH_ISSUER_URL` and `AUTH_JWKS_URL` are the ones to watch: the schema marks them optional
(`config.ts:70`), so a missing one is NOT reported by the `Invalid runtime configuration` error
above — composition throws separately, one boot later, with "Runtime composition requires
AUTH_ISSUER_URL + AUTH_JWKS_URL". Set all of the table's rows at once rather than chasing one error
per deploy.

**On Supabase, `DIRECT_URL` is NOT the same value as `DATABASE_URL`** (unlike the Railway plugin
described in that row), and it is **NOT the direct connection either** — that is the trap. Use
**Supabase → Connect → Session pooler** (the POOLER host on port 5432, username
`postgres.[PROJECT-REF]`).

Why not the direct connection, which is what Supabase recommends for migrations in general: it is
unreachable from Railway. Supabase's own words — "Direct connections are on IPv6, or on IPv4 if the
project has the IPv4 add-on... If your network is IPv4-only and you don't have the add-on, use
session mode instead." A container here reaches `db.[PROJECT-REF].supabase.co:5432` not at all:

```
Error: P1001: Can't reach database server at `db.[PROJECT-REF].supabase.co:5432`
```

Session mode is the right one anyway: it "supports prepared statements" and behaves like a single
session, which is what `prisma migrate deploy` needs and what transaction mode (port 6543, the
`DATABASE_URL` value) cannot give it. So the two variables differ by PORT on the same pooler host:
6543 for the app, 5432 for migrations.

This failure is silent in the one place it matters: the deploy still proceeded and the API came up
healthy with its migrations unapplied, so a green service is NOT evidence that §8.1's migrations
ran. Verify them with the query in §8.6 rather than assuming.

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

## 8. The worker — the asynchronous half

Everything above runs the **API only**. The platform also writes every business event (an order
paid, a product created, a subscription entering grace) to the `platform.outbox` table in the same
transaction as the change, and a **worker** delivers those rows to the consumers that act on them.
Without a worker none of that happens: the rows accumulate in the outbox and nothing reads them.
Concretely, these do not run today:

| Consumer (topic)                                  | What it does                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `payments.payment_intent.captured.v1`             | marks the order paid; Finance posts the fee entry                         |
| `payments.payment_intent.refunded.v1`             | Finance posts the contra entry                                            |
| `orders.order.paid.v1` (four consumers)           | ledger entry, loyalty points, customer profile, confirmation notification |
| `licensing.subscription.*` (three dunning events) | opens the dunning notification record                                     |
| `platform.usage.recorded.v1`                      | counts usage into Licensing's usage counters (G-79)                       |
| `identity.user.*`, `identity.membership.created`  | principal provisioning — only if `SECURITY_PRINCIPAL_PROVISIONING` is on  |
| `tracking.event.captured.v1`                      | tracking ingest — only if `TRACKING_INGEST_ENABLED` is on                 |

The worker can get the rows to its consumers in one of two ways, chosen by `EVENT_TRANSPORT`:

| `EVENT_TRANSPORT` | Services to add         | What carries the events                                        |
| ----------------- | ----------------------- | -------------------------------------------------------------- |
| `postgres`        | `worker`                | the worker reads the outbox and calls the consumers in-process |
| `kafka` (default) | `redpanda` and `worker` | the worker publishes to Redpanda and consumes from it          |

**Use `postgres` unless there is a reason not to** — §8.2. It runs the same consumers with the same
idempotency and the same dead-letter rows, and needs no broker. The reason is cost, in Railway's
own numbers (pricing page, read 2026-09-30): the Trial plan caps a service at 1 GB RAM and a volume
at 0.5 GB, and usage is billed at $10 per GB of RAM per month. Redpanda here needs `--memory=3G`
plus headroom and a volume (§8.3), so it cannot run on Trial at all and costs roughly $30 a month
or more on Hobby before the worker and API are counted. What `postgres` gives up is listed in §8.7;
none of it matters until there is more than one worker's worth of events.

Do the steps in order: §8.1, then §8.2 **or** §8.3–8.4, then §8.5 and §8.6.

### 8.1 First: the migrations — they apply on the next `runtime-api` deploy

`runtime-api.railway.json`'s `preDeployCommand` runs `prisma migrate deploy` against whatever
`DATABASE_URL` points at. The owner reports this deployment's database is **Supabase**, while §2
and §3 above still describe the Railway Postgres plugin — whichever `DATABASE_URL` is set is the
database that gets migrated, so confirm it before deploying. The next `runtime-api` deploy of a
branch that contains pending migrations APPLIES them. Seven are pending today (created, never
applied): `20260923000000_wp13_merchant_payments`, `20260924000000_wp14_platform_plans`,
`20260924010000_open_payment_provider_registry`, `20260924020000_billing_payment_methods`,
`20260927000000_billing_payment_methods_invoice_ref`, `20260928000000_billing_coupons`,
`20260930000000_outbox_delivery_attempts`. The last one adds the two columns the `postgres`
transport keeps its retry state in; a worker started before it is applied fails on its first poll.

Apply them **deliberately, before the worker's first start** — the worker's consumers read tables
these migrations change. Check which branch Railway deploys `runtime-api` from before merging
anything into it, so this happens when you decide and not as a side effect of a merge.

### 8.2 The worker WITHOUT a broker (`EVENT_TRANSPORT=postgres`)

Create a service from this repo. It builds the same image as `runtime-api` from the root
`railway.json`; what makes it a worker is **one field**:

**Settings → Deploy → start command:**

```
node --import tsx src/worker.ts
```

Set it, and check it after the deploy. Without it the service runs the image default — the API —
and reports itself healthy while consuming nothing; `api listening` in its log instead of
`worker started` is that failure, and it is the one this section gets wrong most often. Do not use
the **Config-as-code** field for this: a service created after 2026-08-28 cannot opt in (see the top
of this file), so `worker.railway.json` is reference text here, not something Railway will read.

Nothing else from that file is needed under this transport: its pre-deploy step provisions Kafka
topics, and there is no broker. Health on `/healthz` comes from the root config.

Variables: the **ten** below — not a copy of everything `runtime-api` has. Each optional group
(S3, Stripe, KMS, HSM, tracking) fails closed when half-configured, so a bulk copy of the API's
environment is a boot failure waiting to happen rather than a shortcut.

| Variable               | Value                  | Why                                                         |
| ---------------------- | ---------------------- | ----------------------------------------------------------- |
| `APP_ENV`              | `local`                | §1 — the only value that boots                              |
| `TENANT_MODE`          | `single`               | never `multi` — the worker refuses it (G-64)                |
| `TENANT_DEFAULT_ID`    | `tenant-local`         | matches the seed                                            |
| `AUTH_ISSUER_URL`      | any valid URL          | composition throws without it, and the error names BOTH     |
| `AUTH_JWKS_URL`        | any valid URL          | the other half of that pair                                 |
| `DATABASE_URL`         | the API's value (§3)   | Supabase transaction pooler, port 6543                      |
| `DIRECT_URL`           | the API's value (§3)   | Supabase SESSION pooler, port 5432                          |
| `REDIS_URL`            | `${{Redis.REDIS_URL}}` | the delivery loop's single-flight lock                      |
| `EVENT_TRANSPORT`      | `postgres`             | deliver from the outbox in-process; start no Kafka consumer |
| `OUTBOX_RELAY_ENABLED` | `true`                 | required with `postgres`, or the config refuses to load     |

`KAFKA_BROKERS` is not needed. `REDIS_URL` still is: the delivery loop takes a Redis lock so two
workers never drain the outbox at once. **Never set `TENANT_MODE=multi`**, and do not set
`TRACKING_INGEST_ENABLED=true` — the collector publishes to a broker, so the config refuses that
combination.

How it behaves (`apps/runtime/src/outbox-delivery-runtime.ts`): every `OUTBOX_RELAY_INTERVAL_MS`
(2 s) the worker takes the pending rows that are due, oldest first, and hands each to every consumer
registered for its topic. A row is marked `published` once all of them have effected it. If one
fails, the row stays `pending` with `attempts` raised and `available_at` set, and is retried on the
same schedule Kafka mode uses — 5 s, 30 s, 2 min, 10 min, 1 h — without holding up the rows behind
it. After the last retry each consumer still failing gets a `platform.dead_letters` row and the
outbox row is marked `published`. A row on a topic no consumer subscribes to is marked `published`
at once.

What was verified and what was not: the delivery loop, the retry schedule and the dead-letter path
are covered by tests that run a real producer's outbox row through the real consumer runtime with
no broker. **It has not been run against a real database or on Railway**; the first deploy is that
test. If the worker logs `outbox delivery failed` on every pass, the message names the cause.

Skip §8.3 and §8.4.

### 8.3 Alternative: the `redpanda` service

Create an empty service from the Docker image **`redpandadata/redpanda:v24.2.7`** (the version the
compose stack pins) and name it exactly `redpanda`: the name is its private DNS name,
`redpanda.railway.internal` (Railway: services are reachable at `SERVICE_NAME.railway.internal`).

- **Volume:** mount one at `/var/lib/redpanda/data`, or every restart loses every topic and message.
- **Start command:** the compose flags (`infrastructure/docker/docker-compose.yml`, `redpanda`
  service), with the addresses changed for Railway's private network and no external listener —
  and written as `rpk redpanda start`, not compose's `redpanda start`. Railway's start command
  "overrides the image's `ENTRYPOINT` in exec form"; compose's `redpanda start` works only through
  that entrypoint, while `rpk redpanda start` is the command Redpanda documents on its own:

  ```
  rpk redpanda start --smp=1 --memory=3G --overprovisioned
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
- **Not verified — check these first if the service will not start or the worker cannot connect:**
  - **Three of the start flags.** Redpanda's `rpk redpanda start` page documents `--kafka-addr`,
    `--advertise-kafka-addr`, `--rpc-addr`, `--advertise-rpc-addr` and `--mode`. `--smp`, `--memory`
    and `--overprovisioned` are not in that page's flag table: they are Seastar options that compose
    passes the same way, understood to be forwarded by `rpk`. Not run. If the service rejects one,
    that is the cause.
  - **Volume permissions.** Railway: "Docker images that run as a non-root UID by default will have
    permissions issues when performing operations within an attached volume", fixed by setting
    `RAILWAY_RUN_UID=0` on the service (Railway docs, volumes). The Redpanda image is understood to
    run as a non-root user; that was not confirmed from Redpanda's docs. If Redpanda cannot write
    `/var/lib/redpanda/data`, set `RAILWAY_RUN_UID=0`.
  - Railway environments created **after 16 Oct 2025** resolve private DNS to IPv4 **and** IPv6;
    **older ("legacy") environments resolve to IPv6 only** (Railway docs, private networking, "how
    it works"). `0.0.0.0` listens on IPv4 only, so in a legacy environment Redpanda must listen on
    IPv6 instead. The exact Redpanda address syntax for that was not verified.
  - Whether Redpanda without `--mode` (fsync on) starts cleanly in a Railway container without its
    host tuners. `--overprovisioned` is set for exactly that reason.
  - The file-descriptor ceiling. The compose stack hit "Refusing to create 6 partitions as total
    partition count 210 would exceed FD limit 204" until it raised `ulimits.nofile`. If topic
    creation fails with `INVALID_PARTITIONS … hardware constraints`, this is the likely cause.

### 8.4 The `worker` service on Kafka

Create a service from this repo, and **set its start command** (Settings → Deploy) to
`node --import tsx src/worker.ts` — see the top of this file for why the config-as-code path field
cannot be used on a service created after 2026-08-28. It builds the same image as `runtime-api` and
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
| `KAFKA_BROKERS`                  | `redpanda.railway.internal:9092` | the private address from §8.3                       |
| `OUTBOX_RELAY_ENABLED`           | `true`                           | the worker relays the outbox — **read §8.5 first**  |
| `KAFKA_TOPIC_PARTITIONS`         | `1`                              | a consumed topic's partitions (others always get 1) |
| `KAFKA_TOPIC_REPLICATION_FACTOR` | `1`                              | one broker                                          |

**Never set `TENANT_MODE=multi`.** Whether the worker boots under `APP_ENV=local` was **not
verified**: it has not been started against a real broker.

### 8.5 Decide about the backlog BEFORE the worker's first start

This applies to **both** transports. The worker delivers **every** `pending` row in
`platform.outbox`, oldest first — including every row written since the relay was switched off (`docs/operations/CLOUD_RUNBOOK.md` §3.3 counted 94
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

### 8.6 Verify

1. The worker's pre-deploy log ends with `topic provisioning skipped` (`postgres`), or with
   `topic provisioning finished` and `failed: 0` (`kafka`).
2. The worker's `/healthz` returns 200, and its log has `worker started` with the `transport` you
   chose.
3. Create a product, then read the `PRODUCT` usage counter
   (`GET /api/v1/usage-counters?tenantRef=<tenant>&resource=PRODUCT` as an authenticated admin,
   with the same `x-tenant-id` header as the §5 checks). It should read
   **1**: the first time G-79's metering runs outside a test.

### 8.7 Known limits

Under `EVENT_TRANSPORT=postgres`:

- **The outbox table is the only copy.** There is no topic to replay from and no `.dlq` topic; a
  dead-lettered message exists only as its `platform.dead_letters` row (which keeps the original
  bytes and headers, but not the stack trace the broker copy would carry).
- **One row at a time.** Delivery is sequential and single-flight across workers, so a second
  worker adds availability, not throughput. If a pass outlives the 60 s lock, a second worker may
  deliver the same rows; the consumers' inbox (`platform.inbox_processed_events`) absorbs that.
- **A consumer added later does not see earlier events** — rows on a topic with no subscriber are
  marked `published` immediately.
- **No tracking ingest.** The collector needs a broker.
- **Nothing prunes the outbox unless the scheduler runs.** Delivered rows are deleted after
  `OUTBOX_RETENTION_DAYS` by `apps/runtime/src/scheduler.ts`, which this guide does not deploy.
- **Switching to `kafka` later** needs no data change: the two columns are ignored by the Kafka
  relay. Rows waiting on a retry at that moment are published to the broker immediately.

Under `EVENT_TRANSPORT=kafka`:

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
