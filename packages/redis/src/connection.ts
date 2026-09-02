import { Redis, type RedisOptions } from "ioredis";
import type { RedisConfig } from "@platform/config/server";

export interface RedisConnectionOptions {
  /** Max reconnection attempts before giving up. */
  readonly maxRetries?: number;
}

/**
 * Creates an ioredis connection with a bounded exponential-backoff retry strategy.
 * `lazyConnect` defers the TCP connection until first use.
 */
export function createRedisConnection(
  config: RedisConfig,
  options: RedisConnectionOptions = {},
): Redis {
  const maxRetries = options.maxRetries ?? 10;
  const redisOptions: RedisOptions = {
    keyPrefix: config.keyPrefix,
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number): number | null {
      if (times > maxRetries) return null;
      return Math.min(times * 200, 2000);
    },
  };
  return new Redis(config.url, redisOptions);
}
