# Phase A.12 — PostgreSQL Capacity & Load Validation Report

**Scope:** Capacity validation only — no redesign, no new technology, no sharding/replicas/caching/partitioning introduced. **Nothing in this phase was committed to git**; all findings are report-only per the task's closing instruction.

**Environment:** Windows 11 host, no reachable PostgreSQL instance. Docker Desktop processes were running but `docker ps` never returned (hung indefinitely). Root-caused to **WSL2 itself being broken at the OS level**: `wsl -d Ubuntu-24.04 -- echo test` returned `Catastrophic failure — Error code: Wsl/Service/E_UNEXPECTED`, and `wsl -l -v` showed both the `docker-desktop` and `Ubuntu-24.04` distributions stuck in `Stopped` state even several minutes after Docker Desktop launch. This is a host-level WSL2 fault, not a project misconfiguration, and is consistent with the same blocker recorded in Phase A.7 and the prior Integration Verification Sprint. **No repair attempt (WSL reinstall, virtualization feature toggling) was made — that is outside this audit's scope and would require separate, explicit authorization.**

Per the task's Critical Rule, this is stated explicitly and is treated as an acceptable, honest result rather than papered over with theoretical claims:

> **Database capacity is not yet certified because production-like PostgreSQL load testing is environment-blocked.**

Everything below is either (a) **verified locally** via static analysis, `pnpm` quality gates, and `prisma validate` (which parses/validates the schema without a live connection), (b) **inferred from code** (query shapes, index definitions, transaction boundaries — high confidence, since this is direct code reading, not guessing), or (c) explicitly marked **not yet verified** where a live PostgreSQL instance would be required.

---

## 1. Executive Summary

The Lumo Platform's PostgreSQL architecture (Prisma over a single logical Postgres instance, 39 bounded-context schemas, tenant-led indexing, optimistic-concurrency version columns) is **structurally sound for its stated scale** based on code review: query shapes are mostly index-covered, the historically risky long-transaction pattern is fixed on the Capture and Refund paths, and no classic N+1 pattern exists on the payment/order/return/webhook critical path.

However, this phase could not produce a single measured throughput, latency, or concurrency number — Task 24's Critical Rule applies in full. On top of the testing gap, static analysis surfaced several **code-verified (not speculative) capacity/reliability risks** that predate and are independent of the missing benchmarks:

1. **Connection pool and timeout configuration is dead code in production.** `DATABASE_POOL_MAX`, `DATABASE_CONNECT_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS` are parsed and validated by `packages/config`, but the actual runtime composition root (`apps/runtime/src/composition.ts:131-134`) constructs the `PrismaClient` with only `{ url, logQueries }`, force-cast via `as` to satisfy the type. Prisma therefore runs with its undocumented internal default pool size (`num_physical_cpus × 2 + 1`) and no statement timeout, regardless of what operators set in the environment.
2. **The A.8 long-transaction fix does not cover `CreatePaymentIntentLifecycle`.** Capture and Refund correctly call the PSP outside any open `$transaction` (verified). Payment-intent creation/authorization (`services/payments/src/application/payment-lifecycle.use-cases.ts:91-104`) makes the Stripe `createIntent` HTTP call **inside** `unitOfWork.run(...)`, reproducing the exact pre-A.8 anti-pattern on a different code path.
3. **`platform.outbox` is effectively unbounded.** The only scheduled retention job filters on `status: 'published'`, but production delivery is via Debezium CDC, which never sets that status (this was already documented as gap C-08; this phase confirms it is still true and flags it as a capacity risk, not just a correctness gap).
4. **Backup/DR, TLS, and RLS are aspirational, not implemented.** `docs/operations/BACKUP_AND_RECOVERY.md` commits to RPO ≤ 5 min / RTO ≤ 30 min via WAL archiving + PITR; the repo's own compose file keeps `archive_mode` off, and Phase A.7 already found this "not represented in repository evidence." No `sslmode` appears in any `DATABASE_URL`. No `CREATE POLICY`/RLS exists in any of the 39 migrations despite tenant isolation being entirely application-layer.

None of these four are new defects invented for this report — items 3 and 4 restate/confirm prior audit findings; items 1 and 2 are new, code-verified findings from this phase.

