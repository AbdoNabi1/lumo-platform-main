/**
 * Enterprise Control Plane production wiring (P1.3). Composition-layer adapters that connect the frozen
 * `@platform/entitlement` guard to the live platform: Licensing PDP + Feature Registry read model, Usage counters,
 * audit, cache, telemetry and canonical events. No business logic, no ownership — pure production adapters.
 */
export { wireEntitlement } from "./wire-entitlement";
export type { EntitlementWiringDeps, WiredEntitlement } from "./wire-entitlement";
export { EntitlementMiddleware } from "./entitlement-middleware";
export { LicensingEntitlementPort, LicensingPolicyPort } from "./licensing-entitlement.adapter";
export type {
  FeatureRegistryReader,
  LicensingDecider,
  SubscriptionStateReader,
} from "./licensing-entitlement.adapter";
export { PrismaUsageQuota } from "./prisma-usage-quota.adapter";
export { EntitlementCacheInvalidator } from "./entitlement-invalidation.consumer";
export { LoggingEntitlementTelemetry, CompositeTelemetry } from "./entitlement-telemetry";
export type { EntitlementSpanSink } from "./entitlement-telemetry";
export { EntitlementConsoleProjection } from "./entitlement-read-models";
export type { EntitlementConsoleView } from "./entitlement-read-models";
export {
  EntitlementDecisionEvent,
  EntitlementEventTranslator,
  OutboxEntitlementEventEmitter,
  ENTITLEMENT_PUBLISHED_EVENTS,
} from "./entitlement-events";
export type { EntitlementEventName, EntitlementDecisionEventData } from "./entitlement-events";
