# WP-3 — Give the data plane a store: ClickHouse tables, ingestion, and analytics wiring

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** nothing structurally, but is only _useful_ after WP-2 produces events.
> **Conflicts with:** WP-5, WP-6, WP-7, WP-9, WP-10 (all edit `apps/runtime/src/composition.ts`).
> **Closes:** G-44, and the analytics half of G-8. **Unblocks:** WP-4, WP-5, WP-7.

## Why this exists

The analytics layer is real and unusable, because the tables it queries do not exist.

Verify before starting:

```bash
find . -path ./node_modules -prune -o -name '*.sql' -print | grep -v node_modules
grep -rn "ClickHouse\|clickhouse" apps/runtime/src/*.ts
```

The first returns only `infrastructure/docker/postgres/init/01-roles-and-cdc.sql`. The second
returns nothing. Yet:

- `packages/clickhouse` exists (a client + a health check, ~71 lines).
- `CLICKHOUSE_URL` / `_USER` / `_PASSWORD` / `_DATABASE` exist in `.env.example` (lines 65–68).
- `services/analytics/src/infrastructure/clickhouse-analytics-read-store.ts` is a complete,
  SQL-injection-hardened, tenant-scoped `AnalyticsReadStore` — whose own doc comment admits it was
  _"never exercised against a live ClickHouse instance… written to the described shape, not
  integration-verified."_
- `services/finance/src/infrastructure/clickhouse-read-model-store.ts` is a second one.
- `services/analytics` has a full semantic layer above them: metric and dimension catalogs, a
  metric-expression evaluator, a dependency resolver, a query compiler, a semantic query planner
  and validator. `finance-semantics.ts` seeds eight read models (`finance.revenue`, `finance.cogs`,
  `finance.profit`, `finance.expense`, `finance.cash_flow`, `finance.tax`,
  `finance.inventory_cost`, …).

So: engine, adapters, catalog and config all present; **storage and wiring absent.**

Note also that tracking events currently land in **Postgres**, not ClickHouse:
`packages/db/prisma/schema/tracking.prisma` defines `TrackingEventRecord` and
`TrackingEventRevision`, written append-only by
`apps/runtime/src/tracking/prisma-event-record-store.ts`. That store is a **forensic ledger** — read
its doc comment; it exists to reconstruct any single event's history, and it is the right tool for
that. It is the wrong tool for analytical aggregation over millions of rows. Both should exist.
**Do not delete or replace the Postgres ledger.**

## Scope

1. A migration mechanism for ClickHouse (none exists — this is the piece with a real design choice
   in it).
2. The event table and the read-model tables the semantic layer already names.
3. A consumer that writes tracking events into ClickHouse.
4. Wiring both ClickHouse-backed stores into `apps/runtime`.
5. Honest health reporting when ClickHouse is absent.

## Tasks

- [ ] **T3.1 — Read the consumers of the schema before designing the schema.**
      In this order: `services/analytics/src/domain/ports.ts` (`AnalyticsReadStore`,
      `AnalyticsReadStoreFetchParams` — this is the exact query shape the tables must serve);
      `services/analytics/src/infrastructure/clickhouse-analytics-read-store.ts` (how it maps a
      canonical read-model id to a physical table: `.` → `_` by default);
      `services/analytics/src/infrastructure/finance-semantics.ts` (the eight seeded read models
      and their exact field lists); `services/analytics/src/domain/read-model-descriptor.ts`;
      `services/finance/src/infrastructure/clickhouse-read-model-store.ts`;
      `packages/tracking/src/envelope/envelope.ts` (the event shape you are storing).
      The table names and columns are **already decided** by these files. You are implementing a
      schema that exists as a contract; you are not inventing one.

- [ ] **T3.2 — Choose and build the ClickHouse migration mechanism.**
      There is no precedent in this repo, so this is a real decision — make it, write it down as a
      short ADR in `docs/architecture/` following the numbering and format of the existing ADRs,
      and record it in `docs/DECISIONS.md`.
      Constraints that narrow the choice: migrations must be ordered, idempotent, runnable from CI
      and from a container entrypoint, and reviewable as plain SQL. Prisma does not support
      ClickHouse, so this is separate from `packages/db/prisma/schema/migrations/` — mirror its
      _conventions_ (timestamped directory names, one `migration.sql` each) rather than inventing
      new ones. Put them under `packages/clickhouse/migrations/` and add a small runner script plus
      a `pnpm` script to invoke it. Add the runner to
      `infrastructure/docker/docker-compose.yml`'s bootstrap in the same style the existing MinIO
      bucket bootstrap and Redpanda topic bootstrap already use — read those first and copy them.

- [ ] **T3.3 — The events table.**
      One wide table for tracking events, tenant-first in the sort key. Mandatory properties:

      - `tenant_id` is the **first** sort-key column and appears in every query predicate. Tenant
                isolation is ADR-0008 and it is not optional; a query that can omit `tenant_id` is a bug.
              - Partition by month on the event timestamp, so retention is a partition drop.
              - `MergeTree` family; pick the specific engine deliberately and justify it in the ADR.
                Deduplication matters here — see the `dedupId` note in
                `packages/tracking/src/runtime/ingest-runtime.ts:20`, because WP-2 emits `purchase` from
                the server and may later also emit it from the browser.
              - Columns for the envelope's context blocks (page, identity, session, technical,
                attribution) as typed columns, not one JSON blob — the whole point is that attribution and
                funnel queries filter on `utm_source`, `sessionId`, `deviceType` and click-ids. Keep
                `properties` as a JSON/Map column for the open-ended tail.
              - Money in **minor units, integer**. Never a float. See
                `packages/tracking/src/definitions/transformation-metadata.ts` for the incident this rule
                comes from.
              - A retention TTL, driven by a documented value rather than hardcoded — check
                `docs/operations/` for an existing retention policy first and follow it if one exists.