**Verdict: CONDITIONALLY PRODUCTION READY** (see §25).

---

## 2. PostgreSQL Environment

| Item                                   | Value                                                                                                                                                                       | Source                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| PostgreSQL version (local)             | `postgres:16-alpine`                                                                                                                                                        | `infrastructure/docker/docker-compose.yml:45`                                   |
| PostgreSQL version (prod)              | Unknown — Railway managed plugin, version not pinned in repo                                                                                                                | `infrastructure/railway/README.md`                                              |
| Prisma version                         | 6.19.3                                                                                                                                                                      | `pnpm exec prisma validate` output                                              |
| Prisma schema                          | Multi-file, one file per bounded context, `packages/db/prisma/schema/`                                                                                                      | `main.prisma`                                                                   |
| `DATABASE_URL`                         | Env-injected, no default in code; local example `postgresql://lumo:lumo@localhost:5432/lumo`                                                                                | `.env.example:29`                                                               |
| Connection pooling (documented intent) | PgBouncer transaction mode                                                                                                                                                  | `docs/architecture/15-scalability-and-deployment.md:14`, `client.ts:11` comment |
| Connection pooling (actual)            | **Prisma's built-in pool, unconfigured** (see Executive Summary #1) — no PgBouncer deployment found anywhere in `infrastructure/`                                           | Code read, this phase                                                           |
| Statement/connect timeout              | Validated by config (`DATABASE_CONNECT_TIMEOUT_MS=10000`, `DATABASE_STATEMENT_TIMEOUT_MS=30000`) but **never applied** to the Prisma client                                 | Code read, this phase                                                           |
| Migration strategy                     | `prisma migrate deploy`, 39 migrations, forward-only                                                                                                                        | `infrastructure/railway/README.md:81`, migrations directory                     |
| Local infra                            | Docker Compose (`postgres`, `redis`, `clickhouse`, `minio`, `redpanda`, observability stack)                                                                                | `infrastructure/docker/docker-compose.yml`                                      |
| K8s manifests                          | 15 files in `infrastructure/k8s/` — deployments/autoscaling/ingress/networkpolicy/Debezium; **none define Postgres itself or a backup CronJob**                             | Agent verification, this phase                                                  |
| Terraform/IaC for the DB               | **None found** anywhere in the repo (confirmed by targeted search; corroborated by Phase A.7)                                                                               | This phase                                                                      |
| Production hosting model               | **Managed** — Railway Postgres plugin supplies `DATABASE_URL`; not self-hosted                                                                                              | `infrastructure/railway/README.md:49`                                           |
| TLS                                    | **Not configured anywhere** — no `sslmode` in any `DATABASE_URL`, compose file, or k8s manifest, despite `docs/architecture/14-security.md` asserting "TLS 1.2+ everywhere" | Agent verification, this phase (restates A7 finding F-A7-10)                    |

---

## 3. Current Schema Architecture

38 Postgres schemas (one per bounded context) + `platform` for cross-cutting outbox/inbox/audit, declared in `main.prisma:30`. Universal conventions: `tenant_id` text column + tenant-led indexes on every business table (ADR-0008); `version int` optimistic-concurrency column with `WHERE id = ? AND version = ?` updates; **no cross-context foreign keys** (D-002) — cross-context references are plain unindexed-by-relation text columns (`orderRef`, `customerRef`, etc.); FKs exist only within an aggregate. `prisma validate` confirms the schema is internally consistent (39 migrations, no drift detectable without a live DB to diff against).

---

## 4. High-Growth Tables

Full classification (32+ tables reviewed) is in the appendix-style table below. Two structural risk patterns recur:

- **Append-only `*Attempt` / `Processed*Webhook` tables** per context (retry logs + webhook dedup) — bounded growth rate (proportional to request volume), but several have **no retention/TTL job** of any kind.
- **"Ledger stores a full snapshot per change, not a diff"** — `customer_360`'s `profile_snapshots`/`session_snapshots`/`computed_attribute_snapshots`, and embedded-JSON-array growth on a single mutable row (`notifications.Notification.attempts/history`, `shipping.Shipment.trackingEvents`) — this second pattern grows **row size**, not just row count, which `pg_column_size` cannot be checked against without a live instance.

