import type { Redis } from "ioredis";
import type { Cache } from "@platform/contracts";
import { jsonSerializer, type Serializer } from "./serialization";

// The `Cache` port moved to `@platform/contracts` (D-018/D-044); re-exported for back-compat.
export type { Cache };

export interface RedisCacheOptions {
  readonly serializer?: Serializer;
}

/** Redis-backed implementation of the cache abstraction. */
export class RedisCache implements Cache {
  private readonly redis: Redis;
  private readonly serializer: Serializer;

  constructor(redis: Redis, options: RedisCacheOptions = {}) {
    this.redis = redis;
    this.serializer = options.serializer ?? jsonSerializer;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw === null ? null : this.serializer.deserialize<T>(raw);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const raw = this.serializer.serialize(value);
    if (ttlSeconds !== undefined) {
      await this.redis.set(key, raw, "EX", ttlSeconds);
    } else {
      await this.redis.set(key, raw);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) > 0;
  }
}
