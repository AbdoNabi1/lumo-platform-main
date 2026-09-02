# 05 — Event-driven architecture, queues, workers, background jobs

> **Status: CONTRACT — 2026-06-28.** Defines the event backbone, queueing, worker types, and the
> background-job model.

## 1. Event-driven architecture

### 1.1 Backbone and guarantees

- **Redpanda (Kafka API)** is the event spine. Chosen for replay/retention (attribution recompute over 12+ months).
- **Transactional outbox + Debezium (CDC):** domain events are written in the same DB transaction as the state change; Debezium streams the outbox table to Redpanda. This is the only mechanism that gives exactly-once between DB and broker.
- **Idempotent consumers:** every consumer is keyed by event id; reprocessing is safe.
- **Schema registry (Apicurio):** Avro/Protobuf enforced at produce time; evolution is additive-only.

### 1.2 Topic naming and versioning

`<context>.<aggregate>.<event>.v<version>` — e.g. `orders.order.placed.v1`,
`catalog.product.updated.v1`, `tracking.event.captured.v1`. Events are past tense. Breaking change
⇒ new version topic; old kept for N=3 versions; consumers declare accepted versions.

### 1.3 Ordering and partitioning

Partition key = the aggregate id (e.g. `order_id`) so per-aggregate ordering holds. Cross-aggregate
ordering is never assumed.

### 1.4 Event taxonomy (illustrative, not exhaustive)

| Context | Key events |
|---|---|
| Catalog | product.created/updated/published/archived |
| Inventory | stock.reserved/released/adjusted, stock.low |
| Orders | order.placed/paid/fulfilled/cancelled/refunded |
| Cart | cart.item_added/removed, cart.abandoned |
| Identity | customer.registered, consent.changed |
| Tracking | event.captured, identity.stitched |
| Experimentation | assignment.recorded, exposure.logged |

## 2. Queue architecture

Two queue technologies, chosen by purpose:

| Tech | Use | Why |
|---|---|---|
| Redpanda (event log) | Inter-context domain events, replayable streams, analytics ingest | Durable, ordered, replayable |
| BullMQ (Redis) | Lightweight intra-service background jobs (emails, exports, thumbnails) | Low overhead; Kafka is overkill for "send this email" |

Every consumer/queue has: idempotency keys, bounded retries with exponential backoff + jitter,
a **dead-letter queue (DLQ)** with alerting, and visible lag/depth metrics.

## 3. Worker architecture

| Worker type | Runtime | Examples | Scaling signal |
|---|---|---|---|
| Event consumers | per service | projection updaters, ACL translators | consumer lag |
| Job workers (BullMQ) | per service | email send, export, image processing | queue depth |
| Stream processors (Go) | dedicated | tracking ingest, attribution, search/feed indexing | throughput / lag |
| Workflow workers (Temporal) | dedicated | checkout, returns, fulfillment, renewals | task-queue depth |

Workers are stateless and horizontally scaled (KEDA on queue depth / consumer lag). Graceful
shutdown drains in-flight work; no job is acked until durably processed.

## 4. Background jobs

- **Scheduled jobs** run via Temporal cron or a leader-elected scheduler — never ad-hoc OS cron on a random pod.
- **Long-running / multi-step** flows are Temporal workflows (durable state, timers, retries, compensation) — not DB-flag state machines.
- **Job catalog (illustrative):** abandoned-cart release (reservation TTL), abandoned-cart recovery emails, feed regeneration + sync, search reindex, analytics rollups, attribution recompute, reverse-ETL audience sync, webhook redelivery, report exports, scheduled campaign sends, data-retention purges.
- **Saga compensation:** any orchestrated flow defines compensating actions for each step (e.g. release inventory if payment fails).

## Requires ADR to change

- Replacing Redpanda/BullMQ/Temporal, or the outbox+CDC mechanism.
- Topic naming/versioning scheme, partition-key policy, or the additive-only evolution rule.
