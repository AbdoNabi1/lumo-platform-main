# Sprint 2.5 Report — Messaging Platform (Broker Consumers)

> 2026-07-05. Scope per Phase-2 step 5. No HTTP/GraphQL/UI/business features. Extends the
> existing messaging ports — nothing duplicated, no ADR touched.

## What existed vs. what this sprint added

Existed (Sprints 0.6/H.1/2.2/2.2.5): all broker-agnostic ports (`EventPublisher`, outbox
family, `EventConsumer`, `ProcessedEventStore`+Prisma, `DeadLetterStore`+Prisma, `RetryPolicy`,
serializer), byte-exact envelopes with tenant/producer/correlation headers, topics with
`.retry`/`.dlq` companions, Debezium CDC as the production outbox relay, OTLP endpoints.

Added — new infrastructure package **`@platform/kafka`** (kafkajs; layer rules in
`.dependency-cruiser.cjs` strengthened to include it):

- **`KafkaMessageProducer`** implements `EventPublisher`: idempotent producer, acks=all,
  `maxInFlightRequests: 1` (no retry reordering), GZIP, bounded retries/delivery timeout,
  graceful disconnect, per-topic batching. **Publishes the exact bytes it is handed — events
  are never rebuilt** (the outbox row is the envelope of record; main business publication
  remains outbox→Debezium — this producer serves retry/DLQ and future direct paths).
- **`KafkaConsumerRuntime`**: subscribe (main + `.retry`), deserialize via the existing
  serializer contract, ADR-0005 idempotency order (`has` → handle → `recordIfNew`; recording
  first would lose crash-between-claim-and-handle messages), failure → republish ORIGINAL bytes
  to `<topic>.retry` with attempt/due headers, exhaustion → DLQ. Retry messages wait out their
  due time on the segregated retry partition — **the main topic never head-of-line blocks**
  (closes gap G-9's consumer half).
- **Retry engine**: `DEFAULT_RETRY_SCHEDULE` = 5s → 30s → 2m → 10m → 1h, then DLQ (pure,
  injectable, tested). No poison loops: bounded attempts, then rest in DLQ.
- **`DeadLetterPublisher`**: `<topic>.dlq` publish with original bytes + forensic headers
  (original topic, consumer group, tenant [envelope headers pass through], trace context,
  attempts, error + stack, timestamp) AND the `platform.dead_letters` row (byte-identical replay).
- **`ConsumerSupervisor`**: register/startAll/stopAll/restart, status, `HealthCheck` (readiness =
  all running), per-partition **lag** via the admin client.
- **OTel propagation**: `traceparent`/`tracestate`/`baggage` propagate verbatim through every
  retry/DLQ hop (`TRACE_HEADERS` codec); span creation itself is the G-19 sprint.
- **Metrics seam**: `MessagingMetrics` port (processed/failed/retried/dead-lettered/duplicate +
  duration) with `noopMetrics` default; the OTel adapter lands with G-19 and feeds
  collector→Prometheus (rates become processed/sec etc. in PromQL).

## First real cross-context flow (Step 10)

`services/orders/src/interfaces/payment-captured.consumer.ts`:
`payments.payment_intent.captured.v1` → **`MarkOrderPaid` use case** (application layer only;
aggregate untouched). Semantics pinned by 4 green unit tests: success path marks the order paid;
**already-paid ⇒ idempotent success** (duplicate deliveries); **NotFound ⇒ throw** (retryable —
placed/captured may race across contexts); **capture-after-refund ⇒ throw** (genuine anomaly →
DLQ, never swallowed). This makes the doc-22 rule real: payment truth is event-derived, never
caller-asserted.

## Validation

lint / typecheck / test / build **106/106** ✅ (6 new unit tests green) · dependency-cruiser
**0 violations (418 modules)**, with kafka ADDED to the layer rules ✅ · integration suite
(byte-exact produce→consume, duplicate skip, supervisor status/lag) ⛔ **honestly gated on
`KAFKA_BROKERS_TEST`** — Docker engine not running; first-boot runbook applies.

## Decisions (D-046) / tradeoffs

Single `.retry` topic per topic with due-time wait (bootstrap-provisioned) — tiered retry
topics (5s/1m/10m tiers, Uber-style) are the scale-up path if retry volume ever makes the wait
loop contended; the port shape doesn't change. `EventConsumer` retained for in-process/test
wiring; runtimes must use `KafkaConsumerRuntime` (in-process sleep never reaches a consumer
group). kafkajs over node-rdkafka (pure JS, no native build; librdkafka is the swap if
throughput demands — behind `EventPublisher` either way).

## Deferred

OTel span creation + metrics exporters (G-19) · worker entrypoint composing supervisor +
consumers per process (transport/worker sprint) · running gated suites (first-boot runbook) ·
handler-tx inbox marker for full effect-once (Prisma store already accepts the tx).
