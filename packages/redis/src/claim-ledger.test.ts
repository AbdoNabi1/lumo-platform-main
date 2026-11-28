import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedisClaimLedger } from "./claim-ledger";

beforeEach(() => {
  expect.hasAssertions();
});

function fakeRedis(setResult: "OK" | null) {
  const set = vi.fn(() => Promise.resolve(setResult));
  const expire = vi.fn(() => Promise.resolve(1));
  return { redis: { set, expire } as unknown as Redis, set, expire };
}

describe("RedisClaimLedger", () => {
  it("claimOnce sends SET key 1 EX ttl NX and maps OK to true", async () => {
    const { redis, set } = fakeRedis("OK");
    const ledger = new RedisClaimLedger(redis);
    expect(await ledger.claimOnce("k", 1800)).toBe(true);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith("k", "1", "EX", 1800, "NX");
  });

  it("claimOnce maps a null reply (key already present) to false", async () => {
    const { redis } = fakeRedis(null);
    expect(await new RedisClaimLedger(redis).claimOnce("k", 1800)).toBe(false);
  });

  it("extend sends EXPIRE key ttl and resolves with nothing", async () => {
    const { redis, expire, set } = fakeRedis("OK");
    expect(await new RedisClaimLedger(redis).extend("k", 1800)).toBeUndefined();
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith("k", 1800);
    expect(set).not.toHaveBeenCalled();
  });

  it("lets a Redis failure reject (the caller fails closed)", async () => {
    const redis = {
      set: vi.fn(() => Promise.reject(new Error("redis down"))),
    } as unknown as Redis;
    await expect(new RedisClaimLedger(redis).claimOnce("k", 1800)).rejects.toThrow("redis down");
  });
});
