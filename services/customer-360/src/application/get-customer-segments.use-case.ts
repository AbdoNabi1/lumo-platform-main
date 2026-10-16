import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { mergeCustomerSegments } from "../domain/segment-views";
import { toCustomerSegment, type CustomerSegment } from "../domain/customer-segment";
import type { SegmentMembership } from "../domain/segment-membership";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentStore } from "../ports/segment-store";
import type { ResolveIdentity } from "./resolve-identity.use-case";

export interface GetCustomerSegmentsInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
}

export interface GetCustomerSegmentsOutput {
  readonly segment: CustomerSegment;
  /** Every identifier whose own memberships contributed to the merged view — just the seed identifier
   * when it has no resolved cluster. */
  readonly mergedFrom: readonly IdentifierRef[];
}

export interface GetCustomerSegmentsDeps {
  readonly segments: SegmentStore;
  /** Reused, not reimplemented — same "never a second identity-stitching implementation" rule
   * `GetComputedAttributes`/`GetCustomerProfile` already follow. */
  readonly resolveIdentity: ResolveIdentity;
}

/**
 * The Segmentation Engine's one read API — the Phase 6.5 analogue of `GetComputedAttributes`.
 * Resolves the identifier's identity cluster, loads each member's own stored memberships via
 * `SegmentStore.listForIdentifier` (not a single `getCurrent` call — this store is keyed
 * per-membership, not per-identifier; `SEGMENTATION_MODEL.md` §2), and merges them into one unified
 * view (`mergeCustomerSegments`).
 */
export class GetCustomerSegments implements UseCase<
  GetCustomerSegmentsInput,
  GetCustomerSegmentsOutput,
  DomainError
> {
  private readonly deps: GetCustomerSegmentsDeps;

  constructor(deps: GetCustomerSegmentsDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetCustomerSegmentsInput,
  ): Promise<Result<GetCustomerSegmentsOutput, DomainError>> {
    const resolved = await this.deps.resolveIdentity.execute({
      tenantId: input.tenantId,
      type: input.identifier.type,
      value: input.identifier.value,
    });
    if (!resolved.ok) return resolved;

    const members: readonly IdentifierRef[] =
      resolved.value.cluster === null
        ? [input.identifier]
        : resolved.value.cluster.resolved.members.map((member) => ({
            type: member.type,
            value: member.value,
          }));

    const memberSegments: CustomerSegment[] = [];
    const contributedBy: IdentifierRef[] = [];
    for (const member of members) {
      const memberships: readonly SegmentMembership[] = await this.deps.segments.listForIdentifier(
        member,
        input.tenantId,
      );
      if (memberships.length > 0) {
        memberSegments.push(toCustomerSegment(member.type, member.value, memberships));
        contributedBy.push(member);
      }
    }

    if (memberSegments.length === 0) {
      return ok({
        segment: toCustomerSegment(input.identifier.type, input.identifier.value, []),
        mergedFrom: [],
      });
    }

    const merged =
      memberSegments.length === 1 && memberSegments[0] !== undefined
        ? memberSegments[0]
        : mergeCustomerSegments(memberSegments, input.identifier.type, input.identifier.value);

    return ok({ segment: merged, mergedFrom: contributedBy });
  }
}
