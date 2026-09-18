import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { SegmentMembership, SegmentMembershipStatus } from "../domain/segment-membership";
import type { SegmentStore } from "../ports/segment-store";

export interface GetSegmentMembersInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly segmentId: string;
  /** Defaults to `"entered"` — "who is in this segment right now." */
  readonly status?: SegmentMembershipStatus;
}

export interface GetSegmentMembersOutput {
  readonly members: readonly SegmentMembership[];
}

export interface GetSegmentMembersDeps {
  readonly segments: SegmentStore;
}

/**
 * "Every identifier currently in this segment" — a read shape none of the prior three engines in this
 * context need, and the reason `SegmentStore` is keyed per-membership rather than per-identifier
 * (`SEGMENTATION_MODEL.md` §2/§8). **Deferred**: no cross-identifier dedup to "unique people" — a
 * returned member list is per-identifier, not per-person; deduping would require resolving every
 * member's own identity cluster, real future work not attempted here.
 */
export class GetSegmentMembers implements UseCase<
  GetSegmentMembersInput,
  GetSegmentMembersOutput,
  DomainError
> {
  private readonly deps: GetSegmentMembersDeps;

  constructor(deps: GetSegmentMembersDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetSegmentMembersInput,
  ): Promise<Result<GetSegmentMembersOutput, DomainError>> {
    const members = await this.deps.segments.listMembers(
      input.segmentId,
      input.tenantId,
      input.status ?? "entered",
    );
    return ok({ members });
  }
}
