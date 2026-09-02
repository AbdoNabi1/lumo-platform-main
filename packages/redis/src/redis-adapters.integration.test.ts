import { afterAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { RedisCache } from "./cache";
import { RedisDistributedLock } from "./locks";
import { RedisRateLimiter } from "./rate-limiter";
import { RedisIdempotencyKeyStore } from "./idempotency";

/**
 * REFERENCE integration suite for the Sprint-2.3 Redis adapters. Requires a live Redis:
 *
 *   REDIS_URL_TEST=redis://localhost:6379 pnpm --filter @platform/redis test
 *
 * HONESTLY GATED: skipped without `REDIS_URL_TEST` — never faked (this machine's Docker engine
 * is not running; first execution happens with the first-boot runbook,
 * infrastructure/docker/README.md).
 */
const url = process.env["REDIS_URL_TEST"];

describe.runIf(Boolean(url))("Redis adapters (integration)", () => {
  const redis = new Redis(url ?? "", { lazyConnect: false, keyPrefix: `itest:${Date.now()}:` });

  afterAll(async () => {
    await redis.quit();
  });

  it("cache round-trips DTO shapes and deletes cleanly", async () => {
    const cache = new RedisCache(redis);
    await cache.set("k1", { id: "c-1", items: [{ productRef: "p-1", quantity: 2 }] }, 60);
    expect(await cache.get("k1")).toEqual({
      id: "c-1",
      items: [{ productRef: "p-1", quantity: 2 }],
    });
    await cache.delete("k1");
    expect(await cache.get("k1")).toBeNull();
  });

  it("lock: single holder; token-guarded release; stale handle cannot release successor", async () => {
    const lock = new RedisDistributedLock(redis);
    const first = await lock.acquire("lock:a", 5000);
    expect(first).not.toBeNull();
    expect(await lock.acquire("lock:a", 5000)).toBeNull(); // held

    expect(await first?.release()).toBe(true);
    const second = await lock.acquire("lock:a", 5000);
    expect(second).not.toBeNull();
    expect(await first?.release()).toBe(false); // stale token must not free the successor
    expect(await second?.release()).toBe(true);
  });

  it("rate limiter: allows within the window, denies beyond it with retry hint", async () => {
    const limiter = new RedisRateLimiter(redis);
    const key = "rl:a";
    expect((await limiter.consume(key, 2, 60_000)).allowed).toBe(true);
    expect((await limiter.consume(key, 2, 60_000)).allowed).toBe(true);
    const denied = await limiter.consume(key, 2, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("idempotency: first claim wins; failed claimer releases; duplicate rejected while claimed", async () => {
    const store = new RedisIdempotencyKeyStore(redis);
    const claim = await store.claim("idem:a", 60);
    expect(claim).not.toBeNull();
    expect(await store.claim("idem:a", 60)).toBeNull(); // duplicate in flight

    expect(await claim?.release()).toBe(true); // failed execution frees the retry path
    expect(await store.claim("idem:a", 60)).not.toBeNull();
  });
});
