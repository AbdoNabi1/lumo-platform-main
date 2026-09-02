# Sprint 3.0B Report — First Boot & Live Infrastructure Validation

> 2026-07-05. **Outcome: BLOCKED AT STEP 1 — honestly.** Nothing was faked; no validation is
> claimed that did not run.

## What was attempted (with evidence)

1. `Start-Process "Docker Desktop.exe"` → app launched, engine polled every 10s for **8 minutes
   total** → `docker info` never connected (`npipe .../dockerDesktopLinuxEngine` absent).
2. Diagnostics: **WSL2 healthy**, default distribution `docker-desktop` present (Docker Desktop
   HAS been initialized on this machine before); **zero docker processes resident** after launch
   — the app exits immediately under headless start.
3. `Start-Service com.docker.service` → **access denied** (service ACL requires elevation).

**Root cause:** Docker Desktop on this machine requires an interactive GUI session action
(first-run/update/EULA dialog or UAC elevation) before its backend starts. That action cannot
be performed from this non-interactive session, and forcing elevation would be out of bounds.

## Blocked gates (the complete honest list)

Compose stack start · service health validation · `prisma migrate deploy` (first real run of the
offline-bootstrapped migration) · outbox publication + Debezium connector registration · topic/
retry/DLQ verification · Ory + Temporal container addition & configuration · Keto tuple seeding ·
all nine gated integration suites (Prisma/orders, Redis, Storage, Kafka, plus live Ory/Temporal/
runtime-process checks) · end-to-end purchase-event round-trip.

## Scope truths (so no one expects these from first boot)

The requested verifications for **website purchase UI, GA4/GTM/Meta/TikTok/Snap/Merchant
Center/Looker, UTMs/attribution/DataLayer/server-side tracking, email/WhatsApp sends** cannot be
validated because those subsystems are **designed but unbuilt** (docs 08–10, 16–19; storefront =
walking skeleton; notifications = seam only). This is roadmap fact, not regression. Similarly,
the "Reservation Ledger" step is ADR-0013 design awaiting its implementation sprint, and the
saga awaits G-40.

## What WAS validated this sprint (offline, real)

All build-time gates re-confirmed: lint/typecheck/test/build **121/121** ✅ · dependency-cruiser
**0 violations (449 modules)** ✅ · `docker compose config` remains valid (client-side).

## Operator unblock runbook (one-time, ~5 minutes of human action)

1. Open **Docker Desktop from the Start Menu** in the interactive session; accept any
   update/EULA/elevation dialog; wait for "Engine running".
2. Then, in any terminal at the repo root, execute `infrastructure/docker/README.md` §Start
   (compose up → healthy → `pnpm --filter @platform/db db:migrate:deploy` → publication ALTER →
   `register-connector.sh`), add Kratos/Keto/Temporal services (first-live-session addendum,
   D-048/D-049), seed Keto tuples, then run the gated suites:
   `DATABASE_URL_TEST=… REDIS_URL_TEST=… KAFKA_BROKERS_TEST=… STORAGE_TEST_BUCKET=… pnpm test`.
3. Re-run this sprint (3.0B) — every step above is scripted or documented and needs no new code.

## Gap register

G-41 updated (not closed): diagnosis attached — _operator GUI action required_; everything
downstream of the engine is prepared. No new architectural decisions arose (no ADR needed).

## Retry attempt #2 (same day) — engine unstable

Timeline with evidence:

1. Operator started Docker Desktop interactively → `docker info` SUCCEEDED (`ENGINE: 29.5.3 |
Docker Desktop`) and `docker compose config` validated. **The CLI path works.**
2. `docker compose up -d` (17 services, first-time pulls) → the engine pipe VANISHED mid-command
   (`unable to get image 'debezium/connect:2.7' … pipe not found`); all docker processes gone.
