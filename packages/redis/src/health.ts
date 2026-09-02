import type { Redis } from "ioredis";
import type { HealthCheck } from "@platform/health";

/** Redis health probe via PING. */
export function createRedisHealthCheck(redis: Redis): HealthCheck {
  return {
    name: "redis",
    async probe(): Promise<void> {
      const response: string = await redis.ping();
      if (response !== "PONG") {
        // ioredis types `ping()` as always resolving the literal "PONG" — real-world deviation
        // (a proxy/cluster quirk) is exactly what this defensive check guards against, so the
        // `string` annotation above (not `redis.ping()`'s own inferred literal type) keeps this
        // reachable per the type system instead of narrowing to `never`.
        throw new Error(`Unexpected PING response: ${response}`);
      }
    },
  };
}