- [ ] **T3.4 — The read-model tables.**
      Create exactly the tables `finance-semantics.ts` names, with exactly the fields it binds to.
      Populate them. There are two honest options and you must pick one and say which in the ADR:
      (a) ClickHouse materialised views over the events table where the metric is derivable from
      events, or (b) a projection consumer fed by the CDC/outbox stream for metrics that come from
      transactional Postgres data (revenue, COGS, tax — these do **not** come from browser events).
      Most of `finance.*` is (b). Do not fabricate revenue from tracking events; the order and
      payment contexts are the source of truth for money, and
      `docs/plans/README.md`'s rule 3 ("never trust a client-supplied amount") applies with full
      force to an event a browser sent.

- [ ] **T3.5 — The ingestion consumer.**
      A consumer of `TRACKING_CAPTURED_TOPIC` that writes to the events table, registered the same
      way the existing consumers in `apps/runtime/src/consumers/` are. Requirements:

      - **Batch inserts.** ClickHouse degrades badly on single-row inserts. Buffer and flush on
                size or interval.
              - **Idempotent.** Use ADR-0005's `recordIfNew` inbox pattern that `packages/messaging`
                already provides — read how an existing consumer does it and copy.
              - **Never lose an event to a ClickHouse outage.** The retry/DLQ machinery in
                `packages/kafka`'s `KafkaConsumerRuntime` already implements the
                5s→30s→2m→10m→1h→DLQ ladder. Use it; do not write a bespoke retry.

- [ ] **T3.6 — Wire ClickHouse into the runtime.**
      In `apps/runtime/src/composition.ts`, construct the ClickHouse client from the existing
      `CLICKHOUSE_*` config (add them to `apps/runtime/src/config.ts` — **that file is the sole
      `process.env` reader in the runtime**, per its own contract; do not read env anywhere else),
      and inject `ClickHouseAnalyticsReadStore` and `ClickHouseReadModelStore` where the in-memory
      ones are used today.
      Follow the exact pattern `objectStorage` and `paymentProvider` already use in that file
      (read their doc comments at lines ~108–128): a real adapter when configured, the in-memory
      one otherwise, **and a boot refusal in `apps/runtime/src/api.ts` outside `local` while it is
      still the stub.** That refusal is the house pattern for "we will not pretend in production"
      and it applies here too.
      Register a ClickHouse health check on the `HealthRegistry` — `packages/clickhouse/src/health.ts`
      already has one.

- [ ] **T3.7 — Make the analytics screen honest.**
      `apps/admin-web/src/app/analytics/page.tsx` must show real data when ClickHouse is wired and
      an explicit unavailable state when it is not — never sample numbers. The dashboard's
      per-tile `provenance` mechanism in `apps/admin-web/src/data/dashboard.ts` is the reference
      pattern; read the comment at its line ~106 explaining why tiles were split. **Never flip a
      tile to `"live"` while it still reads sample data.**

- [ ] **T3.8 — Integration test against a real ClickHouse.**
      The existing adapter's doc comment admits it was never run against a live instance. Fix that:
      a test that starts ClickHouse (compose or testcontainer, matching however the repo's other
      integration tests do it — look for `*.integration.test.ts`, e.g.
      `services/notifications/src/infrastructure/prisma-notification-repository.integration.test.ts`),
      applies the migrations, inserts events, and runs a real semantic query end to end. Gate it
      the way the repo already gates integration tests so a developer without Docker is not blocked.

## Definition of done

- [ ] `packages/clickhouse/migrations/` exists with a runner, and running it against an empty
      ClickHouse produces every table the semantic layer names.
- [ ] Events emitted by WP-2 land in ClickHouse and are queryable by tenant.
- [ ] A semantic query for a `finance.*` metric returns real numbers.
- [ ] `apps/runtime` refuses to boot outside `local` with ClickHouse unconfigured, matching the
      existing `objectStorage`/`paymentProvider` guards.
- [ ] The Postgres `TrackingEventRecord` forensic ledger still works and is untouched.
- [ ] An ADR exists recording the migration mechanism and the materialised-view-vs-projection choice.
- [ ] G-44 closed; the analytics half of G-8 closed or narrowed with a note saying what remains.
- [ ] Repo-wide gates green, plus `pnpm arch`.

## Known traps

- **`tenant_id` first, always.** A ClickHouse table whose sort key does not lead with `tenant_id`
  will pass every test in a single-tenant dev environment and leak across tenants the day
  WP-10 lands.
- **The runtime's config contract.** `apps/runtime/src/config.ts` is the only place that reads
  `process.env`. Adding a `process.env.CLICKHOUSE_URL` in a store or a consumer breaks that
  contract silently.
- **Do not put money in a `Float64`.** Minor-unit integers, everywhere.
- **`ClickHouseAnalyticsReadStore` validates identifiers against an allowlist pattern because
  ClickHouse has no parameterised identifiers.** If you add a table whose name does not match
  `^[a-zA-Z_][a-zA-Z0-9_]*$`, queries against it will throw `BusinessRuleError` at runtime and pass
  every unit test. Keep names in that alphabet.