| Table                                          | Key structure                                                                | JSON/text fields                                    | version?         | Append-only?                     | Growth tier    | Why                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- | ---------------- | -------------------------------- | -------------- | -------------------------------------------------------------- |
| payments.payment_intents                       | UUID PK; uniq(tenant,idempotencyKey); idx×3 (orderRef, status, pspReference) | `paymentMethod` Json                                | yes              | no (status mutates)              | High           | 1 row/payment attempt                                          |
| payments.payment_attempts                      | UUID PK; FK→intent; idx(intentId)                                            | —                                                   | no               | yes                              | High           | retry log                                                      |
| payments.processed_webhooks                    | UUID PK; uniq(tenant,provider,eventId)                                       | —                                                   | no               | yes                              | **Very-High**  | 1/PSP webhook, **unbounded, no retention**                     |
| payments.charges                               | UUID PK; FK→intent; idx(intentId)                                            | —                                                   | no               | yes                              | Medium         | 1/capture                                                      |
| payments.refunds                               | UUID PK; FK→intent; uniq(intentId,idempotencyKey)                            | —                                                   | no               | mostly                           | Medium         | subset of orders                                               |
| orders.orders                                  | UUID PK; uniq(tenant,orderNumber); idx(tenant,customerRef,createdAt)         | totals/address Json?                                | yes              | no                               | High           | core entity                                                    |
| orders.order_events                            | UUID PK; FK→order; idx(orderId,occurredAt)                                   | —                                                   | no               | yes                              | **Very-High**  | order status is _derived_ from this log, never pruned          |
| returns.return_requests                        | UUID PK; idx(tenant,orderRef)/(tenant,status)                                | items/approval/inspections Json                     | yes              | no                               | Medium         | fraction of orders                                             |
| returns.processed_callbacks                    | UUID PK; uniq(tenant,source,callbackId)                                      | —                                                   | no               | yes                              | Medium-High    | unbounded                                                      |
| notifications.notifications                    | UUID PK; uniq(tenant,idempotencyKey)                                         | recipient/channels/**attempts+history JSON arrays** | yes              | row mutable, arrays only grow    | **Very-High**  | highest fan-out table platform-wide; unbounded row-size growth |
| notifications.processed_callbacks              | UUID PK; uniq(tenant,provider,callbackId)                                    | —                                                   | no               | yes                              | Very-High      | unbounded                                                      |
| fulfillment/shipping.processed_*_webhooks      | UUID PK; uniq per carrier/provider                                           | —                                                   | no               | yes                              | High           | unbounded                                                      |
| shipping.shipments                             | UUID PK; uniq(tenant,idempotencyKey)                                         | label/**trackingEvents array**/estimate Json        | yes              | row mutable, array only grows    | High/Very-High | same embedded-array bloat as Notification                      |
| tracking.tracking_event_records                | UUID PK; uniq(tenant,eventId); idx×4                                         | envelope/consent/identity/attribution/versions Json | n/a              | yes, by contract                 | **Very-High**  | "system of record, not telemetry," **no TTL found**            |
| tracking.tracking_event_revisions              | UUID PK; FK→record; uniq(tenant,eventId,revisionSeq)                         | stages/destinations Json                            | no               | yes                              | Very-High      | 1+/event stage                                                 |
| finance.journals / ledger_entries              | UUID PK; idx(tenant,sourceRef/accountRef,postedAt)                           | —                                                   | no               | yes                              | Medium-High    | 1/financial transaction                                        |
| finance.expenses                               | UUID PK; idx(tenant,incurredAt)/(tenant,costCenterRef)                       | description text                                    | no               | no                               | Medium         | **`categoryRef` has no index** (§7)                            |
| security.audit_records                         | UUID PK; uniq/idx(tenant,tenantScope,sequence)                               | metadata Json                                       | no (immutable)   | yes, hash-chained WORM           | **Very-High**  | append-only audit ledger, no archival job found                |
| customer_360.identity_links/identity_decisions | UUID PK; idx×2                                                               | —                                                   | no               | yes                              | Very-High      | identity-graph edges, unbounded                                |
| customer_360.*_snapshots / segment_history     | UUID PK; idx(tenant,identifier…,capturedAt)                                  | fields Json                                         | business version | yes, **full capture per change** | Very-High      | amplifies storage vs. diff-based logging                       |
| customer_360.session_transitions               | UUID PK; idx×3                                                               | —                                                   | no               | yes                              | Very-High      | 1/session edge                                                 |
| platform.outbox                                | UUID PK; idx(status,createdAt)/(createdAt)                                   | payload Bytes, headers Json                         | no               | yes until published              | **Very-High**  | **prune job broken under CDC (C-08) — effectively unbounded**  |
| platform.inbox_processed_events                | composite PK; idx(processedAt)                                               | —                                                   | no               | yes                              | Very-High      | "retention sweep" comment, **no sweep job exists**             |
| platform.dead_letters                          | UUID PK; idx(consumerGroup,failedAt)                                         | value Bytes, headers Json                           | no               | yes                              | Medium         | **no index on `messageId`** (§7)                               |

