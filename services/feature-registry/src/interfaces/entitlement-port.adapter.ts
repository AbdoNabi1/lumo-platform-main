import type {
  EntitlementDecision,
  EntitlementPort,
  EntitlementRequest,
} from "@platform/entitlement";

/** A licensing decision for a tenant×feature (the shape Licensing's `CheckEntitlement` returns). */
export interface LicensingDecision {
  readonly allowed: boolean;
  readonly source: string;
}

/**
 * Function-injected collaborators. Deliberately **not** typed against `@platform/licensing` so the Feature
 * Registry never imports another bounded context (D-002): the composition root supplies these closures over the
 * real Licensing controller + this context's `ResolveFeature`.
 */
export interface CompositeEntitlementDeps {
  /** Feature availability from the registry (published + active/deprecated). Null ⇒ feature unknown. */
  readonly resolveFeatureAvailability: (featureKey: string) => Promise<boolean | null>;
  /** Licensing's 5-tier decision, given the registry's availability verdict. */
  readonly checkLicensing: (input: {
    readonly tenantRef: string;
    readonly featureKey: string;
    readonly featureAvailable: boolean;
  }) => Promise<LicensingDecision>;
}

/**
 * The composite entitlement decision point wired behind the kernel {@link EntitlementPort}: it joins the Feature
 * Registry's availability verdict with Licensing's 5-tier entitlement resolution (Platform Override → Merchant
 * Capability → Subscription → Feature Flag → Developer Override). Fail-closed — an unknown feature denies.
 */
export class CompositeEntitlementPort implements EntitlementPort {
  constructor(private readonly deps: CompositeEntitlementDeps) {}

  async check(request: EntitlementRequest): Promise<EntitlementDecision> {
    const available = await this.deps.resolveFeatureAvailability(request.featureKey);
    if (available === null)
      return { featureKey: request.featureKey, allowed: false, source: "feature_unknown" };
    const decision = await this.deps.checkLicensing({
      tenantRef: request.tenant,
      featureKey: request.featureKey,
      featureAvailable: available,
    });
    return { featureKey: request.featureKey, allowed: decision.allowed, source: decision.source };
  }
}
