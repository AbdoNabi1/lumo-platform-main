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
   * The tenant (merchant/store) this event belongs to (ADR-0004, ADR-0014). **Required** (G-64):
   * every consumer routes its writes by this value and never by a deployment default, because under
   * `TENANT_MODE=multi` a message with no tenant cannot be attributed to anyone. It was reserved as
   * optional while nothing consumed it; making it required before any topic went live cost no
   * expand/contract. Off the wire it can still be absent or blank (an old row, a foreign producer),
   * so consumers read it through {@link readEnvelopeTenant} and decide which way to fail.
   */
  readonly tenantId: string;
  /** The bounded context that produced the event (e.g. `orders`), for tracing and audit. */
  readonly producer?: string;
  /** Context-defined, serializable event body. */
  readonly payload: TPayload;
  /** Small string→string metadata bag (empty when none). */
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * The tenant an envelope carries, or `null` when it carries none a consumer can act on (absent,
 * blank, or not a string — the type says required, the wire does not).
 *
 * Returns `null` rather than throwing because the correct failure depends on the handler: a
 * consumer that ADDS something refuses the write, one that REMOVES protection must throw to the DLQ
 * (see `RelationDeletedConsumer`: a skipped write denies, a skipped delete allows). There is
 * deliberately no default parameter — a missing tenant is never replaced by a guess.
 */
export function readEnvelopeTenant(event: { readonly tenantId?: unknown }): string | null {
  const { tenantId } = event;
  return typeof tenantId === "string" && tenantId.trim() !== "" ? tenantId : null;
}

/**
 * Thrown by {@link requireEnvelopeTenant}. A consumer that lets it escape hands the message to the
 * retry/DLQ pipeline, where it stays visible until an operator acts.
 */
export class MissingEnvelopeTenantError extends Error {
  constructor(consumer: string, event: { readonly type: string; readonly messageId: string }) {
    super(
      `${consumer}: "${event.type}" message ${event.messageId} carries no tenantId on its envelope — ` +
        "refusing to guess one (G-64)",
    );
    this.name = "MissingEnvelopeTenantError";
  }
}

/**
 * The envelope's tenant, or a {@link MissingEnvelopeTenantError}. For handlers whose failure
 * direction is "throw to the DLQ" (ledger postings, payment truth, and anything that removes
 * standing). Handlers that refuse instead call {@link readEnvelopeTenant} and skip loudly.
 */
export function requireEnvelopeTenant(
  event: { readonly tenantId?: unknown; readonly type: string; readonly messageId: string },
  consumer: string,
): string {
  const tenantId = readEnvelopeTenant(event);
  if (tenantId === null) throw new MissingEnvelopeTenantError(consumer, event);
  return tenantId;
}
