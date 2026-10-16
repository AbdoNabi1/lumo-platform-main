import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { fromSnapshot, toSnapshot } from "../domain/segment-history";
import type { SegmentMembership } from "../domain/segment-membership";
import { MembershipRebuilt } from "../events/membership-rebuilt.event";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentHistoryStore } from "../ports/segment-history-store";
import type { SegmentStore } from "../ports/segment-store";

export interface RebuildSegmentMembershipInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
  readonly segmentId: string;
}

export interface RebuildSegmentMembershipOutput {
  /** `null` when the `(identifier, segmentId)` pair has no history at all — not an error, mirrors
   * `RebuildComputedAttributes`' own "never observed" `null`. */
  readonly membership: SegmentMembership | null;
}

export interface RebuildSegmentMembershipDeps {
  readonly segments: SegmentStore;
  readonly history: SegmentHistoryStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Recomputes one `(identifier, segmentId)` cache row (`SegmentStore`) from the durable history ledger
 * — the brief's "projection is deletable and fully rebuildable" requirement, exactly mirroring
 * `RebuildComputedAttributes`'s role. Because every `SegmentHistoryEntry` already captures the *full*
 * row as of its version, "rebuild" here is "read the latest entry", never a re-run of any rule set.
 */
export class RebuildSegmentMembership implements UseCase<
  RebuildSegmentMembershipInput,
  RebuildSegmentMembershipOutput,
  DomainError
> {
  private readonly deps: RebuildSegmentMembershipDeps;

  constructor(deps: RebuildSegmentMembershipDeps) {
    this.deps = deps;
  }

  async execute(
    input: RebuildSegmentMembershipInput,
  ): Promise<Result<RebuildSegmentMembershipOutput, DomainError>> {
    const latest = await this.deps.history.latestFor(
      input.identifier,
      input.segmentId,
      input.tenantId,
    );
    if (latest === null) {
      return ok({ membership: null });
    }

    const rebuilt = fromSnapshot(latest);

    return this.deps.unitOfWork.run<Result<RebuildSegmentMembershipOutput, DomainError>>(
      async (tx) => {
        // Rebuild-vs-Update race, same as RebuildComputedAttributes: `latest` was read before this
        // transaction started, so a concurrent `UpdateSegmentMembershipProjection` can commit a newer
        // version in between. Re-checking the cache here, inside this transaction, catches that.
        const currentCache = await this.deps.segments.getCurrent(
          input.identifier,
          input.segmentId,
          input.tenantId,
          tx,
        );
        if (currentCache !== null && currentCache.version > rebuilt.version) {
          return ok({ membership: currentCache });
        }

        const occurredAt = this.deps.clock.now();
        const snapshot = toSnapshot(rebuilt, "rebuilt", occurredAt.toISOString());

        const event = new MembershipRebuilt(
          {
            eventId: this.deps.idGenerator.generate(),
            aggregateId: UniqueEntityId.from(input.identifier.value),
            occurredAt,
          },
          {
            identifierType: input.identifier.type,
            identifierValue: input.identifier.value,
            segmentId: input.segmentId,
            status: rebuilt.status,
            version: rebuilt.version,
          },
        );

        await this.deps.history.append(snapshot, input.tenantId, event, tx);
        // ADR-0060: deliberately no `expectedVersion` — same recovery-must-not-be-CAS-blocked reasoning
        // `RebuildComputedAttributes` documents. The staleness check above is what keeps this
        // unconditional overwrite from regressing a cache that has already moved on.
        await this.deps.segments.saveCurrent(rebuilt, input.tenantId, undefined, tx);

        return ok({ membership: rebuilt });
      },
    );
  }
}
