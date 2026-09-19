import type { IntegrationEvent } from "@platform/domain-events";
import type { EventHandler } from "@platform/messaging";
import type { Logger } from "@platform/utils";
import type { ConsentProjectionStore } from "../application/ports";

/**
 * Payload of `identity.customer.consent_changed.v1` (produced by the Identity context; ADR-0006
 * PII-minimized — carries the scope + grant flag, never the customer's PII). The consenting subject is
 * the envelope `aggregateId` (the Identity customer id), not the payload.
 */
export interface ConsentChangedPayload {
  readonly scope: string;
  readonly granted: boolean;
}

export interface ConsentChangedConsumerDeps {
  readonly store: ConsentProjectionStore;
  readonly logger: Logger;
  /**
   * ADR-0014 (WP-10, T10.3): the projection store takes `tenantId` per call. Until `tenantId` is
   * required on the event envelope (G-64) the composition root supplies it, exactly as the other
   * event consumers in `apps/runtime` do; reading the envelope tenant per message is the separate
   * G-64 fix.
   */
  readonly tenantId: string;
}

/**
 * Wires **consent read to Identity events** (H-2 / G-SEC-4). Consumes Identity's
 * `identity.customer.consent_changed` and projects it into Security's local consent read model, which
 * the {@link ProjectionConsentPort} answers from. Identity remains the owner of consent — this consumer
 * only maintains a read-optimised copy; it never emits or re-owns consent.
 *
 * Idempotency & ordering (at-least-once delivery, ADR-0005): the store upsert is last-writer-wins by
 * the event `occurredAt`, so a redelivered or out-of-order event is a no-op / never regresses a newer
 * decision. The handler therefore tolerates duplicates without any extra bookkeeping.
 */
export class ConsentChangedConsumer implements EventHandler<ConsentChangedPayload> {
  readonly eventType = "identity.customer.consent_changed";
  readonly eventVersion = 1;
  private readonly deps: ConsentChangedConsumerDeps;

  constructor(deps: ConsentChangedConsumerDeps) {
    this.deps = deps;
  }

  async handle(event: IntegrationEvent<ConsentChangedPayload>): Promise<void> {
    const subjectRef = event.aggregateId;
    if (subjectRef.length === 0 || event.payload.scope.length === 0) {
      // A malformed event has no actionable subject/scope — record and skip (not retryable).
      this.deps.logger.warn("consent_changed event missing subject or scope — skipping", {
        messageId: event.messageId,
      });
      return;
    }
    await this.deps.store.upsert(
      {
        subjectRef,
        purpose: event.payload.scope,
        granted: event.payload.granted,
        occurredAt: event.occurredAt,
      },
      this.deps.tenantId,
    );
  }
}
