import type { DomainEvent } from "@platform/domain";

/** What a context declares for one of its domain events to become an integration event. */
export interface IntegrationEventDescriptor {
  /** Event type `<context>.<aggregate>.<event>`. */
  readonly type: string;
  readonly eventVersion: number;
  readonly aggregateType: string;
  /** Serializable event body. */
  readonly payload: unknown;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Maps a context's domain event to its integration-event descriptor. Implemented per bounded
 * context so `@platform/domain` stays pure (no `toIntegrationEvent()` on domain events). Returns
 * `undefined` for domain events that are intentionally not published.
 */
export interface IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined;
}
