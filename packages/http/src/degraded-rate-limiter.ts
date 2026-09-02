import type { RateLimitDecision, RateLimiter } from "@platform/contracts";

/**
 * In-process, single-instance fixed-window rate limiter (H-02, audit) — what a `public` route's
 * traffic degrades to when the real port (Redis, in production) throws on infrastructure failure.
 * NEVER used for authenticated/admin traffic: that tier stays fail-closed (503, see
 * `createHttpServer`'s rate-limit step) rather than falling open onto a limiter with no
 * cross-instance memory. Deliberately weaker than the primary port — under a real broker outage
 * this is the best available protection, not equivalent protection — which is why the caller
 * passes a stricter limit here than the route's own configured one (same call site).
 *
 * Bounded memory: `sweepIfLarge` drops expired buckets once the map crosses a threshold, so a
 * prolonged outage under real traffic doesn't grow this unboundedly. Never exercised in the
 * common case (a healthy primary port never calls into this class at all).
 */
export class InProcessRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private static readonly SWEEP_THRESHOLD = 10_000;

  consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const now = Date.now();
    this.sweepIfLarge(now);

    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return Promise.resolve({ allowed: true, remaining: Math.max(0, limit - 1), retryAfterMs: 0 });
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      return Promise.resolve({
        allowed: false,
        remaining: 0,
        retryAfterMs: bucket.resetAt - now,
      });
    }
    return Promise.resolve({
      allowed: true,
      remaining: limit - bucket.count,
      retryAfterMs: 0,
    });
  }

  private sweepIfLarge(now: number): void {
    if (this.buckets.size < InProcessRateLimiter.SWEEP_THRESHOLD) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
