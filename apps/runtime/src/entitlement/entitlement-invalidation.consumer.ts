import type { EntitlementCache } from "@platform/entitlement";

/**
 * Event-driven entitlement-cache invalidation (P1.3 §8) — **no polling**. Subscribing the platform message bus to
 * these canonical events and forwarding them here keeps cached decisions correct: a subscription/plan/capability/
 * workspace change invalidates the tenant; a feature-definition change invalidates the feature across tenants.
 * Deterministic and idempotent (invalidation is delete-then-miss; invalidating twice is a no-op).
 */
export class EntitlementCacheInvalidator {
  constructor(private readonly cache: EntitlementCache) {}

  /** The canonical event types this invalidator reacts to (used to wire bus subscriptions). */
  static readonly SUBSCRIBED_EVENTS: readonly string[] = [
    "licensing.subscription.activated",
    "licensing.subscription.upgraded",
    "licensing.subscription.downgraded",
    "licensing.subscription.suspended",
    "licensing.subscription.resumed",
    "licensing.subscription.cancelled",
    "licensing.subscription.expired",
    "licensing.subscription.grace",
    "licensing.merchant_capability.granted",
    "licensing.merchant_capability.revoked",
    "licensing.plan.version_published",
    "feature_registry.feature.version_published",
    "feature_registry.feature.deprecated",
    "feature_registry.feature.removed",
    "tenancy.workspace.configured",
    "tenancy.tenant.suspended",
    "tenancy.tenant.activated",
  ];

  async onEvent(type: string, payload: unknown): Promise<void> {
    const data = (payload ?? {}) as {
      readonly key?: string;
      readonly tenant?: string;
      readonly aggregate?: string;
    };
    if (type.startsWith("feature_registry.feature.")) {
      if (data.key !== undefined) await this.cache.invalidateFeature(data.key);
      return;
    }
    if (type.startsWith("licensing.merchant_capability.")) {
      // key = `${tenantRef}:${featureKey}` — invalidate the whole tenant (a capability affects any feature check).
      const tenant = data.key?.split(":")[0];
      if (tenant !== undefined) await this.cache.invalidateTenant(tenant);
      return;
    }
    if (type.startsWith("licensing.subscription.") || type === "licensing.plan.version_published") {
      const tenant = data.key ?? data.tenant;
      if (tenant !== undefined) await this.cache.invalidateTenant(tenant);
      return;
    }
    if (type.startsWith("tenancy.")) {
      const tenant = data.key ?? data.tenant;
      if (tenant !== undefined) await this.cache.invalidateTenant(tenant);
    }
  }
}
