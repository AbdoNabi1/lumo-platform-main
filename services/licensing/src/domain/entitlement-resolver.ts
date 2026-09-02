export type OverrideState = "enabled" | "disabled";
export type EntitlementVerdict = "enabled" | "disabled";

/**
 * A pure resolver, not a persisted aggregate — inputs are supplied by the caller (Licensing owns no
 * wiring to Experimentation's kernel `@platform/feature-flags` this milestone; the additive
 * `EntitlementGuard` pipeline seam is explicitly deferred in both 5.5 and 5.6's own "Deferred work"
 * sections). Fixed 5-tier order (ADR-0018 Sprint-5.6 addendum §E, highest wins, short-circuiting):
 *
 * Platform (Emergency) Override → Merchant (Manual) Override → Plan Entitlement →
 * Feature Availability → Developer Feature Flag.
 *
 * The Sprint-5.5 4-input call site (`platformOverride`/`merchantOverride`/`planEntitlement`/
 * `developerFlag`) stays call-compatible; `platformEmergencyOverride` and `featureAvailability` are
 * the two new optional Sprint-5.6 inputs. `platformEmergencyOverride`, when set, takes precedence
 * over the ordinary `platformOverride` at the same top tier (both represent "the platform decided",
 * the emergency variant is simply the highest-precedence form of it, per the ADR's own text:
 * "distinct from an ordinary platform-level override; highest precedence").
 */
export interface EntitlementResolverInput {
  readonly planEntitlement: boolean;
  readonly developerFlag: boolean;
  readonly platformOverride?: OverrideState;
  readonly merchantOverride?: OverrideState;
  readonly platformEmergencyOverride?: OverrideState;
  readonly featureAvailability?: boolean;
}

export class EntitlementResolver {
  static resolve(input: EntitlementResolverInput): EntitlementVerdict {
    const platformTier = input.platformEmergencyOverride ?? input.platformOverride;
    if (platformTier !== undefined) return platformTier;

    if (input.merchantOverride !== undefined) return input.merchantOverride;

    if (!input.planEntitlement) return "disabled";

    if (input.featureAvailability === false) return "disabled";

    return input.developerFlag ? "enabled" : "disabled";
  }
}
