import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentDefinitionRegistry } from "../ports/segment-definition-registry";
import type { SegmentStore } from "../ports/segment-store";
import type { EvaluateAllSegments } from "./evaluate-all-segments.use-case";

export interface SegmentMembershipWorkerInput {
  /** The tenant this sweep is scoped to (ADR-0014). */
  readonly tenantId: string;
}

export interface SegmentMembershipWorkerOutput {
  readonly evaluated: number;
  readonly failed: number;
}

export interface SegmentMembershipWorkerDeps {
  readonly segments: SegmentStore;
  readonly definitions: SegmentDefinitionRegistry;
  readonly evaluateAll: EvaluateAllSegments;
}

function identifierKey(identifier: IdentifierRef): string {
  return `${identifier.type}:${identifier.value}`;
}

/**
 * Periodically re-evaluates every known identifier against the **full** registered segment set —
 * genuinely new relative to the Phase 6.4 template, not a renamed copy of
 * `ComputedAttributeProjectionWorker`. Computed Attributes' incremental model assumes nothing drifts
 * without an upstream fact write; that assumption is false for time-windowed segment conditions
 * (e.g. `journey.daysSinceLastOrder > 90`, which can flip purely from time passing, with no
 * `ProfileUpdated`/`AttributeUpdated`/session event ever occurring to trigger
 * `RecalculateMemberships`). This worker exists specifically to catch that class of drift
 * (`SEGMENTATION_MODEL.md` §9) — it re-evaluates, it does not merely rebuild a cache from history the
 * way `SegmentProjectionWorker` does. One identifier's failure never aborts the sweep.
 */
export class SegmentMembershipWorker implements UseCase<
  SegmentMembershipWorkerInput,
  SegmentMembershipWorkerOutput,
  DomainError
> {
  private readonly deps: SegmentMembershipWorkerDeps;

  constructor(deps: SegmentMembershipWorkerDeps) {
    this.deps = deps;
  }

  async execute(
    input: SegmentMembershipWorkerInput,
  ): Promise<Result<SegmentMembershipWorkerOutput, DomainError>> {
    const pairs = await this.deps.segments.listIdentifiers(input.tenantId);
    const identifiers = new Map<string, IdentifierRef>();
    for (const pair of pairs) {
      identifiers.set(identifierKey(pair.identifier), pair.identifier);
    }

    const definitions = await this.deps.definitions.list(input.tenantId);
    let evaluated = 0;
    let failed = 0;

    for (const identifier of identifiers.values()) {
      try {
        const result = await this.deps.evaluateAll.execute({
          tenantId: input.tenantId,
          identifier,
          definitions,
        });
        if (result.ok) evaluated += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    return ok({ evaluated, failed });
  }
}
