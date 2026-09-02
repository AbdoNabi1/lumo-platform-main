import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { fromSnapshot, toSnapshot } from "../domain/attribute-snapshot";
import type { ComputedAttribute } from "../domain/computed-attribute";
import { AttributeRebuilt } from "../events/attribute-rebuilt.event";
import type { AttributeHistoryStore } from "../ports/attribute-history-store";
import type { AttributeStore } from "../ports/attribute-store";
import type { IdentifierRef } from "../ports/identity-decision";

export interface RebuildComputedAttributesInput {
  readonly identifier: IdentifierRef;
}

export interface RebuildComputedAttributesOutput {
  /** `null` when the identifier has no history at all — not an error, mirrors
   * `RebuildProfileProjection`'s own "never observed" `null`. */
  readonly attribute: ComputedAttribute | null;
  readonly attributeCount: number;
}

export interface RebuildComputedAttributesDeps {
  readonly attributes: AttributeStore;
  readonly history: AttributeHistoryStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Recomputes the current-view cache (`AttributeStore`) from the durable history ledger — the Phase
 * 6.4 brief's "projection is deletable and fully rebuildable" requirement, exactly mirroring
 * `RebuildProfileProjection`'s role for the Profile Engine. Because every {@link AttributeSnapshot}
 * already captures the *full* attribute set as of its version, "rebuild" here is "read the latest
 * snapshot", not a re-run of any rule set — re-deriving values from scratch by re-evaluating rules is
 * a different operation, `EvaluateAttributeGraph`'s job, not this one's.
 */
export class RebuildComputedAttributes implements UseCase<
  RebuildComputedAttributesInput,
  RebuildComputedAttributesOutput,
  DomainError
> {
  private readonly deps: RebuildComputedAttributesDeps;

  constructor(deps: RebuildComputedAttributesDeps) {
    this.deps = deps;
  }

  async execute(
    input: RebuildComputedAttributesInput,
  ): Promise<Result<RebuildComputedAttributesOutput, DomainError>> {
    const latest = await this.deps.history.latestFor(input.identifier);
    if (latest === null) {
      return ok({ attribute: null, attributeCount: 0 });
    }

    const rebuilt = fromSnapshot(latest);

    return this.deps.unitOfWork.run<Result<RebuildComputedAttributesOutput, DomainError>>(
      async (tx) => {
        // Rebuild-vs-Update race: `latest` was read from the ledger *before* this transaction started,
        // so a concurrent `UpdateComputedAttributeProjection` can commit a newer version (cache + ledger
        // together, same tx) in between. Re-checking the cache here, inside this transaction, catches
        // that: if the cache already moved past `rebuilt`, this rebuild is stale and must not overwrite
        // it — doing so would silently regress the cache and append a "rebuilt" ledger entry, out of
        // order, for data that is no longer current. Undetected, that is the exact silent-lost-update
        // failure shape ADR-0060 closed for Update-vs-Update, reopened here via a different write path.
        const currentCache = await this.deps.attributes.getCurrent(input.identifier, tx);
        if (currentCache !== null && currentCache.version > rebuilt.version) {
          return ok({ attribute: currentCache, attributeCount: currentCache.attributes.size });
        }

        const occurredAt = this.deps.clock.now();
        const snapshot = toSnapshot(rebuilt, "rebuilt", occurredAt.toISOString());

        const event = new AttributeRebuilt(
          {
            eventId: this.deps.idGenerator.generate(),
            aggregateId: UniqueEntityId.from(input.identifier.value),
            occurredAt,
          },
          {
            identifierType: input.identifier.type,
            identifierValue: input.identifier.value,
            attributeCount: rebuilt.attributes.size,
            version: rebuilt.version,
          },
        );

        await this.deps.history.append(snapshot, event, tx);
        // ADR-0060: deliberately no `expectedVersion` — a rebuild's whole point is recovering from a
        // cache whose current version is untrustworthy (missing, corrupted, or stale); CAS-guarding
        // this write would make recovery fail exactly when it's needed most. The staleness check above
        // is what keeps this unconditional overwrite from regressing a cache that has already moved on.
        await this.deps.attributes.saveCurrent(rebuilt, undefined, tx);

        return ok({ attribute: rebuilt, attributeCount: rebuilt.attributes.size });
      },
    );
  }
}
