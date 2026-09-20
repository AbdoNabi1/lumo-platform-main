import type { IntegrationEvent } from "@platform/domain-events";
import type { EventHandler } from "@platform/messaging";
import type { Logger } from "@platform/utils";
import type { RelationshipSyncPort } from "../application/authz-ports";
import { RelationTuple, type RelationTupleProps } from "../domain/relationship";

/** Payload of the `security.relation.*` integration events (the `SecurityChanged` data; `key` = tuple key). */
export interface SecurityRelationPayload {
  readonly key: string;
}

export interface RelationSyncConsumerDeps {
  readonly sync: RelationshipSyncPort;
  readonly logger: Logger;
}

/**
 * The tenant-qualified twin of an enforcement tuple (G-70): the object becomes
 * `tenant/<tenantId>/<object>`; namespace, relation and subject are unchanged (principal ids are
 * globally unique Kratos ids, so the subject stays bare). This is the shape `KetoAccessControl` and
 * `KetoRelationshipCheck` read once reads are switched; `scripts/ops/lib/keto-tenant-tuples.mjs` and
 * `packages/auth/src/keto.ts` build the same string and a test pins them together.
 */
export function tenantQualifiedTuple(
  tuple: RelationTupleProps,
  tenantId: string,
): RelationTupleProps {
  return { ...tuple, object: `tenant/${tenantId}/${tuple.object}` };
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
 *
 * **Tenant scoping (G-70, expand phase).** Each tuple is written TWICE: bare (what live reads still
 * checked until the switch) and tenant-qualified (`tenant/<tenantId>/<object>`), the tenant taken from
 * the event envelope (`event.tenantId`). The bare write is removed from this class in the contract
 * step, after the operator migration has run. `IntegrationEvent.tenantId` is optional on the type; when
 * it is absent NOTHING is written — not even the bare tuple — and a warning is logged. A silent bare
 * write is exactly the global grant G-70 is closing, so an untenanted event fails closed (a grant not
 * applied, never a grant applied to every tenant).
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
    const tenantId = event.tenantId;
    if (tenantId === undefined || tenantId === "") {
      this.deps.logger.warn(
        "relation.written has no tenant on the envelope — skipping (fail closed)",
        { messageId: event.messageId, key: event.payload.key },
      );
      return;
    }
    // Bare first, then qualified. A failure between the two throws and the message is redelivered;
    // both PUTs are upserts, so the retry converges.
    await this.deps.sync.write(parsed);
    await this.deps.sync.write(tenantQualifiedTuple(parsed, tenantId));
  }
}

/**
 * The delete half of relationship synchronization (H-2) — removes the enforcement tuple when Security
 * deletes its decision tuple (`security.relation.deleted`). Keto `DELETE` of an absent tuple is
 * idempotent success, so redelivery is safe.
 *
 * **Both twins are removed** (G-70): a delete that removed only the bare tuple would leave the
 * tenant-qualified grant live — a revocation that does not revoke. When the envelope carries no tenant
 * the qualified twin cannot be named: the bare tuple is still deleted (that only ever narrows access,
 * and is what this handler did before G-70) and a warning says the qualified twin was NOT removed.
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
    const tenantId = event.tenantId;
    if (tenantId === undefined || tenantId === "") {
      this.deps.logger.warn(
        "relation.deleted has no tenant on the envelope — bare tuple deleted, qualified twin NOT removed",
        { messageId: event.messageId, key: event.payload.key },
      );
      return;
    }
    await this.deps.sync.delete(tenantQualifiedTuple(parsed, tenantId));
  }
}