3. Two relaunches + ~5 min of polling → non-resident both times (matches attempt #1: headless
   starts don't survive on this machine).

**Diagnosis:** Docker Desktop is crashing — most likely WSL2 VM resource pressure under the
first multi-image pull, or an update/restart loop. This is a workstation-stability issue, not a
platform issue: the stack definition validated, and the engine accepted commands while alive.

**Hardened operator runbook (attempt #3):**

1. `wsl --shutdown`, then start Docker Desktop from the Start Menu and WAIT until it shows
   "Engine running" for at least 2 minutes.
2. Docker Desktop → Settings → Resources (WSL): allocate ≥ 6–8 GB RAM / 4 CPUs; disable
   "Start Docker Desktop when you sign in" update prompts mid-session.
3. Pre-pull in the operator's own terminal (keeps the GUI session foreground):
   `docker compose -f infrastructure/docker/docker-compose.yml pull`
4. Then `up -d` in small batches (data plane → messaging → observability → tools), or re-invoke
   Sprint 3.0B — from a stable engine, every remaining step is scripted.

Status: **still blocked-on-operator (G-41)** — now specifically on engine _stability_, not
first-run. Nothing downstream was claimed; nothing was faked.

## First Boot — MAJOR PROGRESS (2026-07-06, Docker stable this session)

Docker survived a full working session. First Boot advanced through the infrastructure layer;
three distinct root causes found and fixed with live evidence, one new blocker diagnosed.

### Steps PASSED (with proof)

1–2. Engine stable; `docker compose config` valid.
3–5. Full stack up; 16 infra containers healthy (postgres/redis/redpanda/apicurio/clickhouse/
minio/grafana/prometheus/loki/tempo/mailpit/pgadmin/redisinsight/otel/console + debezium). 6. **`prisma migrate deploy` SUCCEEDED** — `1 migration found` (proves the multi-file-schema
migrations-location fix `3afe0c5`); `20260704000000_init` applied.
7–8. Schema verified: all 10 Postgres schemas; `platform.outbox`, `platform.inbox_processed_events`,
`orders.orders`, `payments.payment_intents` present. 9. CDC publication: `ALTER PUBLICATION lumo_outbox ADD TABLE platform.outbox` OK; slot `lumo_outbox`
(pgoutput) exists. 10. Debezium connector `lumo-outbox` registered → **connector.state=RUNNING, task[0]=RUNNING**.

### Root causes fixed live (commit `3f2520e`)

- **Redpanda memory:** `--memory=1G` + ~240 deliberate partitions (ADR-0004) exhausted the
  4 MiB/partition budget → `_connect.offsets` (25 partitions) could not be created. Raised to
  `--memory=2G`. Verified: offsets topic created; data preserved. (The explicitly-requested fix.)
- **Connect internal-topic policy:** the `_connect.*` topics auto-created by the failed boots had
  `cleanup.policy=delete`; Connect requires `compact` → herder ConfigException crash. Deleted the
  malformed leftovers (empty, no connector) → recreated `compact`; herder stable. `bootstrap-topics.sh`
  now pre-creates them compact so it cannot recur.
- **Prisma migrations location** (`3afe0c5`, prior): moved to `prisma/schema/migrations` — proven by step 6.

### NEW BLOCKER — G-42 (diagnosed, not worked around)

`prisma migrate deploy` + connector RUNNING, but the replication slot is `active=f` and an inserted
outbox row does NOT reach its topic. Debezium log root cause:
`org.apache.kafka.connect.errors.DataException: Invalid schema type for ByteArrayConverter: STRUCT`
→ `Tolerance exceeded in error handler` → `Finished streaming` (stream closes, slot goes inactive).
The outbox EventRouter transform (`table.field.event.payload=payload`, `value.converter=ByteArrayConverter`,
`table.expand.json.payload=false`) is handing a STRUCT to the ByteArrayConverter instead of the raw
`payload` bytea. This is a connector serialization-config issue in
`infrastructure/docker/debezium/outbox-connector.json` — the next infrastructure fix. It must NOT
change the byte-identical envelope rule (doc 26 §3 / ADR-0004); the fix is aligning the EventRouter
payload extraction with the converter so the message value is exactly the stored envelope bytes.
Steps 11 (CDC end-to-end proof) → 25 remain blocked behind G-42.

## G-42 RESOLVED (2026-07-06)

Root cause (official Debezium docs): `ByteArrayConverter` is the MongoDB-outbox converter; the PostgreSQL connector with a `bytea` payload column must use `io.debezium.converters.BinaryDataConverter` (with a JSON delegate) to pass the payload bytes as-is. Smallest fix = swap `value.converter` in `outbox-connector.json` (+ delegate). Proven end-to-end: replication slot `active=t` (was f); an inserted outbox row is consumed on `orders.order.placed.v1` with a BYTE-IDENTICAL payload and the correct routing key; EventRouter/key.converter/column/infra untouched. Steps 11-25 unblocked.
