/**
 * Usage enforcement (P1.2 §5). The Usage Registry (`@platform/usage`) owns usage **resources** and Licensing owns
 * the **counters/limits** (`UsageCounter`); this kernel only *enforces* a quota verdict supplied through a port —
 * it stores no usage and computes no counters.
 */

/** The quota state for a metered resource. Ordered from healthiest to hardest. */
export type QuotaState = "ok" | "warning" | "soft_exceeded" | "hard_exceeded" | "throttled";

export interface QuotaVerdict {
  readonly resource: string;
  readonly state: QuotaState;
  readonly used: number;
  /** The effective limit; `-1` means unlimited. */
  readonly limit: number;
  /** used/limit, clamped to [0, …]; 0 when unlimited. */
  readonly ratio: number;
}

export interface QuotaRequest {
  readonly tenant: string;
  readonly resource: string;
  /** Units this action would consume (default 1). */
  readonly amount?: number;
}

/**
 * Outbound port to the quota **decision** (Licensing's usage counters + plan limits). The guard consults it; it
 * never writes usage. Implementations must be deterministic for a given counter state.
 */
export interface UsageQuotaPort {
  check(request: QuotaRequest): Promise<QuotaVerdict>;
}

/** Whether a quota state blocks the action. Soft limits and warnings do not block; hard limits and throttling do. */
export function quotaBlocks(state: QuotaState): boolean {
  return state === "hard_exceeded" || state === "throttled";
}

/** Default warning threshold (fraction of the limit) at which a verdict reports `warning`. */
export const DEFAULT_WARNING_THRESHOLD = 0.8;

export interface QuotaLimit {
  /** `-1` ⇒ unlimited. */
  readonly limit: number;
  /** Fraction of the limit at which to warn (default {@link DEFAULT_WARNING_THRESHOLD}). */
  readonly warnAt?: number;
  /** When true the limit is advisory: exceeding it reports `soft_exceeded` (does not block). */
  readonly soft?: boolean;
}

/**
 * Deterministic in-memory `UsageQuotaPort` for tests/dev — seeded limits + counters. Production wires an adapter
 * over Licensing's `UsageCounter` (which is event-sourced from `platform.usage.recorded`).
 */
export class InMemoryUsageQuota implements UsageQuotaPort {
  private readonly limits = new Map<string, QuotaLimit>();
  private readonly used = new Map<string, number>();
  private readonly throttled = new Set<string>();

  private key(tenant: string, resource: string): string {
    return `${tenant}:${resource}`;
  }

  setLimit(tenant: string, resource: string, limit: QuotaLimit): this {
    this.limits.set(this.key(tenant, resource), limit);
    return this;
  }

  setUsed(tenant: string, resource: string, used: number): this {
    this.used.set(this.key(tenant, resource), used);
    return this;
  }

  /** Marks a bucket as throttled (what a `RateLimiter` adapter reports in production). */
  throttle(tenant: string, resource: string, on = true): this {
    const k = this.key(tenant, resource);
    if (on) this.throttled.add(k);
    else this.throttled.delete(k);
    return this;
  }

  async check(request: QuotaRequest): Promise<QuotaVerdict> {
    const k = this.key(request.tenant, request.resource);
    const configured = this.limits.get(k);
    const used = (this.used.get(k) ?? 0) + (request.amount ?? 1);
    const limit = configured?.limit ?? -1;
    if (this.throttled.has(k))
      return { resource: request.resource, state: "throttled", used, limit, ratio: 0 };
    if (limit < 0) return { resource: request.resource, state: "ok", used, limit: -1, ratio: 0 };
    const ratio = limit === 0 ? 1 : used / limit;
    let state: QuotaState = "ok";
    if (used > limit) state = configured?.soft === true ? "soft_exceeded" : "hard_exceeded";
    else if (ratio >= (configured?.warnAt ?? DEFAULT_WARNING_THRESHOLD)) state = "warning";
    return { resource: request.resource, state, used, limit, ratio };
  }
}
