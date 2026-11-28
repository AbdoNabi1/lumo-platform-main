import { describe, expect, it } from "vitest";
import { scoreBot } from "../enrichment/bot-score";
import { isPublicIp } from "../enrichment/ip-cidr";
import { parseUserAgent } from "../enrichment/user-agent";
import { BlockedIpService, InMemoryBlockedIpStore, MAX_BLOCKED_IPS_PER_STORE } from "./blocked-ips";

function setup(cacheTtlMs?: number) {
  let tick = 0;
  let nowMs = Date.parse("2026-11-28T10:00:00.000Z");
  const store = new InMemoryBlockedIpStore();
  const errors: unknown[] = [];
  const service = new BlockedIpService({
    store,
    clock: { now: () => new Date(nowMs) },
    idGenerator: {
      generate: () => {
        tick += 1;
        return `id-${String(tick)}`;
      },
    },
    ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }),
    onError: (error) => errors.push(error),
  });
  return { store, service, errors, advance: (ms: number) => (nowMs += ms) };
}

describe("BlockedIpService.add", () => {
  it("stores an address as a single host in its canonical spelling", async () => {
    const { service } = setup();
    const result = await service.add("t-1", {
      cidr: "203.0.113.7",
      note: " office ",
      createdBy: "u-1",
    });
    expect(result).toMatchObject({
      status: "created",
      entry: { cidr: "203.0.113.7/32", note: "office", createdBy: "u-1", tenantId: "t-1" },
    });
  });

  it("is idempotent: the same range in another spelling is `exists`, one row", async () => {
    const { service } = setup();
    const first = await service.add("t-1", { cidr: "198.51.100.0/24" });
    const again = await service.add("t-1", { cidr: "198.51.100.77/24" });
    expect(first.status).toBe("created");
    expect(again.status).toBe("exists");
    expect((await service.list("t-1")).length).toBe(1);
    expect(
      again.status === "exists" && first.status === "created" && again.entry.id === first.entry.id,
    ).toBe(true);
  });

  it("refuses anything malformed or wider than a /16 (a typo must not switch tracking off)", async () => {
    const { service } = setup();
    for (const cidr of [
      "",
      "nope",
      "0.0.0.0/0",
      "10.0.0.0/8",
      "198.51.0.0/15",
      "2001:db8::/16",
      "1.2.3.4/33",
    ]) {
      expect(await service.add("t-1", { cidr })).toMatchObject({
        status: "invalid",
        field: "cidr",
      });
    }
    expect((await service.add("t-1", { cidr: "198.51.0.0/16" })).status).toBe("created");
    expect((await service.add("t-1", { cidr: "2001:db8::/32" })).status).toBe("created");
  });

  it("refuses an over-long note", async () => {
    const { service } = setup();
    expect(await service.add("t-1", { cidr: "203.0.113.7", note: "x".repeat(201) })).toMatchObject({
      status: "invalid",
      field: "note",
    });
  });

  it("caps the list per store, and one store's list never counts against another", async () => {
    const { service, store } = setup();
    for (let index = 0; index < MAX_BLOCKED_IPS_PER_STORE; index += 1) {
      await store.add({
        id: `r-${String(index)}`,
        tenantId: "t-1",
        cidr: `${String(1 + (index >> 8))}.${String(index & 255)}.0.1/32`,
        note: null,
        createdAt: "2026-11-28T00:00:00.000Z",
        createdBy: null,
      });
    }
    expect(await service.add("t-1", { cidr: "203.0.113.7" })).toEqual({
      status: "limit_reached",
      limit: MAX_BLOCKED_IPS_PER_STORE,
    });
    expect((await service.add("t-2", { cidr: "203.0.113.7" })).status).toBe("created");
  });
});

describe("BlockedIpService.excludeDevice", () => {
  it("blocks exactly the caller's address", async () => {
    const { service } = setup();
    const result = await service.excludeDevice("t-1", { ip: "203.0.113.50", createdBy: "u-1" });
    expect(result).toMatchObject({ status: "created", entry: { cidr: "203.0.113.50/32" } });
    expect(await service.isBlocked("t-1", "203.0.113.50")).toBe(true);
    expect(await service.isBlocked("t-1", "203.0.113.51")).toBe(false);
  });

  it("refuses a request whose address was not seen (loopback, private, proxy, garbage)", async () => {
    const { service } = setup();
    for (const ip of [
      undefined,
      null,
      "",
      "127.0.0.1",
      "::1",
      "10.1.2.3",
      "192.168.1.9",
      "100.64.3.3",
      "x",
    ]) {
      expect(await service.excludeDevice("t-1", { ip })).toMatchObject({
        status: "invalid",
        field: "ip",
      });
    }
    expect(await service.list("t-1")).toEqual([]);
  });

  it("a second click is a no-op", async () => {
    const { service } = setup();
    await service.excludeDevice("t-1", { ip: "203.0.113.50" });
    expect((await service.excludeDevice("t-1", { ip: "203.0.113.50" })).status).toBe("exists");
  });
});

