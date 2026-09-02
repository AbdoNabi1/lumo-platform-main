import type { IntegrationEvent } from "@platform/domain-events";
import type { EventHandler } from "@platform/messaging";
import type { Logger } from "@platform/utils";
import type { SessionRevocationPort } from "../application/ports";

/** Payload of `security.session.revoked_all` (the `SecurityChanged` data; `key` = the identity external id). */
export interface SessionRevokedAllPayload {
  readonly key: string;
  readonly status: string;
}

export interface SessionRevokedAllConsumerDeps {
  readonly sessionRevocation: SessionRevocationPort;
  readonly logger: Logger;
}

/**
 * **Session synchronization** (H-2 / G-SEC-4) — propagates a Security "revoke all sessions for a
 * principal" decision (`security.session.revoked_all`, `key` = the identity's external id) to Ory
 * **Kratos**, the session enforcement point, so a compromise-response / force-logout actually kills
 * the identity's live Kratos sessions. Security owns the session *lifecycle*; Kratos owns token
 * validity — this consumer keeps them consistent.
 *
 * Durability & idempotency (ADR-0005): the event is delivered at-least-once; `revokeAllForIdentity`
 * is naturally idempotent (revoking already-revoked sessions is a no-op), and a Kratos failure throws
 * so the retry/DLQ pipeline re-drives the revocation — a dropped logout is never acceptable.
 */
export class SessionRevokedAllConsumer implements EventHandler<SessionRevokedAllPayload> {
  readonly eventType = "security.session.revoked_all";
  readonly eventVersion = 1;
  private readonly deps: SessionRevokedAllConsumerDeps;

  constructor(deps: SessionRevokedAllConsumerDeps) {
    this.deps = deps;
  }

  async handle(event: IntegrationEvent<SessionRevokedAllPayload>): Promise<void> {
    const externalIdentityId = event.payload.key;
    if (externalIdentityId.length === 0) {
      this.deps.logger.warn("session.revoked_all missing identity external id — skipping", {
        messageId: event.messageId,
      });
      return;
    }
    await this.deps.sessionRevocation.revokeAllForIdentity(externalIdentityId);
  }
}
