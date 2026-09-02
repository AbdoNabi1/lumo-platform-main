/**
 * Cross-context integration-event envelope — the wire contract shared between bounded contexts
 * (the only async coupling surface, docs/architecture/02 + 05).
 *
 * Field types are deliberately primitive (strings, an integer version, an RFC 3339 UTC timestamp,
 * and a string→string metadata map) so the envelope maps cleanly onto a future Avro/Protobuf
 * schema with **no migration**. `payload` is the context-defined, serializable body.
 *
 * `messageId` is the originating domain event id (UUIDv7) and doubles as the idempotency key.
 * `correlationId` / `causationId` live **only** here — domain events stay pure (they carry no
 * tracing identity).
 */
export interface IntegrationEvent<TPayload> {
  /** Unique message id (= the domain event id); the consumer idempotency key. */
  readonly messageId: string;
  /** Event type `<context>.<aggregate>.<event>` (e.g. `orders.order.placed`). */
  readonly type: string;
  /** Schema version (the `vN` in the topic); additive-only evolution. */
  readonly eventVersion: number;
  /** The originating aggregate id (partition key). */
  readonly aggregateId: string;
  /** The originating aggregate type (e.g. `order`). */
  readonly aggregateType: string;
  /** When the event occurred, as an RFC 3339 / ISO-8601 UTC string. */
  readonly occurredAt: string;
  /** Correlates all messages in one logical flow. */
  readonly correlationId: string;
  /** The id of the message/command that directly caused this event. */
  readonly causationId: string;
  /**
   * The tenant (merchant/store) this event belongs to, when the platform runs multi-tenant
   * (ADR-0004). Optional today — single-tenant deployments omit it; adding it later to live
   * topics would be a breaking schema change, so the field is reserved now.
   */
  readonly tenantId?: string;
  /** The bounded context that produced the event (e.g. `orders`), for tracing and audit. */
  readonly producer?: string;
  /** Context-defined, serializable event body. */
  readonly payload: TPayload;
  /** Small string→string metadata bag (empty when none). */
  readonly metadata: Readonly<Record<string, string>>;
}