No table in scope — other than the unimplemented `platform.outbox` partitioning plan described in `main.prisma`'s header comment — has a documented TTL, cron cleanup, or partition scheme. `docs/architecture/15-scalability-and-deployment.md:15` claims "partitioning: orders, events, touchpoints, audit (by month)" as an intended lever; **zero `PARTITION BY` SQL exists in any of the 39 migrations** — this is aspirational design intent, not implemented infrastructure.

---

## 5. Data Growth Model

**No authoritative production traffic/volume numbers exist in the repository.** `docs/architecture/15-scalability-and-deployment.md:31` states only a relative multiplier — "Black Friday ≈ 50× baseline" — without ever defining the baseline. No seed data implies real volume (Railway seed creates 3 products, 1 category, 100 units of stock — a demo fixture, not a capacity signal). Per the task's instruction not to invent business numbers, the following are **explicit parameterized test scenarios**, not production claims:

| Scenario     | Payment intents | Charges | Refunds | Webhook/event rows |
| ------------ | --------------: | ------: | ------: | -----------------: |
| S1 — Small   |              1M |      2M |    500K |                 1M |
| S2 — Medium  |             10M |     25M |     10M |                25M |
| S3 — Large   |            100M |    250M |    100M |               250M |
| S4 — Extreme |            500M |     1B+ |    500M |                1B+ |

None of these were executed against a real database (§8). They exist only to frame the storage estimates in §6 and to give any future benchmarking effort concrete targets.

---

## 6. Query Inventory

Full method-level inventory (15 highest-frequency patterns) was produced by tracing every Prisma repository/adapter in `services/payments`, `services/orders`, `services/returns`, `services/notifications`, `apps/runtime`. Highlights:

| #   | Model                        | Method                                                                  | Where-fields                   | Location                                    | Hot path                            |
| --- | ---------------------------- | ----------------------------------------------------------------------- | ------------------------------ | ------------------------------------------- | ----------------------------------- |
| 1   | PaymentIntent                | `findFirst`+include                                                     | id, tenantId                   | `prisma-payment-intent-repository.ts:83`    | capture/refund/authorize/webhook    |
| 2   | PaymentIntent                | `findFirst`+include                                                     | pspReference, tenantId         | `prisma-payment-intent-repository.ts:121`   | Stripe webhook correlation (A.10)   |
| 4   | PaymentIntent                | `updateMany` (optimistic lock)                                          | id, tenantId, version          | `prisma-payment-intent-repository.ts:45`    | every capture/refund/webhook settle |
| 7   | ProcessedWebhook             | `findUnique`                                                            | (tenant,provider,eventId)      | `prisma-processed-webhook-store.ts:23`      | every Stripe webhook                |
| 9   | PaymentIntent                | `findMany`+include (**all intents for order**)                          | orderRef, tenantId, currency   | `composition.ts:289` (`isRefundable`)       | Returns' refund-decision gate       |
| 10  | PaymentIntent                | `findFirst`                                                             | id, orderRef, tenantId, status | `composition.ts:261` (`hasCapturedPayment`) | `MarkOrderPaid` gate                |
| 11  | Order                        | `findFirst`+items+events, then separate address `findFirst` (2 queries) | id, tenantId                   | `prisma-order-repository.ts:87-99`          | every order read/write              |
| 14  | ProcessedEvent (Kafka inbox) | `findUnique`/`create`                                                   | (consumerGroup,messageId)      | `prisma-processed-event-store.ts:22,34`     | every consumer message              |

