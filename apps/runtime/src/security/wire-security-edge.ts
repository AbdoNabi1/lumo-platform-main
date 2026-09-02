import type { ThreatIntelResolver } from "@platform/security";
import type { Logger } from "@platform/utils";
import { EdgeCache, type EdgeCacheOptions } from "./edge-cache";
import {
  EdgeZeroTrustEvaluator,
  type SessionFederator,
  type ZeroTrustDecider,
} from "./edge-zero-trust";
import { SecurityPermissionGuard } from "./edge-middleware";
import { SecurityInstrumentation } from "./security-instrumentation";
import { OtelSecurityTelemetry } from "./security-telemetry-otel";

/**
 * Runtime wiring for the Security context's **observability + edge zero-trust** integration (H-4 /
 * G-SEC-3). Built at boot: the OTel-backed telemetry sink, the instrumentation wrapper, and the edge
 * cache — all **decider-agnostic**, so they exist independently of whether the security HTTP service is
 * mounted (mirroring how H-3's providers are built and bound later). The zero-trust **guard/evaluator** are
 * produced by factories once the decision surface (the wired `SecuritySdk`, which satisfies
 * {@link ZeroTrustDecider}) and the threat resolver are available at the composition seam — the edge only
 * enforces; the context decides. Composition-only, no service imports, no duplicated evaluation.
 */
export interface WiredSecurityEdge {
  readonly telemetry: OtelSecurityTelemetry;
  readonly instrumentation: SecurityInstrumentation;
  readonly edgeCache: EdgeCache;
  /** Builds the edge zero-trust evaluator from the wired decision surface + optional threat resolver. */
  buildEvaluator(
    decider: ZeroTrustDecider,
    threat?: ThreatIntelResolver,
    federation?: SessionFederator,
  ): EdgeZeroTrustEvaluator;
  /** Builds the `@platform/http` permission guard (the authorization seam) from the same. */
  buildGuard(
    decider: ZeroTrustDecider,
    threat?: ThreatIntelResolver,
    federation?: SessionFederator,
  ): SecurityPermissionGuard;
}

export interface WireSecurityEdgeDeps {
  readonly logger: Logger;
  /** Injected clock in ms (tests). */
  readonly now?: () => number;
  readonly cache?: EdgeCacheOptions;
  /** Lifetime of a federated session mirror in seconds (ADR-0031). Default 3600. */
  readonly sessionTtlSeconds?: number;
}

export function wireSecurityEdge(deps: WireSecurityEdgeDeps): WiredSecurityEdge {
  const telemetry = new OtelSecurityTelemetry();
  const instrumentation = new SecurityInstrumentation({
    telemetry,
    logger: deps.logger,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });
  const edgeCache = new EdgeCache({
    ...(deps.cache ?? {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });

  const buildEvaluator = (
    decider: ZeroTrustDecider,
    threat?: ThreatIntelResolver,
    federation?: SessionFederator,
  ): EdgeZeroTrustEvaluator =>
    new EdgeZeroTrustEvaluator({
      decider,
      instrumentation,
      logger: deps.logger,
      cache: edgeCache,
      ...(threat !== undefined ? { threat } : {}),
      ...(federation !== undefined ? { federation } : {}),
      ...(deps.sessionTtlSeconds !== undefined
        ? { sessionTtlSeconds: deps.sessionTtlSeconds }
        : {}),
    });

  return {
    telemetry,
    instrumentation,
    edgeCache,
    buildEvaluator,
    buildGuard: (decider, threat, federation) =>
      new SecurityPermissionGuard(buildEvaluator(decider, threat, federation)),
  };
}
