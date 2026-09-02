import type { Redis } from "ioredis";
import type { RateLimitDecision, RateLimiter } from "@platform/contracts";

/**
 * Atomic fixed-window counter: INCR, arm the window's expiry on first hit, report count + TTL in
 * one round trip. Fixed window (vs sliding) admits up to 2× burst at window edges — accepted for
 * v1 (cheap, allocation-free, O(1) memory per bucket); a sliding-window Lua variant can replace
 * this adapter behind the same port if edge bursts ever matter (D-044).
 */
const CONSUME_SCRIPT = `local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {count, ttl}`;

/**
 * Fixed-window Redis `RateLimiter`. Throws on infrastructure failure per the port contract —
 * the enforcement point (transport middleware, G-3) decides fail-open vs fail-closed.
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
      throw new Error("RedisRateLimiter: limit and windowMs must be positive integers.");
    }
    const [count, ttl] = (await this.redis.eval(CONSUME_SCRIPT, 1, key, windowMs)) as [
      number,
      number,
    ];
    if (count <= limit) {
      return { allowed: true, remaining: limit - count, retryAfterMs: 0 };
    }
    return { allowed: false, remaining: 0, retryAfterMs: ttl > 0 ? ttl : windowMs };
  }
}
