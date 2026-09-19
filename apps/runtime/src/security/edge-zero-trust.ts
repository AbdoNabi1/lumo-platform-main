import { createHash } from "node:crypto";
import { ThreatIntelAggregator } from "@platform/security";
import type {
  AccessDecisionOutput,
  EvaluateAccessInput,
  RiskSignals,
  ThreatIntelResolver,
} from "@platform/security";
import type { Logger } from "@platform/utils";
import type { EdgeCache } from "./edge-cache";
import type { SecurityInstrumentation } from "./security-instrumentation";
import type { SecurityPropagationContext } from "./security-context-propagation";

/**
 * **Edge zero-trust** request evaluation (H-4 / G-SEC-3). It integrates the Security decision into the
 * HTTP edge **without duplicating any evaluation logic**: it assembles request signals (fingerprint, geo,
 * device, threat-intel reputation), then delegates the actual allow/challenge/deny to the context's
 * `EvaluateAccess` (via the injected {@link ZeroTrustDecider}), which owns the ZeroTrust/Authorization
 * evaluators, session, principal, and policy. Threat lookups are cached in the {@link EdgeCache}; the whole
 * evaluation is a traced, metered span via {@link SecurityInstrumentation}. The edge only *enforces* the
 * decision (maps it to an HTTP status) — deciding stays in the context (ADR-0023).
 */
export interface ZeroTrustDecider {
  authorize(input: EvaluateAccessInput): Promise<AccessDecisionOutput>;
}

/**
 * Binds the upstream IdP session id a verified request carries (`sid`) to the Security session
 * `EvaluateAccess` gates on, establishing the mirror on first sight (ADR-0031). Satisfied by
 * `SecuritySdk.federateSession`. A `null` session id is a refusal, and the edge treats it as
 * "no session" — which fails closed for human principals.
 */
export interface SessionFederator {
  federateSession(input: {
    readonly tenantId: string;
    readonly principalExternalId: string;
    readonly externalRef: string;
    readonly refreshFingerprint: string;
    readonly deviceRef?: string | null;
    readonly ttlSeconds: number;
  }): Promise<{ readonly sessionId: string | null; readonly reason: string | null }>;
}

export interface EdgeRequest {
  /** ADR-0014 (WP-10, T10.3): the request's resolved tenant — the per-call scope of every Security read/write. */
  readonly tenantId: string;
  readonly principalId: string;
  readonly permission: string;
  /** The upstream IdP session id (`sid`) from the verified token — federated to a Security session. */
  readonly sessionId?: string;
  readonly environment?: string;
  readonly resource?: string;
  readonly ip?: string;
  readonly userAgent?: string;
  readonly deviceRef?: string;
  readonly country?: string;
}

export interface RequestFingerprint {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly deviceRef: string | null;
  readonly country: string | null;
  /** Non-reversible fingerprint of (ip, ua, device) for correlation — not a secret, not PII-reversible. */
  readonly fingerprint: string;
}

/** Derives a stable request fingerprint for correlation + risk (geo/device awareness carried alongside). */
export function fingerprintRequest(input: {
  readonly ip?: string;
  readonly userAgent?: string;
  readonly deviceRef?: string;
  readonly country?: string;
}): RequestFingerprint {
  const material = `${input.ip ?? ""}|${input.userAgent ?? ""}|${input.deviceRef ?? ""}`;
  return {
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    deviceRef: input.deviceRef ?? null,
    country: input.country ?? null,
    fingerprint: createHash("sha256").update(material).digest("hex").slice(0, 32),
  };
}

export type EdgeEffect = "allow" | "challenge" | "deny";

export interface EdgeDecision {
  readonly effect: EdgeEffect;
  readonly allowed: boolean;
  /** HTTP status the edge enforces: 200 allow · 401 step-up challenge · 403 deny. */
  readonly status: number;
  readonly reasons: readonly string[];
  readonly fingerprint: string;
}

export interface EdgeZeroTrustOptions {
  readonly decider: ZeroTrustDecider;
  readonly instrumentation: SecurityInstrumentation;
  readonly logger: Logger;
  /** Optional threat-intel resolver — an IP's reputation feeds the risk signals. */
  readonly threat?: ThreatIntelResolver;
  /** Optional edge cache — threat verdicts are memoised per IP for a short TTL. */
  readonly cache?: EdgeCache;
  /**
   * Optional session federator (ADR-0031). When present, a request's IdP `sid` is resolved to the
   * Security session id before evaluation — the only way a human principal can satisfy the session
   * gate, since Kratos (not Security) mints human sessions. Absent, the `sid` is passed through
   * unchanged (pre-P2.0.3 behaviour), which fails closed for humans.
   */
  readonly federation?: SessionFederator;
  /** Mirrored-session lifetime in seconds. Default 3600. */
  readonly sessionTtlSeconds?: number;
}

