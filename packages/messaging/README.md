# @platform/messaging

## Purpose

The **event-backbone runtime** every bounded context relies on: the transactional **outbox**
write-side, **publisher**/**consumer** abstractions, **idempotency**, **retry**, and **DLQ**, plus
in-memory adapters for local development and tests. Broker-agnostic — Redpanda/Debezium adapters
are added later. Classic DDD + Outbox; **no CQRS/Event Sourcing**.

## Architecture

- **Outbox (producer):** `OutboxWriter` turns an aggregate's pulled domain events into
  `IntegrationEvent` envelopes (`@platform/domain-events`) and appends them via `OutboxStore`
  **inside the aggregate's transaction**. Invoked by **infrastructure** (the persistence boundary),
  never by the application layer. `EventContext` carries `correlationId`/`causationId`.
  `IntegrationEventTranslator` (per context) maps domain → integration events, keeping
  `@platform/domain` pure.
- **Relay:** `OutboxRelay` drains pending entries → `EventPublisher` (local/test). In production
  Debezium streams the outbox table directly, so the relay is not deployed.
- **Publisher:** `EventPublisher` port (Kafka-style `PublishRecord`, partition key = aggregate id)
  - `InMemoryEventPublisher`/`InMemoryEventBus`.
- **Consumer:** `EventConsumer` deserializes → idempotency check → handles → records processed;
  retries with bounded backoff; dead-letters on exhaustion. `EventHandler` is implemented per
  context.
- **Idempotency:** `ProcessedEventStore` keyed by `messageId` (redelivery-safe; `record` is
  idempotent so a context may record within its own handler transaction for exactly-once effect).
- **Retry:** `RetryPolicy` — bounded exponential backoff + jitter (deterministic via injected
  jitter).
- **DLQ:** `DeadLetterStore` captures exhausted messages for inspection/redelivery.

## Dependencies

`@platform/domain` (DomainEvent/AggregateRoot — producer side), `@platform/domain-events`
(envelope + serializer), `@platform/contracts` (`Clock`, `IdGenerator`), `@platform/utils`
(`Logger`). Sits at `domain ← application ← messaging ← infrastructure`: it never imports the
application layer, and the application layer never imports it. Infrastructure adapters depend on it.

## Extension points

- **Broker adapters (deferred):** implement `EventPublisher` (Redpanda) and a consumer source that
  feeds `IncomingMessage`s; configure Debezium to stream the outbox table.
- **Persistence adapters (deferred):** implement `OutboxStore`, `ProcessedEventStore`,
  `DeadLetterStore` with Prisma (the outbox append runs in the aggregate's transaction).
- **Serializer (deferred):** the production Avro/Protobuf `EventSerializer`
  (`@platform/domain-events`).
- **Per-context wiring:** provide an `IntegrationEventTranslator` and `EventHandler`s.
