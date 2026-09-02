import type { Counter, Histogram, Meter, UpDownCounter } from "@opentelemetry/api";
import { createCounter, createHistogram, getMeter } from "@platform/observability";
import type { SecurityMetric, SecurityTelemetryPort } from "@platform/security";

/**
 * OpenTelemetry-backed {@link SecurityTelemetryPort} (H-4 / G-SEC-3) — the production replacement the port
 * always anticipated ("OTel exporters replace this behind the same interface later"). It **reuses** the
 * platform's observability sink (`@platform/observability` → OTLP), so there is no second metrics registry
 * and the Security context stays unchanged: it still calls `increment`/`observe`/`recordRiskBand`, which
 * now feed real OTel instruments. The named production metrics (authorization/authentication/kms/threat/
 * audit latencies, request/failed-login/step-up counters, active-sessions gauge, cache hits, risk + device
 * distributions) are exposed as typed methods the H-4 instrumentation layer records into. No PII, no
 * secrets — only decisions, outcomes, and durations.
 */
export class OtelSecurityTelemetry implements SecurityTelemetryPort {
  private readonly events: Counter;
  private readonly operationMs: Histogram;
  private readonly requests: Counter;
  private readonly authnLatency: Histogram;
  private readonly authzLatency: Histogram;
  private readonly kmsLatency: Histogram;
  private readonly threatLatency: Histogram;
  private readonly auditLatency: Histogram;
  private readonly failedLogins: Counter;
  private readonly stepUpChallenges: Counter;
  private readonly riskDistribution: Counter;
  private readonly deviceTrustDistribution: Counter;
  private readonly policyCacheHits: Counter;
  private readonly activeSessions: UpDownCounter;

  constructor(meter: Meter = getMeter("security", "1.0.0")) {
    this.events = createCounter(
      meter,
      "security_events_total",
      "Security telemetry events by name",
    );
    this.operationMs = createHistogram(
      meter,
      "security_operation_ms",
      "Generic security operation duration (ms)",
    );
    this.requests = createCounter(
      meter,
      "security_requests_total",
      "Edge zero-trust decisions by outcome",
    );
    this.authnLatency = createHistogram(
      meter,
      "authentication_latency",
      "Authentication duration (ms)",
    );
    this.authzLatency = createHistogram(
      meter,
      "authorization_latency",
      "Authorization/zero-trust decision duration (ms)",
    );
    this.kmsLatency = createHistogram(meter, "kms_latency", "KMS/crypto operation duration (ms)");
    this.threatLatency = createHistogram(
      meter,
      "threat_provider_latency",
      "Threat-intel provider lookup duration (ms)",
    );
    this.auditLatency = createHistogram(
      meter,
      "audit_append_latency",
      "WORM audit append duration (ms)",
    );
    this.failedLogins = createCounter(meter, "failed_logins", "Failed login attempts");
    this.stepUpChallenges = createCounter(
      meter,
      "step_up_challenges",
      "Step-up MFA challenges issued",
    );
    this.riskDistribution = createCounter(
      meter,
      "risk_score_distribution",
      "Risk band occurrences",
    );
    this.deviceTrustDistribution = createCounter(
      meter,
      "device_trust_distribution",
      "Device trust outcomes",
    );
    this.policyCacheHits = createCounter(
      meter,
      "policy_cache_hits",
      "Edge policy/registry cache hit vs miss",
    );
    this.activeSessions = meter.createUpDownCounter("active_sessions", {
      description: "Currently active sessions",
    });
  }

  // ── SecurityTelemetryPort (unchanged contract; now OTel-backed) ──
  increment(metric: SecurityMetric, tags: Readonly<Record<string, string>> = {}): void {
    this.events.add(1, { metric, ...tags });
    if (metric === "security.auth.failed" || metric === "security.login.failed")
      this.failedLogins.add(1, tags);
    if (
      metric === "security.access.allowed" ||
      metric === "security.access.denied" ||
      metric === "security.access.challenged"
    ) {
      this.requests.add(1, { outcome: metric.slice("security.access.".length), ...tags });
    }
    if (metric === "security.session.established") this.activeSessions.add(1, tags);
    if (metric === "security.session.revoked") this.activeSessions.add(-1, tags);
  }
  observe(
    metric: SecurityMetric,
    value: number,
    tags: Readonly<Record<string, string>> = {},
  ): void {
    this.operationMs.record(value, { metric, ...tags });
  }
  recordRiskBand(band: string): void {
    this.riskDistribution.add(1, { band });
  }

  // ── Named production instruments (recorded by the H-4 instrumentation layer) ──
  recordAuthenticationLatency(ms: number, outcome: string): void {
    this.authnLatency.record(ms, { outcome });
  }
  recordAuthorizationLatency(ms: number, effect: string): void {
    this.authzLatency.record(ms, { effect });
  }
  recordKmsLatency(ms: number, provider: string, operation: string): void {
    this.kmsLatency.record(ms, { provider, operation });
  }
  recordThreatProviderLatency(ms: number, provider: string): void {
    this.threatLatency.record(ms, { provider });
  }
  recordAuditAppendLatency(ms: number): void {
    this.auditLatency.record(ms);
  }
  /** Generic operation latency (policy evaluation, session, machine-identity, AI governance) → histogram. */
  recordOperationLatency(operation: string, ms: number): void {
    this.operationMs.record(ms, { operation });
  }
  recordStepUpChallenge(method: string): void {
    this.stepUpChallenges.add(1, { method });
  }
  recordDeviceTrust(trusted: boolean): void {
    this.deviceTrustDistribution.add(1, { trusted: String(trusted) });
  }
  recordPolicyCacheHit(hit: boolean): void {
    this.policyCacheHits.add(1, { result: hit ? "hit" : "miss" });
  }
}