export class EdgeZeroTrustEvaluator {
  private readonly options: EdgeZeroTrustOptions;
  private readonly aggregator = new ThreatIntelAggregator();

  constructor(options: EdgeZeroTrustOptions) {
    this.options = options;
  }

  async evaluate(
    request: EdgeRequest,
    context?: SecurityPropagationContext,
  ): Promise<EdgeDecision> {
    const fingerprint = fingerprintRequest(request);
    const risk = await this.assessRisk(request);
    const sessionId = await this.resolveSessionId(request, fingerprint);
    const logContext = {
      ...(context?.correlationId !== undefined ? { correlationId: context.correlationId } : {}),
      ...(context?.requestId !== undefined ? { requestId: context.requestId } : {}),
      principalId: request.principalId,
      ...(context?.tenantId !== undefined ? { tenantId: context.tenantId } : {}),
    };

    const decision = await this.options.instrumentation.authorization(
      logContext,
      async () => {
        const input: EvaluateAccessInput = {
          tenantId: request.tenantId,
          principalExternalId: request.principalId,
          permission: request.permission,
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(request.deviceRef !== undefined ? { deviceRef: request.deviceRef } : {}),
          ...(request.environment !== undefined ? { environment: request.environment } : {}),
          ...(request.resource !== undefined ? { resource: request.resource } : {}),
          risk,
        };
        return this.options.decider.authorize(input);
      },
      { permission: request.permission, "request.fingerprint": fingerprint.fingerprint },
    );

    return this.enforce(decision, fingerprint);
  }

  /**
   * Federates the request's IdP `sid` into the Security session id `EvaluateAccess` gates on. The
   * upstream session's authenticity is already established — the transport verified the token that
   * carried this `sid` — so federation binds rather than re-authenticates.
   *
   * A refusal (unregistered principal, revoked/expired mirror, `sid` bound to another principal)
   * yields `undefined`, i.e. "no session": for a human principal `EvaluateAccess` then fails closed,
   * which is the correct outcome. Without a federator the `sid` passes through unchanged.
   */
  private async resolveSessionId(
    request: EdgeRequest,
    fingerprint: RequestFingerprint,
  ): Promise<string | undefined> {
    const federation = this.options.federation;
    if (federation === undefined || request.sessionId === undefined) return request.sessionId;
    const outcome = await federation.federateSession({
      tenantId: request.tenantId,
      principalExternalId: request.principalId,
      externalRef: request.sessionId,
      // A mirror never holds a token — only a non-reversible marker tying it to this upstream session.
      refreshFingerprint: createHash("sha256")
        .update(`${request.sessionId}|${fingerprint.fingerprint}`)
        .digest("hex"),
      deviceRef: request.deviceRef ?? null,
      ttlSeconds: this.options.sessionTtlSeconds ?? 3600,
    });
    if (outcome.sessionId !== null) return outcome.sessionId;
    this.options.logger.warn("session federation refused; evaluating without a session", {
      principalId: request.principalId,
      reason: outcome.reason ?? "unknown",
    });
    return undefined;
  }

  /** Threat-aware risk: an IP's aggregated threat-intel verdict → `threatIntelHit` + `ipReputation`. */
  private async assessRisk(request: EdgeRequest): Promise<RiskSignals> {
    const signals: { threatIntelHit?: boolean; ipReputation?: number; newDevice?: boolean } = {
      newDevice: request.deviceRef === undefined,
    };
    const threat = this.options.threat;
    if (threat !== undefined && request.ip !== undefined) {
      const ip = request.ip;
      const verdicts =
        this.options.cache !== undefined
          ? await this.options.cache.getOrLoad("threat-intel", ip, () => threat.lookupAll(ip))
          : await threat.lookupAll(ip);
      const aggregated = this.aggregator.aggregate(ip, verdicts);
      signals.threatIntelHit = aggregated.malicious;
      signals.ipReputation = aggregated.score;
    }
    return signals;
  }

  private enforce(decision: AccessDecisionOutput, fingerprint: RequestFingerprint): EdgeDecision {
    const effect: EdgeEffect = decision.allowed
      ? "allow"
      : decision.effect === "challenge"
        ? "challenge"
        : "deny";
    const status = effect === "allow" ? 200 : effect === "challenge" ? 401 : 403;
    return {
      effect,
      allowed: decision.allowed,
      status,
      reasons: decision.reasons,
      fingerprint: fingerprint.fingerprint,
    };
  }
}
