import { describe, expect, it } from "vitest";
import { createRedisConnection } from "./connection";

/**
 * `lazyConnect` means constructing a client opens no socket, so these read the options the client
 * WOULD dial with — no Redis server involved.
 */
function connection(url: string) {
  return createRedisConnection({ url, keyPrefix: "test:" });
}

describe("createRedisConnection", () => {
  it("resolves over IPv4 AND IPv6, which Railway's private network requires", () => {
    // Pins the EFFECTIVE value, not our line: ioredis 5.11.1 already defaults to 0, so deleting
    // `family: 0` from connection.ts leaves this green. What it catches is the case that matters —
    // a dependency bump restoring ioredis 4's IPv4-only default, which on a Railway environment
    // created before 16 Oct 2025 (`redis.railway.internal` has only an AAAA record) means no
    // service can reach Redis at all.
    expect(connection("redis://redis.railway.internal:6379").options.family).toBe(0);
  });

  it("opens no connection on construction, so composition stays side-effect-free", () => {
    expect(connection("redis://localhost:6379").options.lazyConnect).toBe(true);
    expect(connection("redis://localhost:6379").status).toBe("wait");
  });

  it("keeps the caller's key prefix and host", () => {
    const client = connection("redis://localhost:6380");
    expect(client.options.keyPrefix).toBe("test:");
    expect(client.options.port).toBe(6380);
  });

  it("gives up after the configured number of reconnection attempts", () => {
    const retry = connection("redis://localhost:6379").options.retryStrategy;
    expect(typeof retry).toBe("function");
    expect(retry?.(11)).toBeNull();
    expect(retry?.(1)).toBe(200);
  });
});
