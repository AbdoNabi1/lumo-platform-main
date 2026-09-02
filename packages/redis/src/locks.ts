import type { Redis } from "ioredis";
import type { DistributedLock, LockHandle } from "@platform/contracts";

/** Token-guarded release: deletes only if the holder's token still owns the key. */
const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/** Token-guarded extend: refreshes the TTL only if still held by this token. */
const EXTEND_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end`;

/**
 * Single-instance Redis lock (`SET NX PX` + random holder token; Lua-guarded release/extend so a
 * stale holder can never release a successor's lock). Implements the `DistributedLock` contract
 * verbatim — including its limits: efficiency only, never the correctness guard (the port doc
 * and D-044 spell out why: no fencing tokens on a single instance). Multi-node Redlock is a
 * deliberate NON-goal; if a flow ever needs stronger exclusion, that is a design smell to fix
 * with idempotency/optimistic locking, not a stronger lock.
 */
export class RedisDistributedLock implements DistributedLock {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const token = crypto.randomUUID();
    const result = await this.redis.set(key, token, "PX", ttlMs, "NX");
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
      async extend(nextTtlMs: number): Promise<boolean> {
        return (await redis.eval(EXTEND_SCRIPT, 1, key, token, nextTtlMs)) === 1;
      },
    };
  }
}
