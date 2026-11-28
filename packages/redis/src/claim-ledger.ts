import type { Redis } from "ioredis";

/**
 * Once-per-key claim store on Redis. Structurally satisfies `LeadEmissionLedgerPort` from
 * `@platform/tracking` (this package does not depend on it), so the leads service can be handed
 * a `RedisClaimLedger` directly.
 */
export class RedisClaimLedger {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /** `SET key "1" EX ttl NX` — true only when Redis answers `"OK"` (the key was absent). */
  async claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  /** `EXPIRE key ttl` — resets the TTL of an existing key; never creates a missing one. */
  async extend(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }
}
