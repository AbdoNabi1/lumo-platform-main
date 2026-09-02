import type { IdGenerator } from "@platform/contracts";

/**
 * Tracing identity attached to integration events (never to domain events, which stay pure).
 * `correlationId` groups all messages in one logical flow; `causationId` is the id of the
 * message/command that directly caused the events being written.
 */
export interface EventContext {
  readonly correlationId: string;
  readonly causationId: string;
  /** The tenant (merchant/store) the current flow acts for, when known (ADR-0004). */
  readonly tenantId?: string;
}

/** Context for events with no triggering message (e.g. a user-initiated command). */
export function rootEventContext(idGenerator: IdGenerator, tenantId?: string): EventContext {
  const id = idGenerator.generate();
  return { correlationId: id, causationId: id, ...(tenantId !== undefined ? { tenantId } : {}) };
}

/** Context for events produced while handling an incoming integration event (continues the chain). */
export function followOnEventContext(incoming: {
  readonly messageId: string;
  readonly correlationId: string;
  readonly tenantId?: string;
}): EventContext {
  return {
    correlationId: incoming.correlationId,
    causationId: incoming.messageId,
    ...(incoming.tenantId !== undefined ? { tenantId: incoming.tenantId } : {}),
  };
}
