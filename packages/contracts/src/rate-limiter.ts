export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Requests left in the current window (0 when denied). */
  readonly remaining: number;
  /** How long a denied caller should wait before retrying (0 when allowed). */
  readonly retryAfterMs: number;
}

/**
 * Outbound port for rate limiting (D-018; the G-3 seam — enforcement points arrive with the
 * transport). Keys encode the bucket: per-tenant, per-app, per-principal, per-IP — always
 * tenant-scoped for tenant traffic (ADR-0008, G-38 quotas ride this port).
 *
 * Contract: `consume` throws on infrastructure failure — the **enforcement point** chooses
 * fail-open (availability paths) vs fail-closed (credential endpoints, OWASP brute-force
 * guidance); the adapter never silently allows. Window semantics (fixed vs sliding) are an
 * adapter property; callers rely only on the decision shape.
 */
export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision>;
}