Index coverage cross-check: query #1/#2/#9/#10 are covered by `PaymentIntent`'s three composite indexes; #9 additionally filters on `currency`, which is not indexed but only narrows an already-selective `(tenantId, orderRef)` result set. `Order.list()` orders by bare `id desc` filtered by `tenantId` with no explicit `(tenantId, id)` composite — low risk today because `id` is a sortable UUIDv7, but worth a follow-up index if list-scan volume grows.

**Refund capacity calculation (flagged):** `PrismaRefundVerificationAdapter.isRefundable` (`composition.ts:288-310`) re-fetches **every** `PaymentIntent` row for an order plus all its `charges`/`refunds`, then sums in JavaScript, on **every** `DecideResolution` call — there is no stored `captured_total`/`refunded_total` and no DB-side `aggregate`/`sum`. Cheap today (typically 1 intent/order); a full-rescan-per-call pattern that degrades if partial-refund volume per order grows. This is a repeat of the pattern `PaymentIntent.remaining()` already handles correctly in-memory from an already-loaded aggregate — `isRefundable` should ideally reuse the same aggregate rather than re-querying.

**Idempotency mechanisms** (all point lookups on unique indexes, not full scans): client-request idempotency via Redis `SET NX EX` (not Postgres); consumer-event idempotency via `ProcessedEvent(consumerGroup,messageId)` unique; webhook idempotency via `ProcessedWebhook(tenant,provider,eventId)` unique; `PaymentIntent`/`Refund.idempotencyKey` reservation-resume reads the already-loaded aggregate, not a separate query.

---

## 7. Index Analysis

