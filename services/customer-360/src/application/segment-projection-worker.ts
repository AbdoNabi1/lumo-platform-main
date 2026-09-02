import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { SegmentStore } from "../ports/segment-store";
import type { RebuildSegmentMembership } from "./rebuild-segment-membership.use-case";

export type SegmentProjectionWorkerInput = Record<string, never>;

export interface SegmentProjectionWorkerOutput {
  readonly rebuilt: number;
  readonly failed: number;
}

export interface SegmentProjectionWorkerDeps {
  readonly segments: SegmentStore;
  readonly rebuild: RebuildSegmentMembership;
}

/**
 * Batch-rebuilds every known `(identifier, segmentId)` cache row from history — the scheduled-job
 * shape of `RebuildSegmentMembership`, exactly mirroring `ComputedAttributeProjectionWorker`. Pure
 * recovery: no rule re-evaluation (see `SegmentMembershipWorker` for the re-evaluation sweep this
 * worker deliberately does not do). One row's failure never aborts the batch.
 */
export class SegmentProjectionWorker implements UseCase<
  SegmentProjectionWorkerInput,
  SegmentProjectionWorkerOutput,
  DomainError
> {
  private readonly deps: SegmentProjectionWorkerDeps;

  constructor(deps: SegmentProjectionWorkerDeps) {
    this.deps = deps;
  }

  async execute(
    _input: SegmentProjectionWorkerInput,
  ): Promise<Result<SegmentProjectionWorkerOutput, DomainError>> {
    const pairs = await this.deps.segments.listIdentifiers();
    let rebuilt = 0;
    let failed = 0;

    for (const pair of pairs) {
      try {
        const result = await this.deps.rebuild.execute({
          identifier: pair.identifier,
          segmentId: pair.segmentId,
        });
        if (result.ok) rebuilt += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    return ok({ rebuilt, failed });
  }
}
