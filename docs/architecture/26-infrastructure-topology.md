# 26 — Infrastructure topology (Sprint 2.2.5)

> **Status: CONTRACT — 2026-07-05.** Why every infrastructure service exists, how data and
> events flow, and how the local stack maps to production. Operations: `infrastructure/docker/README.md`.
> Nothing here changes application architecture — every service sits behind an existing port
> (D-006/D-014/D-018) and is replaceable by contract.

## 1. Service inventory — why each exists

| Service                             | Role                                                                                                                                                         | Replaceable by                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| PostgreSQL 16                       | System of record: 10 schemas (9 contexts + `platform`), transactional outbox                                                                                 | Any Postgres (RDS/Cloud SQL/self-managed)      |
| Redis 7                             | Hot cart layer, cache, locks, rate-limit counters, idempotency cache (Sprint 2.3)                                                                            | Any Redis-protocol cluster                     |
| ClickHouse                          | Analytics/attribution store (docs 10/16) — fed by CDC, never queried by commands                                                                             | Any columnar warehouse behind the port         |
| MinIO                               | S3-compatible object storage: `media`, `exports`, `imports`, `backups` (versioned)                                                                           | S3/R2/GCS via `@platform/storage`              |
| Redpanda                            | The event backbone (Kafka API) — versioned business topics + `.retry`/`.dlq` companions                                                                      | Kafka/MSK; the code speaks Kafka protocol only |
| Debezium (Connect)                  | Streams `platform.outbox` via CDC → routes rows to their `topic` column (EventRouter). **The relay that replaces `OutboxRelay` in production** (doc 05 §1.1) | Any CDC that honors the outbox contract        |
| Apicurio Registry                   | Schema registry of record for envelope schemas (Avro/Protobuf evolution, doc 05 §1.2); SQL-backed on Postgres                                                | Confluent SR (API-compatible mode)             |
| Redpanda Console                    | Operator UI for topics/consumers/connect (the "Kafka UI" deliverable — native to Redpanda; tradeoff: one less generic tool)                                  | Kafka-UI/AKHQ                                  |
| OTel Collector                      | Single telemetry entry (OTLP 4317/4318): traces→Tempo, metrics→Prometheus, logs→Loki. **The seam for app instrumentation (G-19)**                            | Vendor agents — apps only ever know OTLP       |
| Prometheus / Grafana / Loki / Tempo | Metrics store / dashboards / logs / traces                                                                                                                   | Any LGTM-compatible or vendor stack            |
| Mailpit                             | SMTP sink + UI (no real mail can escape dev)                                                                                                                 | Real provider behind `MessageChannel` (doc 11) |
| pgAdmin / RedisInsight              | Operator DB/Redis UIs (`tools` network)                                                                                                                      | psql/redis-cli                                 |

## 2. Data flow

`Use case → UnitOfWork(tx) → Prisma repository → Postgres (aggregate rows + platform.outbox, ONE
transaction)` — the ADR-0003 invariant, now physically deployable. Reads: command-side via
repositories; analytics via CDC→ClickHouse (future read models, G-8). Media binaries:
app → MinIO signed URLs; only `storage_key` metadata in Postgres.

## 3. Event flow

`platform.outbox` → Debezium (pgoutput, publication `lumo_outbox`, snapshot=no_data) →
EventRouter (routes by the row's `topic` column; payload = serialized envelope bytes,
ByteArrayConverter — **the envelope on the wire is byte-identical to what `OutboxWriter`
persisted**) → Redpanda topic (key = aggregate id ⇒ per-aggregate ordering) → consumers
(Sprint 2.3+; `EventConsumer` + `PrismaProcessedEventStore` idempotency) → failures →
`<topic>.retry` (backoff redelivery, replacing in-process sleep per ADR-0005 note) →
exhaustion → `<topic>.dlq` (+ `platform.dead_letters` row, alert).

## 4. Failure recovery

Postgres down: writes fail fast (fail-loud tx seam) — no dual-write possible. Redpanda down:
outbox absorbs events durably; CDC resumes from the replication slot — nothing lost, delivery
delayed (the outbox IS the buffer). Debezium down: same — slot retains WAL until reconnect
(monitor slot lag; unbounded slots can bloat WAL — alert at 1GB). Consumer poison: retry topic
→ DLQ, never head-of-line blocking. Collector down: apps drop telemetry, never block business
paths (fire-and-forget exporters only).

## 5. Storage conventions (MinIO)

Buckets: `media` (tenant-prefixed keys `tenants/<tenantId>/media/...`, served by signed URLs),
`exports`/`imports` (30-day lifecycle expiry), `backups` (versioned; production adds object-lock

- cross-region replication). Bucket-per-purpose, folder-per-tenant — bucket-per-tenant does not
  scale to Shopify-style tenant counts.

## 6. Scaling & HA (production posture; local is single-node everything)

Postgres: HA primary + replicas, PgBouncer, PITR via WAL archiving to `backups`; partition
`platform.outbox` monthly when hot (MIGRATIONS.md §3). Redpanda: 3+ brokers, RF=3, tiered
storage for 7-year topics (financial/audit per doc 20 retention). Connect: ≥2 workers.
App tier: stateless by construction — horizontal. Observability: distributed Loki/Tempo with
object-storage backends. All limits in compose are dev-box ceilings, not production sizing.

## 7. Kubernetes migration path

The compose file is the contract, not the destination: every service maps 1:1 to a Helm chart /
operator (CloudNativePG or RDS, Redpanda operator, Strimzi-style Connect, kube-prometheus-stack,
Loki/Tempo charts, MinIO operator or real S3). The four compose networks become NetworkPolicies;
health checks become liveness/readiness probes; `deploy.resources` becomes requests/limits;
init containers replace `createbuckets`/`redpanda-topics`; secrets move to
ExternalSecrets→Vault. Nothing in application code changes — it consumes hostnames and ports
from env (doc 12 configuration layers), which is the entire point of the port/adapter rule.

## Requires ADR to change

The outbox-CDC delivery path, the topic naming/companion (`.retry`/`.dlq`) scheme, the
byte-identical envelope rule, or moving any state out of the versioned/backed-up stores.
