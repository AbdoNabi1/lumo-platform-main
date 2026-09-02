import type { Logger } from "@platform/utils";
import type {
  EntitlementDecision,
  EntitlementRequest,
  EntitlementTelemetry,
  EnforcementTarget,
} from "@platform/entitlement";

/**
 * A telemetry span the composition root's OpenTelemetry/observability provider can implement (P1.3 §9). Kept as a
 * tiny structural port so this app depends on no specific tracer — the real OTel exporter is wired at deploy time.
 */
export interface EntitlementSpanSink {
  record(span: {
    readonly name: string;
    readonly attributes: Readonly<Record<string, string | number | boolean>>;
  }): void;
}

/**
 * Structured-log + span telemetry for entitlement decisions (P1.3 §9). Instruments latency, cache hit/miss, quota,
 * grant/deny, target and decision/correlation ids. No business logic. Composable with the event emitter — the guard
 * calls a single telemetry sink, so several sinks are combined via {@link CompositeTelemetry}.
 */
export class LoggingEntitlementTelemetry implements EntitlementTelemetry {
  constructor(
    private readonly deps: { readonly logger: Logger; readonly span?: EntitlementSpanSink },
  ) {}

  onDecision(e: {
    decision: EntitlementDecision;
    request: EntitlementRequest;
    target: EnforcementTarget;
    latencyMs: number;
    cacheHit: boolean;
    simulated: boolean;
  }): void {
    const attributes = {
      "entitlement.tenant": e.request.tenant,
      "entitlement.feature": e.decision.featureKey,
      "entitlement.allowed": e.decision.allowed,
      "entitlement.source": e.decision.source,
      "entitlement.policy": e.decision.policy ?? "allow",
      "entitlement.quota": e.decision.quota?.state ?? "none",
      "entitlement.target": e.target,
      "entitlement.cache_hit": e.cacheHit,
      "entitlement.simulated": e.simulated,
      "entitlement.latency_ms": e.latencyMs,
      "entitlement.decision_id": e.decision.decisionId ?? "",
      ...(e.request.correlationId !== undefined
        ? { "entitlement.correlation_id": e.request.correlationId }
        : {}),
    };
    this.deps.span?.record({
      name: e.simulated ? "entitlement.simulate" : "entitlement.enforce",
      attributes,
    });
    this.deps.logger.debug("entitlement decision", attributes);
  }
}

/** Fans a decision out to several telemetry sinks (e.g. logging + event emitter). Never throws. */
export class CompositeTelemetry implements EntitlementTelemetry {
  constructor(private readonly sinks: readonly EntitlementTelemetry[]) {}
  onDecision(e: Parameters<EntitlementTelemetry["onDecision"]>[0]): void {
    for (const sink of this.sinks) {
      try {
        sink.onDecision(e);
      } catch {
        /* telemetry must never affect the verdict */
      }
    }
  }
}
