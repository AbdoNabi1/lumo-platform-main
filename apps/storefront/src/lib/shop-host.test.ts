import { describe, expect, it } from "vitest";
import { createShopResolver, normalizeHost, type ResolvedShop } from "./shop-host";

const shop: ResolvedShop = {
  shopId: "shop-1",
  hostname: "acme.com",
  primaryHostname: "acme.com",
  shopStatus: "active",
};

describe("normalizeHost", () => {
  it("lowercases, strips the port and a trailing dot", () => {
    expect(normalizeHost("ACME.com:3000")).toBe("acme.com");
    expect(normalizeHost("acme.com.")).toBe("acme.com");
  });

  it("returns null for a missing or empty host", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost("   ")).toBeNull();
  });
});

describe("createShopResolver", () => {
  it("caches hits and misses for ttlMs, then refetches", async () => {
    let calls = 0;
    let now = 0;
    const resolve = createShopResolver({
      fetchShop: async (host) => {
        calls += 1;
        return host === "acme.com" ? shop : null;
      },
      now: () => now,
      ttlMs: 1000,
    });
    expect(await resolve("acme.com")).toEqual(shop);
    expect(await resolve("acme.com")).toEqual(shop);
    expect(await resolve("nobody.com")).toBeNull();
    expect(await resolve("nobody.com")).toBeNull();
    expect(calls).toBe(2);
    now = 1001;
    await resolve("acme.com");
    expect(calls).toBe(3);
  });

  it("does not cache a failed lookup (an outage must not pin a 404)", async () => {
    let calls = 0;
    const resolve = createShopResolver({
      fetchShop: async () => {
        calls += 1;
        throw new Error("runtime down");
      },
      now: () => 0,
      ttlMs: 1000,
    });
    await expect(resolve("acme.com")).rejects.toThrow("runtime down");
    await expect(resolve("acme.com")).rejects.toThrow("runtime down");
    expect(calls).toBe(2);
  });
});
