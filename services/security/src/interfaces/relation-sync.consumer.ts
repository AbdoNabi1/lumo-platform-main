import type { IntegrationEvent } from "@platform/domain-events";
import type { EventHandler } from "@platform/messaging";
import type { Logger } from "@platform/utils";
import type { RelationshipSyncPort } from "../application/authz-ports";
import { RelationTuple } from "../domain/relationship";

/** Payload of the `security.relation.*` integration events (the `SecurityChanged` data; `key` = tuple key). */
export interface SecurityRelationPayload {
  readonly key: string;
}

export interface RelationSyncConsumerDeps {
  readonly sync: RelationshipSyncPort;
  readonly logger: Logger;
}

/**
 * **Relationship synchronization** (H-2 / G-SEC-4) — projects Security's ReBAC *decisions* into the
 * enforcement point via the {@link RelationshipSyncPort} (Ory **Keto** in production). Security decides
 * against its local tuple store and emits `security.relation.written`; this consumer mirrors the tuple
 * into enforcement so a `CheckAccess` decision and live enforcement stay in lockstep. One-way sync,
 * decide/enforce split (ADR-0023) — no duplicate enforcement store. Security stays Ory-agnostic: the
 * consumer depends only on the in-context port; the Keto adapter is wired in the runtime.
 *
 * Idempotency (ADR-0005): Keto `PUT` is an upsert, so a redelivered write re-applies the same tuple. A
 * malformed key (never produced by the domain's `key()`) is logged and skipped, not retried.
 */
export class RelationWrittenConsumer implements EventHandler<SecurityRelationPayload> {
  readonly eventType = "security.relation.written";
  readonly eventVersion = 1;
  private readonly deps: RelationSyncConsumerDeps;

  constructor(deps: RelationSyncConsumerDeps) {
    this.deps = deps;
  }

  async handle(event: IntegrationEvent<SecurityRelationPayload>): Promise<void> {
    const parsed = RelationTuple.parseKey(event.payload.key);
    if (parsed === null) {
      this.deps.logger.warn("relation.written with unparseable tuple key — skipping", {
        messageId: event.messageId,
        key: event.payload.key,
      });
      return;
    }
    await this.deps.sync.write(parsed);
  }
}

/**
 * The delete half of relationship synchronization (H-2) — removes the enforcement tuple when Security
 * deletes its decision tuple (`security.relation.deleted`). Keto `DELETE` of an absent tuple is
 * idempotent success, so redelivery is safe.
 */
export class RelationDeletedConsumer implements EventHandler<SecurityRelationPayload> {
  readonly eventType = "security.relation.deleted";
  readonly eventVersion = 1;
  private readonly deps: RelationSyncConsumerDeps;

  constructor(deps: RelationSyncConsumerDeps) {
    this.deps = deps;
  }

  async handle(event: IntegrationEvent<SecurityRelationPayload>): Promise<void> {
    const parsed = RelationTuple.parseKey(event.payload.key);
    if (parsed === null) {
      this.deps.logger.warn("relation.deleted with unparseable tuple key — skipping", {
        messageId: event.messageId,
        key: event.payload.key,
      });
      return;
    }
    await this.deps.sync.delete(parsed);
  }
}
