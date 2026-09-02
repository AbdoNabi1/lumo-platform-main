import type { IntegrationEvent } from "@platform/domain-events";

/**
 * Handles a single integration-event type. Implemented per consuming context. `eventType` /
 * `eventVersion` declare the subscription a broker adapter routes to. Handlers should be idempotent
 * (the `ProcessedEventStore` dedupes redelivery, but handlers must tolerate at-least-once).
 *
 * `handleAtomic` is an **opt-in** capability (ADR-0005, Sprint A0): when implemented, and the
 * runtime is given a `TransactionalUnitOfWork` (`@platform/repository`), the runtime opens one
 * transaction, calls `handleAtomic(event, tx)`, then records the processed-marker with that same
 * `tx` — the handler's domain write and the idempotency marker commit or roll back together
 * (upgrading at-least-once delivery to exactly-once *effect*). Handlers that only implement
 * `handle` are entirely unaffected — this must stay opt-in, never a blanket requirement: several
 * existing handlers make external network calls with no DB write to make atomic in the first
 * place, and wrapping those in an open Postgres transaction would hold a connection across
 * arbitrary-latency vendor calls for zero correctness benefit.
 */
export interface EventHandler<TPayload, TContext = unknown> {
  readonly eventType: string;
  readonly eventVersion: number;
  handle(event: IntegrationEvent<TPayload>): Promise<void>;
  handleAtomic?(event: IntegrationEvent<TPayload>, tx: TContext): Promise<void>;
}
