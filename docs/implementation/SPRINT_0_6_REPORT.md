# Sprint 0.6 — Event Backbone — Implementation Report

> **Date:** 2026-06-30 · **Status:** ✅ COMPLETE (all validation green) · **Phase 0 — Foundations.**

## 1. Summary

Delivered the **broker-agnostic event backbone** every bounded context will rely on: the
cross-context integration-event contracts (`@platform/domain-events`) and the messaging runtime
(`@platform/messaging`) — transactional outbox write-side, publisher/consumer abstractions,
idempotency, retry, and DLQ — with in-memory adapters. Classic DDD + Outbox; **no CQRS/Event
Sourcing**. Redpanda/Debezium/Apicurio adapters and the production serializer are deferred (D-A/D-B).
No existing package source was modified.

## 2. Decisions applied (approved)

- **D-A:** broker-agnostic now; Redpanda adapters, Debezium connectors, Apicurio, and production
  broker wiring deferred. In-memory adapters implemented.
- **D-B (modified):** `EventSerializer` abstraction + **test-only** `InMemoryEventSerializer`
  (`@platform/domain-events/testing`); **no JSON production default** — the production serializer is
  left unimplemented (Avro/Protobuf later). The envelope is already Avro-compatible (primitive
  fields), so no future migration.
- **D-C:** `correlationId`/`causationId` live only on the integration event; domain events stay pure.
- **D-D:** `OutboxWriter` writes only to the outbox inside the caller's transaction; local relay for
  dev/tests; Debezium in production.
- **D-F/D-G:** exactly two packages; `EventPublisher`/`EventConsumer`/`OutboxStore`/
  `ProcessedEventStore`/`DeadLetterStore` live in `@platform/messaging`; `@platform/contracts`
  unchanged. (Recorded as DECISIONS D-023/D-024 — no ADR; the architecture contract is unchanged.)

## 3. Packages

- **Created:** `@platform/domain-events` (integration-event contracts — the only async coupling
  surface), `@platform/messaging` (event-backbone runtime).
- **Modified:** none (existing source untouched; `pnpm-lock.yaml` updated by install).

## 4. Deliverables → where

| Deliverable                                                                                                                         | Location                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Domain Events package (envelope, versioning, naming, serialization, metadata, ids, timestamps, aggregate/correlation/causation ids) | `@platform/domain-events`: `integration-event.ts`, `topic.ts`, `serializer.ts`                                              |
| Outbox (interfaces, tx boundary, aggregate→integration mapping)                                                                     | `@platform/messaging/outbox/*` (`OutboxStore`, `OutboxWriter`, `IntegrationEventTranslator`, `EventContext`, `OutboxEntry`) |
| Event Publisher                                                                                                                     | `@platform/messaging/publisher/*` (`EventPublisher` + `InMemoryEventPublisher`/`InMemoryEventBus`) + `OutboxRelay`          |
| Event Consumer base                                                                                                                 | `@platform/messaging/consumer/*` (`EventConsumer`, `EventHandler`, `IncomingMessage`)                                       |
| Idempotency                                                                                                                         | `@platform/messaging/idempotency/*` (`ProcessedEventStore` + in-memory)                                                     |
| Retry                                                                                                                               | `@platform/messaging/retry/retry-policy.ts`                                                                                 |
| Dead Letter Queue                                                                                                                   | `@platform/messaging/dlq/*` (`DeadLetterStore` + in-memory)                                                                 |
| Event ordering                                                                                                                      | partition key = aggregate id (`PublishRecord.key`); per-key FIFO in the in-memory bus                                       |

## 5. Files created

- **`@platform/domain-events`** (12): `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`,
  `src/{integration-event.ts, topic.ts, serializer.ts, index.ts, topic.test.ts}`,
  `src/testing/{in-memory-event-serializer.ts, index.ts, in-memory-event-serializer.test.ts}`.
- **`@platform/messaging`** (30): `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`,
  `src/index.ts`; `src/publisher/{event-publisher.ts, in-memory-bus.ts, in-memory-publisher.ts, in-memory-publisher.test.ts}`;
  `src/outbox/{outbox-entry.ts, event-context.ts, integration-event-translator.ts, outbox-store.ts, outbox-writer.ts, in-memory-outbox-store.ts, outbox-relay.ts, outbox-writer.test.ts, outbox-relay.test.ts}`;
  `src/consumer/{event-handler.ts, incoming-message.ts, event-consumer.ts, event-consumer.test.ts}`;
  `src/idempotency/{processed-event-store.ts, in-memory-processed-event-store.ts, in-memory-processed-event-store.test.ts}`;
  `src/retry/{retry-policy.ts, retry-policy.test.ts}`;
  `src/dlq/{dead-letter-store.ts, in-memory-dead-letter-store.ts, in-memory-dead-letter-store.test.ts}`.

## 6. Files modified

- None in existing package source. Phase-5 docs: `PROJECT_STATE.md`, `AI_CONTEXT.md`, `DECISIONS.md`,
  this report.

## 7. Dependency direction (verified)

`@platform/domain-events`: leaf (no runtime deps). `@platform/messaging` → `@platform/domain`,
`@platform/domain-events`, `@platform/contracts`, `@platform/utils`. It does **not** import the
application layer, and no inner layer imports it — preserving
`domain ← application ← messaging ← infrastructure`. Deferred infra adapters will depend on
messaging.

## 8. Validation results

| Gate             | Result                                                                             |
| ---------------- | ---------------------------------------------------------------------------------- |
| `pnpm lint`      | ✅ PASS                                                                            |
| `pnpm typecheck` | ✅ PASS                                                                            |
| `pnpm test`      | ✅ PASS — **22 new tests** (`@platform/domain-events` 6, `@platform/messaging` 16) |
| `pnpm build`     | ✅ PASS                                                                            |

No new external dependencies (no supply-chain-policy impact). Every public abstraction has tests;
all in-memory adapters and the writer/relay/consumer behaviors (mapping, dedup, retry-then-succeed,
DLQ-after-exhaustion, ordering) are covered deterministically (injected `Clock`/jitter, no Docker).

## 9. Deferred (explicitly NOT in 0.6)

Redpanda publisher/consumer adapters; Debezium connector config; Apicurio + Avro/Protobuf
`EventSerializer`; Prisma adapters for `OutboxStore`/`ProcessedEventStore`/`DeadLetterStore`;
live-broker integration tests. These land in the broker-wiring sprint when a Docker host is
available.

## 10. Remaining work

None for Sprint 0.6. The backbone is reusable but not yet consumed by any bounded context (Phase 1).
Next (per the roadmap): **0.7 — auth + cross-cutting seams**, then 0.8 fitness functions + walking
skeleton.

**Sprint 0.6 is complete. Stopping — not continuing to Sprint 0.7.**
