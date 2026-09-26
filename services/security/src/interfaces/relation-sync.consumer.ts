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
 * `KetoRelationshipCheck` read once reads are switched; `scripts/ops/keto-tenant-tuples.mjs` and
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
 * **Tenant scoping (G-70, contracted 2026-09-21).** Only the tenant-qualified tuple
 * (`tenant/<tenantId>/<object>`) is written, the tenant taken from the event envelope
 * (`event.tenantId`). The bare twin was dropped once the live migration had run and been verified
 * (docs/operations/KETO_TENANT_MIGRATION.md). `IntegrationEvent.tenantId` is required on the type (G-64) but the wire can still omit it; when
 * it is absent NOTHING is written and a warning is logged — a grant not applied, never a grant applied
 * to every tenant.
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
    await this.deps.sync.write(tenantQualifiedTuple(parsed, tenantId));
  }
}

/**
 * The delete half of relationship synchronization (H-2) — removes the enforcement tuple when Security
 * deletes its decision tuple (`security.relation.deleted`). Keto `DELETE` of an absent tuple is
 * idempotent success, so redelivery is safe.
 *
 * **The tenant-qualified tuple is the one removed** (G-70) — reads check only that object. The bare
 * object is also deleted, as a sweep: none should exist after the migration, and deleting an absent
 * tuple is idempotent success.
 *
 * **An envelope with no tenant THROWS.** The enforcement tuple cannot be named, so the revocation cannot
 * be applied, and acknowledging the message would leave the grant live with only a log line to show for
 * it. This is the opposite of the write path's skip: a skipped write denies, a skipped delete allows.
 * Throwing hands the message to the retry/DLQ pipeline, where it stays visible until someone acts.
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
    const tenantId = event.tenantId;
    if (tenantId === undefined || tenantId === "") {
      this.deps.logger.error(
        "relation.deleted has no tenant on the envelope — the revocation was NOT applied",
        { messageId: event.messageId, key: event.payload.key },
      );
      throw new Error(
        `relation.deleted ${event.messageId}: no tenant on the envelope, so the tenant-qualified grant cannot be revoked`,
      );
    }
    await this.deps.sync.delete(tenantQualifiedTuple(parsed, tenantId));
    await this.deps.sync.delete(parsed);
  }
}
