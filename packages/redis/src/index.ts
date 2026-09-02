import type { Redis } from "ioredis";
import type { RedisConfig } from "@platform/config/server";
import type { HealthCheck } from "@platform/health";
import { createRedisConnection, type RedisConnectionOptions } from "./connection";
import { RedisCache, type Cache } from "./cache";
import { createRedisHealthCheck } from "./health";

export { jsonSerializer, type Serializer } from "./serialization";
export { createRedisConnection, type RedisConnectionOptions } from "./connection";
export { RedisCache, type Cache, type RedisCacheOptions } from "./cache";
export { createRedisHealthCheck } from "./health";
export { RedisDistributedLock } from "./locks";
export { RedisRateLimiter } from "./rate-limiter";
export { RedisIdempotencyKeyStore } from "./idempotency";

/** A managed Redis handle: client, cache, health probe, and lifecycle. */
export interface RedisHandle {
  readonly client: Redis;
  readonly cache: Cache;
  healthCheck(): HealthCheck;
  disconnect(): Promise<void>;
}

/** Composition root for the Redis infrastructure (dependency-injected config). */
export function createRedis(
  config: RedisConfig,
  options: RedisConnectionOptions = {},
): RedisHandle {
  const client = createRedisConnection(config, options);
  return {
    client,
    cache: new RedisCache(client),
    healthCheck: () => createRedisHealthCheck(client),
    disconnect: async () => {
      await client.quit();
    },
  };
}