`EXPLAIN`/`EXPLAIN ANALYZE` could not be run (no live PostgreSQL — Task 7's stated method is blocked). Static index-vs-query cross-referencing found:

- Missing/weak indexes: `finance.expenses.category_ref` (no index at all), `finance.expense_categories.cost_center_ref` (not covered by the sole `@@index([tenantId])`), `platform.dead_letters` (no index on `message_id`, the natural correlation key back to the source event).
- All payment/order/return/webhook hot-path queries identified in §6 are covered by an existing composite index or unique constraint.
- No evidence either way on bitmap-scan thresholds, buffer hit ratios, or planner cost estimates — these require `EXPLAIN ANALYZE` against populated tables and are **not yet verified**.

---

## 8. N+1 Analysis

Every loop (`for`/`.forEach`/`.map(async`) on the payment/order/return/notification/fulfillment/shipment critical path was checked for an `await prisma...`/`await <repository>.find...` inside the loop body.

**Result: no classic N+1 found on the critical path.** All loops there build in-memory domain objects from an already-fetched array; batch writes (`createMany`, the per-refund `upsert` loop in `prisma-payment-intent-repository.ts:66-71`) operate on rows already held from a single `save()` call. The one related finding is the `isRefundable` full-rescan pattern in §6, which is N+1-_adjacent_ (repeated full re-aggregation per call) rather than a true per-item-loop N+1. Two `await`-in-loop sites exist outside the critical path (`seed.ts`, `tracking-registry-seed.ts`) — process-start/admin-triggered only, not actionable here.

---

## 9. Write Throughput Results

**Not measured — environment-blocked.** No PaymentIntent/Charge/Refund/Capture write-path ops/sec, p50/p95/p99, or saturation point could be produced without a reachable PostgreSQL instance.

## 10. Read Throughput Results

**Not measured — environment-blocked.** Same constraint as §9.

## 11. Connection Pool Saturation

**Not measured — environment-blocked** for the pool-size sweep (5/10/20/50/100) the task specifies. What _is_ established without a live DB (§2, §12): the production runtime never actually configures a pool size at all — `createPrismaClient` is called with only `{ url, logQueries }` in both `apps/runtime/src/composition.ts:131-134` and `apps/runtime/src/seed.ts:73-76`, so Prisma falls back to its internal default (`num_physical_cpus × 2 + 1`), independent of `DATABASE_POOL_MAX`. This is the single highest-priority target for a future load test once the environment is unblocked, since the current pool size in production is effectively **unknown and uncontrolled**, not merely untested.

---

## 12. Transaction Duration

Not measurable in wall-clock terms without a live database, but the **structural** question the task emphasizes — is a PSP HTTP call ever made while a Postgres transaction is open — was fully traceable in code:

| Flow                                                     | PSP call location                                                                                                   | Inside transaction? | Verdict                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- |
| Capture                                                  | `payment-lifecycle.use-cases.ts:306`, between `reserve()` (in tx) and `settle()` (separate tx)                      | **No**              | PASS — A.8 remediation intact                                   |
| Refund                                                   | `payment-lifecycle.use-cases.ts:496-500`, between `reserve()`/`settle()` transactions                               | **No**              | PASS — A.4 remediation intact                                   |
| Authorization (`AuthorizePayment`)                       | none — this use case only records a client-confirmed PSP reference, no network I/O                                  | N/A                 | PASS (nothing to fix)                                           |
| Payment-intent creation (`CreatePaymentIntentLifecycle`) | `payment-lifecycle.use-cases.ts:96-102`, inside `unitOfWork.run(...)` at line 91, before `intents.save` at line 104 | **Yes**             | **FAIL — reproduces the pre-A.8 long-transaction anti-pattern** |

Also found: `PrismaUnitOfWork.run` (`packages/db/src/prisma-repository.ts:41-43`) calls `runInTransaction(this.prisma, work)` with **no options**, even though `TransactionOptions.timeoutMs`/`maxWaitMs` exist and are wired through `runInTransaction` (`packages/db/src/transaction.ts:20-23`). Every Capture/Refund/Authorize/CreateIntent transaction therefore runs under Prisma's undocumented built-in defaults (5000ms timeout / 2000ms maxWait) rather than an explicit, reviewed value — which matters more, not less, now that one of these flows holds a network call inside the transaction.

---

## 13. Lock Contention

**Not measured — environment-blocked** (no concurrent-writer test against real Postgres possible). Structurally, every mutable aggregate in scope uses the same optimistic-concurrency pattern (`version int` + `updateMany WHERE id = ? AND tenantId = ? AND version = ?`, 0-rows-affected → `ConcurrencyError`), consistent with the mechanism already validated (against in-memory fakes, not real Postgres) in Phases A.3/A.4/A.8. Whether this remains sufficient under real lock contention at, e.g., 100 concurrent refunds against one `PaymentIntent`, is exactly what real load testing would need to confirm and cannot be claimed here.

---

## 14. Financial Integrity Under Load

**Not measured against real PostgreSQL — environment-blocked.** The invariants (`refunded ≤ captured`, `captured ≤ authorized`, no duplicate conflicting authorizations, idempotent retries) are enforced in code via the optimistic-version pattern and the idempotency mechanisms in §6, and are covered by the existing regression suites (all 168 runtime tests + full monorepo suite pass, §24) — but per this task's explicit instruction, "**do not rely exclusively on in-memory fakes**" for this claim, and that is precisely the only evidence available right now. This is the most important target for the first real load test once WSL2/Docker is repaired.

---

## 15. Webhook Burst Results

**Not measured — environment-blocked.** Structurally, the webhook path (`ProcessedWebhook` unique-index dedup, §6 #7-#8) is a single point lookup plus insert per event, which is the right shape for burst handling, but no throughput number exists.

## 16. Idempotency Performance

**Not measured at 100K/1M/10M/100M scale — environment-blocked.** All idempotency lookups (§6) are on unique btree indexes appropriate for O(log n) point lookups; whether that holds in practice at 100M rows was not verified.

## 17. Vacuum / Bloat

**Not measured — environment-blocked**, and separately, **no autovacuum tuning exists to measure**: no `autovacuum_*` storage parameters in any migration, no autovacuum overrides in the Postgres command in `docker-compose.yml`. High-update tables most at risk of bloat if this ever runs at volume: `payment_intents` (status/version updates), `orders` (status/version updates), `notifications.notifications` (its embedded `attempts`/`history` JSON arrays grow the row itself, which increases HOT-update pressure specifically).

## 18. WAL / Checkpoints

**Not measured — environment-blocked.** `wal_level=logical` is set locally (`docker-compose.yml:53`) specifically to support Debezium CDC — this is necessary infrastructure, already in place, but its throughput headroom under write load was not tested.

## 19. Backup / Restore

Real scripts exist — `scripts/ops/backup-postgres.sh` (`pg_dump --format=custom`, SHA-256 checksum, optional S3 upload, retention pruning) and `scripts/ops/restore-postgres.sh` (`pg_restore` behind a `CONFIRM=yes` guard with checksum verification). Critically, the restore script's "PITR mode" **prints a manual runbook rather than executing PITR**. `docs/operations/BACKUP_AND_RECOVERY.md` commits to RPO ≤ 5 min / RTO ≤ 30 min via continuous WAL archiving + nightly base backup + quarterly restore drills — but `archive_mode` stays off in the repo's own compose file, and whether it is ever turned on in the Railway production environment is **not represented in repository evidence** (restated from Phase A.7 finding). **This phase could not execute a real backup/restore/RPO/RTO measurement** — WSL2/Docker block it — so the number above remains an unverified operational commitment, not a proven capability.

## 20. Failure Testing

**Not performed — environment-blocked.** No PostgreSQL restart, connection-loss, pool-exhaustion, or deadlock simulation was possible without a reachable instance.

---

## 21. Capacity Model

Cannot be built from measured data (§9-§20 are all blocked). What follows is the theoretical-only storage sizing the task allows in lieu of `pg_total_relation_size`, clearly labeled:

**Theoretical row-size estimates** (Postgres tuple header ~24B + varlena overhead + btree index entries; no live instance to confirm via `pg_column_size`/`pg_total_relation_size`):

| Table                                  |                                                     Est. bytes/row incl. indexes |                                     1M rows |            10M rows |            100M rows |             500M rows |
| -------------------------------------- | -------------------------------------------------------------------------------: | ------------------------------------------: | ------------------: | -------------------: | --------------------: |
| payment_intents                        |                                                           ~400-600 (theoretical) |                       ~0.5 GB (theoretical) | ~5 GB (theoretical) | ~50 GB (theoretical) | ~250 GB (theoretical) |
| charges / refunds                      |                                                           ~250-350 (theoretical) |                       ~0.3 GB (theoretical) | ~3 GB (theoretical) | ~30 GB (theoretical) | ~150 GB (theoretical) |
| processed_webhooks                     |                                                           ~150-250 (theoretical) |                       ~0.2 GB (theoretical) | ~2 GB (theoretical) | ~20 GB (theoretical) | ~100 GB (theoretical) |
| tracking_event_records / notifications | highly variable — JSON envelope/attempts payload size is not fixed by the schema | not estimable without a real payload sample |       not estimable |        not estimable |         not estimable |

These numbers are **rough order-of-magnitude only**, provided because the task requires _some_ figure in lieu of measurement; they must not be treated as a capacity commitment.

**Everything else the task asks this section to define** — sustainable/safe/peak TPS, p95/p99 thresholds, connection saturation point, Safe/Danger/Failure Operating Zones — **requires measured data this phase does not have**. None is fabricated here.

---

## 22. Bottlenecks

Two bottlenecks are **code-verified without benchmarking** (not speculative):

1. **Connection pool size is uncontrolled in production** (§11) — this alone could become the first-hitting ceiling under concurrency, since nobody has configured it to a value informed by expected load.
2. **`CreatePaymentIntentLifecycle` holds a network call inside a DB transaction** (§12) — this will extend lock hold time under load proportional to Stripe's response latency, exactly the class of problem A.8 fixed elsewhere.

Everything else in Tasks 9-20 (write/read saturation points, lock-contention thresholds, WAL/vacuum pressure) is an **unverified hypothesis**, not a bottleneck claim, until real load testing runs.

---

## 23. Recommendations

Per the task's rule ("do not recommend before evidence"), only items with direct code evidence are recommended, and none are speculative capacity additions (no read replicas, no partitioning, no caching layer are recommended — no benchmark justifies any of them yet):

| Recommendation                                                                                                                                                                           | Evidence      | Bottleneck addressed                                | Benefit                                                                     | Cost/Risk                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Wire `DatabaseConfig.poolMax/connectTimeoutMs/statementTimeoutMs` into the actual `PrismaClient` construction (composition.ts + seed.ts) instead of the current `as`-cast partial object | §11, §2       | unknown/uncontrolled pool size                      | makes connection pooling an actual operational lever instead of dead config | low — config plumbing only, no behavior change until values are set deliberately           |
| Move the Stripe `createIntent` call in `CreatePaymentIntentLifecycle` outside the `unitOfWork.run` block, mirroring the reserve/PSP-call/settle split already used by Capture and Refund | §12           | long transaction under network latency              | closes the last known A.8-class gap                                         | medium — touches a payment-critical code path, needs the same care as the original A.8 fix |
| Fix or replace the `outbox-prune` job's `status: 'published'` filter so it actually matches CDC-delivered rows (gap C-08)                                                                | §4            | unbounded `platform.outbox` growth                  | bounds a Very-High-growth table                                             | low-medium — was already an open gap before this phase                                     |
| Set an explicit `timeout`/`maxWait` on `PrismaUnitOfWork.run` rather than relying on Prisma's undocumented 5000ms/2000ms defaults                                                        | §12           | undefined transaction timeout behavior              | predictable failure mode under load                                         | low                                                                                        |
| Add an index on `finance.expenses.category_ref` and `platform.dead_letters.message_id`                                                                                                   | §7            | unindexed lookup columns                            | avoids future seq scans as those tables grow                                | low                                                                                        |
| Schedule and actually run a real load test (Tasks 8-20) once WSL2/Docker is repaired                                                                                                     | entire report | closes the measurement gap this report cannot close | the only way to get the numbers this task actually asked for                | none — it's the missing prerequisite, not new work                                         |

No read replica, partitioning, caching, or sharding recommendation is made — none is justified by measured evidence, per the task's Absolute Constraints.

---

## 24. Remaining Risks

- **Real load testing remains completely unverified.** Every number in §9-§20 is absent, not estimated.
- The two code-verified issues in §22 could combine badly: an under-provisioned connection pool plus a transaction that's occasionally held open for a full Stripe round-trip is a plausible path to connection exhaustion under peak load — but this is a hypothesis, not a measured finding.
- Backup/PITR is a documented commitment (§19) with no verified execution — an actual disaster today would test an unverified process for the first time in production.
- TLS-in-transit and RLS gaps (§2, restated from Phase A.7) remain open and are unrelated to capacity but compound overall production risk.

**Quality gates (Task 24):**

| Gate                         | Result                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`             | ✅ 78/78 packages pass                                                                                                                                                 |
| `pnpm lint`                  | ✅ pass                                                                                                                                                                |
| `pnpm test`                  | ✅ 78/78 task suites pass (168 tests in `apps/runtime` alone; DB-integration tests correctly skip/no-op rather than false-pass against the unreachable local Postgres) |
| `pnpm arch` (`depcruise`)    | ✅ 0 violations, 1565 modules / 6788 dependencies                                                                                                                      |
| `pnpm governance`            | **Does not exist** in this checkout — no such script in root `package.json` or any workspace                                                                           |
| `pnpm dup`                   | **Does not exist** in this checkout — no such script in root `package.json` or any workspace                                                                           |
| `pnpm prisma validate`       | ✅ "The schemas at prisma\schema are valid" (with a placeholder `DATABASE_URL`; needs no live connection)                                                              |
| `pnpm prisma migrate status` | ❌ `P1001: Can't reach database server at localhost:5432` — expected, environment-blocked, not a schema/migration defect                                               |

All existing A.4-A.11 regression suites are part of the green `pnpm test` run above — none regressed in this phase (no code was changed).

---

## 25. Production Capacity Verdict

> **Database capacity is not yet certified because production-like PostgreSQL load testing is environment-blocked** (WSL2 catastrophic failure, `Wsl/Service/E_UNEXPECTED`, independent of this project).

Within that constraint, the verdict is:

### CONDITIONALLY PRODUCTION READY

The schema, indexing strategy, transaction boundaries (with one exception), and query shapes are structurally sound by code review, and every existing regression suite is green. This is not a capacity certification — no throughput, latency, or concurrency number was or could be measured. It reflects that the architecture shows no structural reason it _couldn't_ scale, conditioned on: (1) an actual load test being run once the environment is fixed, and (2) the two code-verified gaps in §22 (uncontrolled connection pool, long-transaction regression in `CreatePaymentIntentLifecycle`) being closed first, since both are exactly the kind of defect that only becomes visible — and expensive — under real concurrent load.
