import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import type { EvaluationContext } from "@platform/expression";
import { evaluateRuleSet, matchedRuleIds } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { AttributeValue } from "../domain/attribute-value";
import type {
  AttributeEvaluationResult,
  AttributeInputProvenance,
} from "../ports/attribute-evaluation";
import type { AttributeStore } from "../ports/attribute-store";
import type { ComputedAttributeDefinition } from "../ports/computed-attribute-definition";
import type { IdentifierRef } from "../ports/identity-decision";
import type { GetCustomerProfile } from "./get-customer-profile.use-case";
import type { GetJourneyState } from "./get-journey-state.use-case";

export interface EvaluateComputedAttributeInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
  readonly definition: ComputedAttributeDefinition;
}

export interface EvaluateComputedAttributeOutput {
  readonly result: AttributeEvaluationResult;
}

export interface EvaluateComputedAttributeDeps {
  /** Reused, not reimplemented — a computed attribute reads the identifier's **merged** profile
   * (every linked identifier's own facts unified), the same "never a second read path over facts
   * this package already assembles" rule `ResolveCurrentSession` follows for sessions. */
  readonly getCustomerProfile: GetCustomerProfile;
  /** Reused for session-derived facts. Only consulted when the identifier is itself a `visitor_id`
   * — resolving journey state across a whole identity cluster for a non-`visitor_id` seed (the way
   * `ResolveCurrentSession` resolves sessions cross-device) is real future-phase work, not attempted
   * here; see the Phase 6.4 report's deferred-work section. */
  readonly getJourneyState: GetJourneyState;
  /** Read-only here — resolves already-evaluated dependency values. Never written by this use case;
   * persistence is `UpdateComputedAttributeProjection`'s job alone. */
  readonly attributes: AttributeStore;
  readonly clock: Clock;
}

function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  // Non-scalar profile field values (arrays/objects) are not usable as rule inputs. Silently
  // excluded rather than an error — a profile field existing that a rule set does not itself
  // reference is completely normal, and even one it does reference simply resolves as
  // `unknown_reference` at evaluation time (`@platform/expression`'s own typed-error path), which is
  // the correct, already-built place for that failure to surface — not a check duplicated here.
  return undefined;
}

/**
 * Evaluates **one** {@link ComputedAttributeDefinition} for one identifier — pure with respect to
 * persistence (no write to `AttributeStore`/`AttributeHistoryStore`; that is
 * `UpdateComputedAttributeProjection`'s job). Builds the evaluation context from three sources —
 * the identifier's merged profile fields (`profile.<field>`), visitor journey state
 * (`journey.<name>`, when applicable), and already-evaluated dependency attributes
 * (`attributes.<id>`) — then hands the whole thing to `@platform/rules`' `evaluateRuleSet`, which is
 * the **only** place a condition is interpreted anywhere in this engine (ADR-0053): no bespoke
 * "how do I compute this score" logic lives here, only context assembly.
 *
 * Determinism (Phase 6.4's explicit requirement) is inherited, not reimplemented: `evaluateRuleSet`
 * and the expression kernel beneath it are pure and total by construction (ADR-0053 §3) — identical
 * `(ruleSet, context)` inputs always yield an identical `AttributeEvaluationResult` here, because
 * every fact the rule set can see was already read into `context` before evaluation begins.
 */
export class EvaluateComputedAttribute implements UseCase<
  EvaluateComputedAttributeInput,
  EvaluateComputedAttributeOutput,
  DomainError
> {
  private readonly deps: EvaluateComputedAttributeDeps;

  constructor(deps: EvaluateComputedAttributeDeps) {
    this.deps = deps;
  }

  async execute(
    input: EvaluateComputedAttributeInput,
  ): Promise<Result<EvaluateComputedAttributeOutput, DomainError>> {
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

    const current = await this.deps.attributes.getCurrent(input.identifier, input.tenantId);
    const dependencyFacts = new Map<string, AttributeValue>();
    for (const dependencyId of input.definition.dependencies) {
      const dependencyValue = current?.attributes.get(dependencyId);
      if (dependencyValue !== undefined) {
        dependencyFacts.set(dependencyId, dependencyValue.value);
      }
    }

    const inputs = new Map<string, AttributeValue>();
    for (const [name, value] of profileFacts) inputs.set(`profile.${name}`, value);
    for (const [name, value] of journeyFacts) inputs.set(`journey.${name}`, value);
    for (const [name, value] of dependencyFacts) inputs.set(`attributes.${name}`, value);

    const context: EvaluationContext = {
      profile: Object.fromEntries(profileFacts),
      journey: Object.fromEntries(journeyFacts),
      attributes: Object.fromEntries(dependencyFacts),
    };

    const evaluation = evaluateRuleSet(input.definition.ruleSet, context);

    const result: AttributeEvaluationResult = {
      identifier: input.identifier,
      definitionId: input.definition.id,
      definitionVersion: input.definition.version,
      value: evaluation.outcomes[0],
      matchedRuleIds: matchedRuleIds(evaluation),
      usedFallback: evaluation.usedFallback,
      degraded: evaluation.degraded,
      ruleTrace: evaluation.trace,
      inputs,
      contributingSources,
      source: `computed-attribute:${input.definition.id}`,
      evaluatedAt: now,
    };

    return ok({ result });
  }
}
