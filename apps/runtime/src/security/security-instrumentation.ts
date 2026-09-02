import type { Span, Tracer } from "@opentelemetry/api";
import { getTracer, withSpan } from "@platform/observability";
import type { Logger } from "@platform/utils";
import { securityLogFields, type SecurityLogContext } from "./security-log-context";
import type { OtelSecurityTelemetry } from "./security-telemetry-otel";

/**
 * Security **instrumentation** (H-4 / G-SEC-3) — one wrapper that ties a span (via observability's
 * `withSpan`), a latency metric (via {@link OtelSecurityTelemetry}), and a trace-correlated structured log
 * line together for every instrumented security operation: authentication, authorization, policy
 * evaluation, KMS, HSM, threat intel, session lifecycle, audit, machine identity, AI governance. It reuses
 * the platform tracer + telemetry sink — no new tracing/metrics engine — so a caller writes
 * `instr.authorization(ctx, fn)` and gets a span, the `authorization_latency` histogram, and a redacted
 * completion log with trace/span ids, consistently. Errors are recorded on the span by `withSpan`.
 */
export type SecurityOperation =
  | "authentication"
  | "authorization"
  | "policy-evaluation"
  | "kms"
  | "hsm"
  | "threat-intel"
  | "session"
  | "audit"
  | "machine-identity"
  | "ai-governance";

export type SpanAttributes = Readonly<Record<string, string | number | boolean>>;

export interface SecurityInstrumentationOptions {
  readonly telemetry: OtelSecurityTelemetry;
  readonly logger: Logger;
  readonly tracer?: Tracer;
  /** Injected clock in ms (tests); defaults to a monotonic-ish `Date.now`. */
  readonly now?: () => number;
}

export class SecurityInstrumentation {
  private readonly telemetry: OtelSecurityTelemetry;
  private readonly logger: Logger;
  private readonly tracer: Tracer;
  private readonly now: () => number;

  constructor(options: SecurityInstrumentationOptions) {
    this.telemetry = options.telemetry;
    this.logger = options.logger;
    this.tracer = options.tracer ?? getTracer("security", "1.0.0");
    this.now = options.now ?? Date.now;
  }

  /** Core wrapper: span + timing + trace-correlated completion log. `latency` records the op's metric. */
  async trace<T>(
    operation: SecurityOperation,
    context: SecurityLogContext,
    attributes: SpanAttributes,
    latency: (ms: number, ok: boolean) => void,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    const start = this.now();
    return withSpan(this.tracer, `security.${operation}`, async (span) => {
      span.setAttribute("security.operation", operation);
      for (const [key, value] of Object.entries(attributes)) span.setAttribute(key, value);
      let ok = false;
      try {
        const result = await fn(span);
        ok = true;
        return result;
      } finally {
        const ms = this.now() - start;
        latency(ms, ok);
        this.logger.debug(
          `security ${operation} complete`,
          securityLogFields(context, { operation, durationMs: ms, ok }),
        );
      }
    });
  }

  authentication<T>(
    context: SecurityLogContext,
    fn: (span: Span) => Promise<T>,
    attributes: SpanAttributes = {},
  ): Promise<T> {
    return this.trace(
      "authentication",
      context,
      attributes,
      (ms, ok) => this.telemetry.recordAuthenticationLatency(ms, ok ? "success" : "failure"),
      fn,
    );
  }
  authorization<T>(
    context: SecurityLogContext,
    fn: (span: Span) => Promise<T>,
    attributes: SpanAttributes = {},
  ): Promise<T> {
    return this.trace(
      "authorization",
      context,
      attributes,
      (ms) =>
        this.telemetry.recordAuthorizationLatency(ms, String(attributes["effect"] ?? "unknown")),
      fn,
    );
  }
  policyEvaluation<T>(
    context: SecurityLogContext,
    fn: (span: Span) => Promise<T>,
    attributes: SpanAttributes = {},
  ): Promise<T> {
    return this.trace(
      "policy-evaluation",
      context,
      attributes,
      (ms) => this.telemetry.recordOperationLatency("policy-evaluation", ms),
      fn,
    );
  }
  kms<T>(
    context: SecurityLogContext,
    provider: string,
    operation: string,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.trace(
      "kms",
      context,
      { provider, "kms.operation": operation },
      (ms) => this.telemetry.recordKmsLatency(ms, provider, operation),
      fn,
    );
  }
  hsm<T>(
    context: SecurityLogContext,
    provider: string,
    operation: string,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.trace(
      "hsm",
      context,
      { provider, "hsm.operation": operation },
      (ms) => this.telemetry.recordKmsLatency(ms, provider, `hsm.${operation}`),
      fn,
    );
  }
  threatIntel<T>(
    context: SecurityLogContext,
    provider: string,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.trace(
      "threat-intel",
      context,
      { provider },
      (ms) => this.telemetry.recordThreatProviderLatency(ms, provider),
      fn,
    );
  }
  session<T>(
    context: SecurityLogContext,
    action: string,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.trace(
      "session",
      context,
      { "session.action": action },
      (ms) => this.telemetry.recordOperationLatency("session", ms),
      fn,
    );
  }
  audit<T>(context: SecurityLogContext, fn: (span: Span) => Promise<T>): Promise<T> {
    return this.trace(
      "audit",
      context,
      {},
      (ms) => this.telemetry.recordAuditAppendLatency(ms),
      fn,
    );
  }
  machineIdentity<T>(
    context: SecurityLogContext,
    action: string,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.trace(
      "machine-identity",
      context,
      { "machine.action": action },
      (ms) => this.telemetry.recordOperationLatency("machine-identity", ms),
      fn,
    );
  }
  aiGovernance<T>(
    context: SecurityLogContext,
    action: string,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.trace(
      "ai-governance",
      context,
      { "ai.action": action },
      (ms) => this.telemetry.recordOperationLatency("ai-governance", ms),
      fn,
    );
  }
}
