import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { CustomerProfile } from "../domain/customer-profile";
import {
  mergeProfiles,
  profileCompleteness,
  profileConfidenceSummary,
  profileFieldSources,
  profileFreshness,
  type ProfileConfidenceSummary,
} from "../domain/profile-views";
import type { IdentifierRef } from "../ports/identity-decision";
import type { ProfileStore } from "../ports/profile-store";
import type { ResolveIdentity } from "./resolve-identity.use-case";

export interface GetCustomerProfileInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
  /** Field names the caller expects, for the Completeness view; omitted ⇒ completeness reads `null`,
   * not a misleading default set the Profile Engine has no business guessing. */
  readonly expectedFields?: readonly string[];
  /** "Now", for the Freshness view — supplied by the caller so this stays deterministic/testable
   * rather than reaching for a wall clock internally. */
  readonly now: string;
}

export interface GetCustomerProfileOutput {
  /** `null` when neither this identifier nor anything in its resolved cluster has a profile yet. */
  readonly profile: CustomerProfile | null;
  /** Every identifier whose own profile contributed to the merged view (Profile Hydration/Merge
   * View) — just the seed identifier when it has no resolved cluster. */
  readonly mergedFrom: readonly IdentifierRef[];
  readonly completeness: number | null;
  readonly confidence: ProfileConfidenceSummary | null;
  readonly freshness: ReadonlyMap<string, number> | null;
  readonly sources: ReadonlyMap<string, string> | null;
}

export interface GetCustomerProfileDeps {
  readonly profiles: ProfileStore;
  /** Reused, not reimplemented — Identity Engine's own resolution is how the "360" unifies profiles
   * scattered across an identifier's linked identities (guest visitor_id, later customer_id, ...). */
  readonly resolveIdentity: ResolveIdentity;
}

/**
 * The Profile Engine's one read API. Resolves the identifier's identity cluster (Identity Engine,
 * same package), loads each member's own stored profile, and merges them into one unified view —
 * then derives every other named Phase 6.2 read responsibility (Completeness, Freshness, Source
 * Attribution, Confidence) from that single merged profile, since all four are pure functions of it
 * (see `domain/profile-views.ts` for why these are not separate use cases).
 */
export class GetCustomerProfile implements UseCase<
  GetCustomerProfileInput,
  GetCustomerProfileOutput,
  DomainError
> {
  private readonly deps: GetCustomerProfileDeps;

  constructor(deps: GetCustomerProfileDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetCustomerProfileInput,
  ): Promise<Result<GetCustomerProfileOutput, DomainError>> {
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

    const memberProfiles: CustomerProfile[] = [];
    const contributedBy: IdentifierRef[] = [];
    for (const member of members) {
      const profile = await this.deps.profiles.getCurrent(member, input.tenantId);
      if (profile !== null) {
        memberProfiles.push(profile);
        contributedBy.push(member);
      }
    }

    if (memberProfiles.length === 0) {
      return ok({
        profile: null,
        mergedFrom: [],
        completeness: null,
        confidence: null,
        freshness: null,
        sources: null,
      });
    }

    const merged =
      memberProfiles.length === 1 && memberProfiles[0] !== undefined
        ? memberProfiles[0]
        : mergeProfiles(memberProfiles, input.identifier.type, input.identifier.value, input.now);

    return ok({
      profile: merged,
      mergedFrom: contributedBy,
      completeness:
        input.expectedFields === undefined
          ? null
          : profileCompleteness(merged, input.expectedFields),
      confidence: profileConfidenceSummary(merged),
      freshness: profileFreshness(merged, input.now),
      sources: profileFieldSources(merged),
    });
  }
}
