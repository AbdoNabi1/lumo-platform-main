import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { DomainEvent } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { applyMembershipUpdate, type MembershipTransition } from "../domain/segment-membership";
import { toSnapshot, type SegmentHistoryReason } from "../domain/segment-history";
import { INITIAL_SEGMENT_VERSION } from "../domain/segment-version";
import { CustomerEnteredSegment } from "../events/customer-entered-segment.event";
import { CustomerExitedSegment } from "../events/customer-exited-segment.event";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentEvaluationResult } from "../ports/segment-evaluation";
import type { SegmentHistoryStore } from "../ports/segment-history-store";
import type { SegmentStore } from "../ports/segment-store";

export interface UpdateSegmentMembershipProjectionInput {
  readonly identifier: IdentifierRef;
  /** The output of `EvaluateSegment`/`EvaluateAllSegments` — this use case never evaluates a rule set
   * itself, only persists an already-evaluated result. */
  readonly result: SegmentEvaluationResult;
}

export interface UpdateSegmentMembershipProjectionOutput {
  readonly applied: boolean;
  readonly transition: MembershipTransition;
  readonly version: number;
}

export interface UpdateSegmentMembershipProjectionDeps {
  readonly segments: SegmentStore;
  readonly history: SegmentHistoryStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

function historyReasonFor(transition: MembershipTransition): SegmentHistoryReason {
  // `transition` is only ever "entered" | "exited" | "unchanged" here (this function is only called
  // when `applied` is true); "unchanged" means a definitionVersion-only refresh — recorded as
  // "refreshed", never implying a transition that did not happen (domain/segment-history.ts's module
  // doc).
  return transition === "unchanged" ? "refreshed" : transition;
}

/**
 * Persists one already-evaluated {@link SegmentEvaluationResult} — the only membership write path,
 * mirroring `UpdateComputedAttributeProjection`'s role exactly. Appends a snapshot to the durable
 * history and refreshes the current-view cache in one unit of work, then publishes
 * `CustomerEnteredSegment`/`CustomerExitedSegment` only on a real `transition` — never for an unapplied
 * update, and never for an applied-but-non-transitioning refresh (`SEGMENTATION_MODEL.md` §6).
 *
 * **Optimistic concurrency (ADR-0060).** The cache write is compare-and-swap, run *before* the
 * history-ledger append — a losing race throws `ConcurrencyError` before any snapshot or event is
 * recorded, mirroring `UpdateComputedAttributeProjection`'s own ordering exactly.
 */
export class UpdateSegmentMembershipProjection implements UseCase<
  UpdateSegmentMembershipProjectionInput,
  UpdateSegmentMembershipProjectionOutput,
  DomainError
> {
  private readonly deps: UpdateSegmentMembershipProjectionDeps;

  constructor(deps: UpdateSegmentMembershipProjectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: UpdateSegmentMembershipProjectionInput,
  ): Promise<Result<UpdateSegmentMembershipProjectionOutput, DomainError>> {
    const current = await this.deps.segments.getCurrent(input.identifier, input.result.segmentId);
    const baseVersion = current?.version ?? INITIAL_SEGMENT_VERSION;

    const applyResult = applyMembershipUpdate(
      current,
      input.identifier.type,
      input.identifier.value,
      input.result.segmentId,
      {
        isMember: input.result.isMember,
        definitionId: input.result.definitionId,
        definitionVersion: input.result.definitionVersion,
        matchedRuleIds: input.result.matchedRuleIds,
        inputs: input.result.inputs,
        evaluatedAt: input.result.evaluatedAt,
      },
    );

    if (!applyResult.applied || applyResult.membership === null) {
      return ok({ applied: false, transition: "unchanged", version: baseVersion });
    }

    const membership = applyResult.membership;

    return this.deps.unitOfWork.run<Result<UpdateSegmentMembershipProjectionOutput, DomainError>>(
      async (tx) => {
        const occurredAt = this.deps.clock.now();
        const reason = historyReasonFor(applyResult.transition);
        const snapshot = toSnapshot(membership, reason, occurredAt.toISOString());

        const eventData = {
          identifierType: input.identifier.type,
          identifierValue: input.identifier.value,
          segmentId: input.result.segmentId,
          definitionId: input.result.definitionId,
          definitionVersion: input.result.definitionVersion,
          version: membership.version,
        };
        let event: DomainEvent | undefined;
        if (applyResult.transition === "entered") {
          event = new CustomerEnteredSegment(
            {
              eventId: this.deps.idGenerator.generate(),
              aggregateId: UniqueEntityId.from(input.identifier.value),
              occurredAt,
            },
            eventData,
          );
        } else if (applyResult.transition === "exited") {
          event = new CustomerExitedSegment(
            {
              eventId: this.deps.idGenerator.generate(),
              aggregateId: UniqueEntityId.from(input.identifier.value),
              occurredAt,
            },
            eventData,
          );
        }

        // CAS write first (ADR-0060): on a lost race this throws `ConcurrencyError` here, before the
        // history append below ever runs — no orphaned snapshot, no partial effect.
        await this.deps.segments.saveCurrent(membership, baseVersion, tx);
        await this.deps.history.append(snapshot, event, tx);

        return ok({
          applied: true,
          transition: applyResult.transition,
          version: membership.version,
        });
      },
    );
  }
}
