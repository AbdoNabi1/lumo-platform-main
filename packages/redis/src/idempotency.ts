import type { Redis } from "ioredis";
import type { IdempotencyClaim, IdempotencyKeyStore } from "@platform/contracts";

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/**
 * Redis `IdempotencyKeyStore`: `SET NX EX` claim with a random token; token-guarded release so
 * only the failing claimer can free the key for a client retry. Successful executions never
 * release — the claim simply expires with its TTL, holding the duplicate window open. Response
 * replay layers on top via the `Cache` port keyed by the same idempotency key (port contract).
 */
export class RedisIdempotencyKeyStore implements IdempotencyKeyStore {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async claim(key: string, ttlSeconds: number): Promise<IdempotencyClaim | null> {
    const token = crypto.randomUUID();
    const result = await this.redis.set(key, token, "EX", ttlSeconds, "NX");
    if (result !== "OK") {
      return null;
    }
    const redis = this.redis;
    return {
      key,
      token,
      async release(): Promise<boolean> {
        return (await redis.eval(RELEASE_SCRIPT, 1, key, token)) === 1;
      },
    };
  }
}
