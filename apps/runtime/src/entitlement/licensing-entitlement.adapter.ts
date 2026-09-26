import type {
  EntitlementDecision,
  EntitlementPort,
  EntitlementRequest,
  PolicyPort,
} from "@platform/entitlement";

/** The transport-neutral controller response shape both context controllers return. */
interface ControllerResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Structural view of the Feature Registry controller (frozen public port) — reused, never
 * re-implemented. ADR-0014 (WP-10, T10.5): `resolve` takes the platform `tenantId` explicitly,
 * matching `ResolveFeatureInput` on the real, already-tenant-scoped `FeatureRegistryController`.
 * A feature definition is a per-tenant row (`(tenantId, key)`), so the tenant passed is the one
 * being asked about, never one the caller was constructed for.
 */
export interface FeatureRegistryReader {
  resolve(input: { readonly key: string; readonly tenantId: string }): Promise<ControllerResponse>;
}

/** Structural view of the Licensing controller (the frozen PDP) — reused, never re-implemented. */
export interface LicensingDecider {
  checkEntitlement(input: {
    readonly tenantRef: string;
    readonly featureKey: string;
    readonly featureAvailable?: boolean;
    readonly flagEnabled?: boolean;
  }): Promise<ControllerResponse>;
}

interface ResolvedFeatureBody {
  readonly available: boolean;
  readonly requiredPlans: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly dependencies: readonly { readonly featureKey: string }[];
}

interface EntitlementBody {
  readonly allowed: boolean;
  readonly source: string;
}

/**
 * Production `EntitlementPort` (P1.3 §2/§3) — the guard's decision point. It joins the **Feature Registry read
 * model** (availability + required plans/capabilities/dependencies) with the **Licensing PDP**
 * (`CheckEntitlement`, the frozen 5-tier resolver). It delegates every verdict to Licensing and never re-implements
 * the resolver; it only enriches the decision with explanation signals for the read model. Deterministic and
 * side-effect-free (both calls are reads).
 *
 * **Tenant scope (T10.7, ADR-0014):** a process-wide singleton. `request.tenant` is the ONE tenant of the
 * decision — it scopes the Feature Registry read (definitions are per-tenant rows), goes to Licensing as the
 * `tenantRef`, and is the cache/audit tenant in the guard. Nothing about a tenant is captured at construction;
 * before T10.7 the Registry half used a construction-time tenant while the Licensing half used the request's,
 * so under `multi` every tenant would have been answered from one tenant's catalog.
 */
export class LicensingEntitlementPort implements EntitlementPort {
  constructor(
    private readonly deps: {
      readonly featureRegistry: FeatureRegistryReader;
      readonly licensing: LicensingDecider;
    },
  ) {}

  async check(request: EntitlementRequest): Promise<EntitlementDecision> {
    const resolved = await this.deps.featureRegistry.resolve({
      key: request.featureKey,
      tenantId: request.tenant,
    });
    if (resolved.status === 404)
      return {
        featureKey: request.featureKey,
        allowed: false,
        source: "feature_unknown",
        policy: "deny",
        reason: "feature is not registered",
      };
    const feature = resolved.body as ResolvedFeatureBody;

    const decisionResponse = await this.deps.licensing.checkEntitlement({
      tenantRef: request.tenant,
      featureKey: request.featureKey,
      featureAvailable: feature.available,
    });
    const decision = decisionResponse.body as EntitlementBody;

    const explain: EntitlementDecision["explain"] = {
      ...(feature.requiredPlans[0] !== undefined ? { requiredPlan: feature.requiredPlans[0] } : {}),
      ...(feature.requiredCapabilities[0] !== undefined
        ? { missingCapability: feature.requiredCapabilities[0] }
        : {}),
      ...(feature.dependencies[0] !== undefined
        ? { missingDependency: feature.dependencies[0].featureKey }
        : {}),
      ...(decision.source === "merchant_override"
        ? { merchantOverride: decision.allowed ? "enabled" : "disabled" }
        : {}),
      ...(decision.source === "platform_override" ||
      decision.source === "platform_emergency_override"
        ? { platformOverride: decision.allowed ? "enabled" : "disabled" }
        : {}),
      ...(decision.source === "flag_gate" ? { featureFlagStatus: "off" } : {}),
    };

    return {
      featureKey: request.featureKey,
      allowed: decision.allowed,
      source: decision.source,
      ...(Object.keys(explain).length > 0 ? { explain } : {}),
    };
  }
}

/** Structural view of the Licensing subscription read used to derive a runtime policy. */
export interface SubscriptionStateReader {
  subscriptionState(tenantRef: string): Promise<string | null>;
}

/** Maps a Licensing subscription state to the runtime {@link EntitlementPolicy}. */
const POLICY_BY_STATE: Readonly<
  Record<string, "allow" | "trial" | "grace_period" | "suspended" | "expired">
> = {
  active: "allow",
  trial: "trial",
  grace: "grace_period",
  suspended: "suspended",
  expired: "expired",
  cancelled: "expired",
};

/**
 * Production `PolicyPort` (P1.3 §4) — derives the runtime policy from Licensing's subscription state. Defaults to
 * `allow` when the state is unknown (the decision tier already denies un-entitled features, so this is fail-closed
 * in aggregate). Reuses Licensing; owns no policy state.
 */
export class LicensingPolicyPort implements PolicyPort {
  constructor(private readonly reader: SubscriptionStateReader) {}

  async resolve(
    request: EntitlementRequest,
  ): Promise<"allow" | "trial" | "grace_period" | "suspended" | "expired"> {
    const state = await this.reader.subscriptionState(request.tenant);
    return state !== null ? (POLICY_BY_STATE[state] ?? "allow") : "allow";
  }
}
