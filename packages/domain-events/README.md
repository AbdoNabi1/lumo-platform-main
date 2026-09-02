# @platform/domain-events

## Purpose

The **cross-context integration-event contract** — the single async coupling surface between
bounded contexts (docs/architecture/02 §2, 05). It defines the versioned event **envelope**, the
**topic/versioning** helpers, and the **`EventSerializer`** abstraction. It contains no transport,
no broker, no business logic.

## Architecture

- `IntegrationEvent<TPayload>` — the envelope. Primitive field types (strings, integer version,
  RFC 3339 UTC timestamp, string→string metadata) so it maps onto a future Avro/Protobuf schema
  with **no migration**. `messageId` is the originating domain event id and the idempotency key.
  `correlationId`/`causationId` live only here — domain events stay pure.
- `topicFor(type, version)` → `<context>.<aggregate>.<event>.vN`; additive-only evolution.
- `EventSerializer` / `SerializedEnvelope` — the serialize/deserialize port. The production
  implementation (Avro/Protobuf via Apicurio) is **deliberately unimplemented** and added in the
  broker-wiring sprint. Tests use `InMemoryEventSerializer` from `@platform/domain-events/testing`.

## Dependencies

None at runtime (a dependency-graph leaf). Dev-only: build/test tooling.

## Extension points

- **Production serializer:** implement `EventSerializer` with Avro/Protobuf + schema registry.
- **New event types/versions:** add a `type` string and bump `eventVersion` (new `.vN` topic);
  evolution is additive-only.
- Consumed by `@platform/messaging` (envelope + serializer) and, later, by every bounded context
  (its own event contracts) and broker adapters.
