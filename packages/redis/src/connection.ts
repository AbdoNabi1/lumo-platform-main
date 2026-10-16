import { Redis, type RedisOptions } from "ioredis";
import type { RedisConfig } from "@platform/config/server";

export interface RedisConnectionOptions {
  /** Max reconnection attempts before giving up. */
  readonly maxRetries?: number;
}

/**
 * Creates an ioredis connection with a bounded exponential-backoff retry strategy.
 * `lazyConnect` defers the TCP connection until first use.
 *
 * `family: 0` (resolve over BOTH IPv4 and IPv6) is PINNED, not fixed: ioredis 5.11.1 already
 * defaults to it (`DEFAULT_REDIS_OPTIONS`), so this line changes nothing today and removing it
 * would break no test. It is written down because Railway's private network depends on the value —
 * "you must specify `family=0` in the connection string to support connecting to both IPv6 and
 * IPv4 endpoints" (Railway docs, private networking → library configuration), advice aimed at
 * ioredis 4, which defaulted to IPv4 — and environments created before 16 Oct 2025 resolve
 * `*.railway.internal` to IPv6 ONLY. A dependency bump that restored the old default would
 * otherwise make every Railway service unable to reach Redis, with nothing in this repo naming the
 * requirement. `connection.test.ts` asserts the effective value, whoever supplies it.
 */
export function createRedisConnection(
  config: RedisConfig,
  options: RedisConnectionOptions = {},
): Redis {
  const maxRetries = options.maxRetries ?? 10;
  const redisOptions: RedisOptions = {
    keyPrefix: config.keyPrefix,
    family: 0,
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