describe("BlockedIpService.isBlocked", () => {
  it("matches ranges, IPv6 and IPv4-mapped addresses, per store", async () => {
    const { service } = setup();
    await service.add("t-1", { cidr: "198.51.100.0/24" });
    await service.add("t-1", { cidr: "2001:db8::/32" });
    expect(await service.isBlocked("t-1", "198.51.100.200")).toBe(true);
    expect(await service.isBlocked("t-1", "::ffff:198.51.100.200")).toBe(true);
    expect(await service.isBlocked("t-1", "2001:db8:1::5")).toBe(true);
    expect(await service.isBlocked("t-1", "198.51.101.1")).toBe(false);
    // Another store's list is its own.
    expect(await service.isBlocked("t-2", "198.51.100.200")).toBe(false);
  });

  it("an unknown or missing address is never blocked", async () => {
    const { service } = setup();
    await service.add("t-1", { cidr: "198.51.100.0/24" });
    for (const ip of [null, undefined, "", "not-an-ip"]) {
      expect(await service.isBlocked("t-1", ip)).toBe(false);
    }
  });

  it("CGNAT: blocking one subscriber's address never blocks the neighbours on the same carrier range", async () => {
    const { service } = setup();
    // Egyptian mobile carriers share one public address across many phones; a staff phone excluded by /32 …
    await service.excludeDevice("t-1", { ip: "41.32.7.9" });
    expect(await service.isBlocked("t-1", "41.32.7.9")).toBe(true);
    // … does not touch any other address of that carrier range,
    for (const neighbour of ["41.32.7.8", "41.32.7.10", "41.32.8.9", "41.33.7.9"]) {
      expect(await service.isBlocked("t-1", neighbour)).toBe(false);
    }
    // and there is no automatic route onto the list: the bot score of a flood from one address never reads it.
    const ua = parseUserAgent(
      "Mozilla/5.0 (Linux; Android 13; SM-G991B) Chrome/124.0.6367.82 Mobile Safari/537.36",
    );
    const flood = scoreBot({
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; SM-G991B) Chrome/124.0.6367.82 Mobile Safari/537.36",
      ua,
      acceptLanguage: "ar-EG",
      secChUa: '"Chromium";v="124"',
      fingerprintBurst: true,
    });
    expect(flood.score).toBeLessThan(50);
    expect(await service.list("t-1")).toHaveLength(1);
  });

  it("sees its own edits at once and another instance's after the TTL", async () => {
    const { service, store, advance } = setup(30_000);
    expect(await service.isBlocked("t-1", "203.0.113.7")).toBe(false);
    await service.add("t-1", { cidr: "203.0.113.7" });
    expect(await service.isBlocked("t-1", "203.0.113.7")).toBe(true);

    // A write that bypasses this instance (another process) is visible only after the cache expires.
    await store.add({
      id: "other",
      tenantId: "t-1",
      cidr: "203.0.113.99/32",
      note: null,
      createdAt: "2026-11-28T10:00:01.000Z",
      createdBy: null,
    });
    expect(await service.isBlocked("t-1", "203.0.113.99")).toBe(false);
    advance(30_001);
    expect(await service.isBlocked("t-1", "203.0.113.99")).toBe(true);
  });

  it("fails OPEN: an unreadable list blocks nothing and reports the failure", async () => {
    const { service, store, errors } = setup(0);
    await service.add("t-1", { cidr: "203.0.113.7" });
    store.failWith = new Error("db down");
    expect(await service.isBlocked("t-1", "203.0.113.7")).toBe(false);
    expect(errors).toHaveLength(1);
  });
});

describe("BlockedIpService.remove", () => {
  it("removes an entry, takes effect at once, and is idempotent", async () => {
    const { service } = setup();
    const added = await service.add("t-1", { cidr: "203.0.113.7" });
    if (added.status !== "created") throw new Error("expected created");
    expect(await service.isBlocked("t-1", "203.0.113.7")).toBe(true);
    expect(await service.remove("t-1", added.entry.id)).toBe(true);
    expect(await service.isBlocked("t-1", "203.0.113.7")).toBe(false);
    expect(await service.remove("t-1", added.entry.id)).toBe(false);
  });

  it("cannot remove another store's entry", async () => {
    const { service } = setup();
    const added = await service.add("t-1", { cidr: "203.0.113.7" });
    if (added.status !== "created") throw new Error("expected created");
    expect(await service.remove("t-2", added.entry.id)).toBe(false);
    expect(await service.list("t-1")).toHaveLength(1);
  });
});

describe("isPublicIp", () => {
  it("separates visitor addresses from private, loopback and shared space", () => {
    for (const ip of ["8.8.8.8", "41.32.7.9", "203.0.113.50", "2a02:26f0::1", "2001:db8::1"]) {
      expect(isPublicIp(ip)).toBe(true);
    }
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "garbage",
      "",
    ]) {
      expect(isPublicIp(ip)).toBe(false);
    }
    expect(isPublicIp("172.32.0.1")).toBe(true);
    expect(isPublicIp(null)).toBe(false);
  });
});
