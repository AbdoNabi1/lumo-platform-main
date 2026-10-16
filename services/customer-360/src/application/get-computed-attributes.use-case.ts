import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { mergeComputedAttributes } from "../domain/computed-attribute-views";
import type { ComputedAttribute } from "../domain/computed-attribute";
import type { AttributeStore } from "../ports/attribute-store";
import type { IdentifierRef } from "../ports/identity-decision";
import type { ResolveIdentity } from "./resolve-identity.use-case";

export interface GetComputedAttributesInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
  /** "Now", used only as the merged view's `updatedAt` fallback when every cluster member's own
   * attribute set is itself empty — supplied by the caller so this stays deterministic/testable,
   * same convention `GetCustomerProfile.now` already establishes. */
  readonly now: string;
}

export interface GetComputedAttributesOutput {
  /** `null` when neither this identifier nor anything in its resolved cluster has any computed
   * attribute yet. */
  readonly attribute: ComputedAttribute | null;
  /** Every identifier whose own attribute set contributed to the merged view — just the seed
   * identifier when it has no resolved cluster. */
  readonly mergedFrom: readonly IdentifierRef[];
}

export interface GetComputedAttributesDeps {
  readonly attributes: AttributeStore;
  /** Reused, not reimplemented — same "never a second identity-stitching implementation" rule
   * `GetCustomerProfile`/`ResolveCurrentSession` already follow. */
  readonly resolveIdentity: ResolveIdentity;
}

/**
 * The Computed Attributes Engine's one read API — the Phase 6.4 analogue of `GetCustomerProfile`.
 * Resolves the identifier's identity cluster, loads each member's own stored attribute set, and
 * merges them into one unified view (`mergeComputedAttributes`). Every named attribute's own
 * {@link ComputedAttributeValue} already carries its full explainability record (`matchedRuleIds`,
 * `inputs`, `definitionId`/`definitionVersion`, `evaluatedAt`) — so answering "why is this attribute
 * what it is" never requires a separate use case or a live rule-set replay, only reading the value
 * this one already returns.
 */
export class GetComputedAttributes implements UseCase<
  GetComputedAttributesInput,
  GetComputedAttributesOutput,
  DomainError
> {
  private readonly deps: GetComputedAttributesDeps;

  constructor(deps: GetComputedAttributesDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetComputedAttributesInput,
  ): Promise<Result<GetComputedAttributesOutput, DomainError>> {
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

    const memberAttributes: ComputedAttribute[] = [];
    const contributedBy: IdentifierRef[] = [];
    for (const member of members) {
      const attribute = await this.deps.attributes.getCurrent(member, input.tenantId);
      if (attribute !== null) {
        memberAttributes.push(attribute);
        contributedBy.push(member);
      }
    }

    if (memberAttributes.length === 0) {
      return ok({ attribute: null, mergedFrom: [] });
    }

    const merged =
      memberAttributes.length === 1 && memberAttributes[0] !== undefined
        ? memberAttributes[0]
        : mergeComputedAttributes(
            memberAttributes,
            input.identifier.type,
            input.identifier.value,
            input.now,
          );

    return ok({ attribute: merged, mergedFrom: contributedBy });
  }
}
