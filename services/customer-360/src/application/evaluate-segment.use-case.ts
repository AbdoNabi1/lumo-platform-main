import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import type { EvaluationContext } from "@platform/expression";
import { evaluateRuleSet, matchedRuleIds } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { AttributeValue } from "../domain/attribute-value";
import type { AttributeInputProvenance } from "../ports/attribute-evaluation";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentDefinition } from "../ports/segment-definition";
import type { SegmentEvaluationResult } from "../ports/segment-evaluation";
import type { GetComputedAttributes } from "./get-computed-attributes.use-case";
import type { GetCustomerProfile } from "./get-customer-profile.use-case";
import type { GetJourneyState } from "./get-journey-state.use-case";

export interface EvaluateSegmentInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
  readonly definition: SegmentDefinition;
}

export interface EvaluateSegmentOutput {
  readonly result: SegmentEvaluationResult;
}

export interface EvaluateSegmentDeps {
  /** Reused, not reimplemented — same "never a second read path" rule `EvaluateComputedAttribute`
   * already follows. */
  readonly getCustomerProfile: GetCustomerProfile;
  readonly getJourneyState: GetJourneyState;
  /** Reused for the `attributes.*` namespace — the **full** cluster-merged computed-attribute set,
   * not a declared-dependency-filtered subset (segments have no `dependencies` field to filter by;
   * `SEGMENTATION_MODEL.md` §4/§5 explains why). */
  readonly getComputedAttributes: GetComputedAttributes;
  readonly clock: Clock;
}

function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  return undefined;
}

/**
 * Evaluates **one** {@link SegmentDefinition} for one identifier — pure with respect to persistence
 * (no write to `SegmentStore`/`SegmentHistoryStore`; that is `UpdateSegmentMembershipProjection`'s
 * job). Builds the evaluation context from the pipeline the brief specifies — ResolveIdentity (inside
 * `GetCustomerProfile`/`GetComputedAttributes`) → Profile → Journey → Computed Attributes — then hands
 * the whole thing to `@platform/rules`' `evaluateRuleSet`, the **only** place a condition is
 * interpreted anywhere in this engine (ADR-0053): no bespoke membership-scoring logic lives here, only
 * context assembly, exactly mirroring `EvaluateComputedAttribute`'s own role.
 */
export class EvaluateSegment implements UseCase<
  EvaluateSegmentInput,
  EvaluateSegmentOutput,
  DomainError
> {
  private readonly deps: EvaluateSegmentDeps;

  constructor(deps: EvaluateSegmentDeps) {
    this.deps = deps;
  }

  async execute(input: EvaluateSegmentInput): Promise<Result<EvaluateSegmentOutput, DomainError>> {
    const now = this.deps.clock.now().toISOString();

    const profileResult = await this.deps.getCustomerProfile.execute({
      tenantId: input.tenantId,
      identifier: input.identifier,
      now,
    });
    if (!profileResult.ok) return profileResult;

    const profileFacts = new Map<string, AttributeValue>();
    const contributingSources = new Map<string, AttributeInputProvenance>();
    if (profileResult.value.profile !== null) {
      for (const [name, field] of profileResult.value.profile.fields) {
        const scalar = toAttributeValue(field.value);
        if (scalar !== undefined) {
          profileFacts.set(name, scalar);
          contributingSources.set(`profile.${name}`, {
            source: field.source,
            observedAt: field.updatedAt,
          });
        }
      }
    }

    const journeyFacts = new Map<string, AttributeValue>();
    if (input.identifier.type === "visitor_id") {
      const journeyResult = await this.deps.getJourneyState.execute({
        tenantId: input.tenantId,
        visitorId: input.identifier.value,
      });
      if (journeyResult.ok) {
        const { state } = journeyResult.value;
        journeyFacts.set("sessionCount", state.sessionCount);
        journeyFacts.set("identified", state.identified);
        journeyFacts.set("hasCurrentSession", state.currentSessionId !== undefined);
      }
    }

    const attributesResult = await this.deps.getComputedAttributes.execute({
      tenantId: input.tenantId,
      identifier: input.identifier,
      now,
    });
    if (!attributesResult.ok) return attributesResult;

    const attributeFacts = new Map<string, AttributeValue>();
    if (attributesResult.value.attribute !== null) {
      for (const [id, value] of attributesResult.value.attribute.attributes) {
        attributeFacts.set(id, value.value);
      }
    }

    const inputs = new Map<string, AttributeValue>();
    for (const [name, value] of profileFacts) inputs.set(`profile.${name}`, value);
    for (const [name, value] of journeyFacts) inputs.set(`journey.${name}`, value);
    for (const [id, value] of attributeFacts) inputs.set(`attributes.${id}`, value);

    const context: EvaluationContext = {
      profile: Object.fromEntries(profileFacts),
      journey: Object.fromEntries(journeyFacts),
      attributes: Object.fromEntries(attributeFacts),
    };

    const evaluation = evaluateRuleSet(input.definition.ruleSet, context);

    const result: SegmentEvaluationResult = {
      identifier: input.identifier,
      segmentId: input.definition.id,
      definitionId: input.definition.id,
      definitionVersion: input.definition.version,
      isMember: evaluation.outcomes[0] ?? false,
      matchedRuleIds: matchedRuleIds(evaluation),
      usedFallback: evaluation.usedFallback,
      degraded: evaluation.degraded,
      ruleTrace: evaluation.trace,
      inputs,
      contributingSources,
      source: `segment:${input.definition.id}`,
      evaluatedAt: now,
    };

    return ok({ result });
  }
}
