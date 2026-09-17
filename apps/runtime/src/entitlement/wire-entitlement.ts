import type { AuditTrail, Cache, Clock } from "@platform/contracts";
import {
  EntitlementCache,
  EntitlementGuard,
  EntitlementMetrics,
  type EntitlementTelemetry,
  type PolicyPort,
  type UsageQuotaPort,
} from "@platform/entitlement";
import {
  LicensingEntitlementPort,
  type FeatureRegistryReader,
  type LicensingDecider,
} from "./licensing-entitlement.adapter";
import { EntitlementMiddleware } from "./entitlement-middleware";

/**
 * Production wiring for the Enterprise Control Plane (P1.3). Assembles the one frozen {@link EntitlementGuard} from
 * real adapters — Licensing PDP + Feature Registry read model (`EntitlementPort`), optional policy/quota ports, a
 * distributed-or-memory cache, audit, metrics and telemetry — and exposes the {@link EntitlementMiddleware} seam
 * every surface composes. No business logic; pure DI over the frozen kernel.
 */
export interface EntitlementWiringDeps {
  readonly featureRegistry: FeatureRegistryReader;
  readonly licensing: LicensingDecider;
  /** The platform tenant (ADR-0014) this guard's Feature Registry reads are scoped to. */
  readonly tenantId: string;
  /** Optional runtime-policy port (subscription state → policy). */
  readonly policy?: PolicyPort;
  /** Optional usage-quota port (reads Licensing's UsageCounter). */
  readonly quota?: UsageQuotaPort;
  /** Distributed cache (Redis) for L2; absent ⇒ in-process only. */
  readonly cache?: Cache;
  /** Immutable audit trail (ADR-0009). */
  readonly audit?: AuditTrail;
  /** Telemetry sink (logging/OTel/event-emitter, composed). */
  readonly telemetry?: EntitlementTelemetry;
  readonly clock?: Clock;
  readonly cacheTtlSeconds?: number;
}

export interface WiredEntitlement {
  readonly guard: EntitlementGuard;
  readonly middleware: EntitlementMiddleware;
  readonly cache: EntitlementCache;
  readonly metrics: EntitlementMetrics;
}

export function wireEntitlement(deps: EntitlementWiringDeps): WiredEntitlement {
  const cache = new EntitlementCache({
    ...(deps.cache !== undefined ? { cache: deps.cache } : {}),
    ...(deps.cacheTtlSeconds !== undefined ? { ttlSeconds: deps.cacheTtlSeconds } : {}),
    ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
  });
  const metrics = new EntitlementMetrics();
  const port = new LicensingEntitlementPort({
    featureRegistry: deps.featureRegistry,
    licensing: deps.licensing,
    tenantId: deps.tenantId,
  });
  const guard = new EntitlementGuard(port, {
    cache,
    metrics,
    ...(deps.policy !== undefined ? { policy: deps.policy } : {}),
    ...(deps.quota !== undefined ? { quota: deps.quota } : {}),
    ...(deps.audit !== undefined ? { audit: deps.audit } : {}),
    ...(deps.telemetry !== undefined ? { telemetry: deps.telemetry } : {}),
    ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
  });
  return { guard, middleware: new EntitlementMiddleware(guard), cache, metrics };
}
