import { describe, expect, it, vi } from "vitest";
import { findConstructionTimeTenants } from "../../tenant-mode-guard";
import {
  mediaImageRefs,
  scryptStorefrontPasswordHasher,
  tenancyShopHost,
  tenancyStoreIdentity,
} from "./online-store.adapters";

describe("online-store cross-context adapters", () => {
  it("resolves media ids into a record and asks existing ids per tenant", async () => {
    const existingIds = vi.fn(async (ids: readonly string[]) => ids.slice(0, 1));
    const resolve = vi.fn(
      async () =>
        new Map([["a", { id: "a", url: "https://cdn/a", alt: "A", width: 1, height: 2 }]]),
    );
    const port = mediaImageRefs(existingIds, resolve);
    expect(await port.existingIds(["a", "b"], "t-1")).toEqual(["a"]);
    expect(existingIds).toHaveBeenCalledWith(["a", "b"], "t-1");
    expect(await port.resolve(["a"], "t-1")).toEqual({
      a: { url: "https://cdn/a", alt: "A", width: 1, height: 2 },
    });
  });

  it("finds the primary VERIFIED hostname, or null", async () => {
    const list = vi.fn(async () => ({
      status: 200,
      body: {
        items: [
          { hostname: "pending.example", status: "pending", isPrimary: false },
          { hostname: "shop.example.eg", status: "verified", isPrimary: true },
        ],
      },
    }));
    expect(await tenancyShopHost(list).primaryHostname("t-1")).toBe("shop.example.eg");
    expect(list).toHaveBeenCalledWith("t-1");
    expect(
      await tenancyShopHost(async () => ({ status: 500, body: null })).primaryHostname("t-1"),
    ).toBeNull();
  });

  it("ignores a primary hostname that is not verified yet", async () => {
    const list = async () => ({
      status: 200,
      body: { items: [{ hostname: "soon.example", status: "pending", isPrimary: true }] },
    });
    expect(await tenancyShopHost(list).primaryHostname("t-1")).toBeNull();
  });

  it("forwards each request tenant when reading store identity", async () => {
    const getPublicStore = vi.fn(async (tenantId: string) => ({
      status: 200,
      body: { name: tenantId },
    }));
    const identity = tenancyStoreIdentity(getPublicStore);
    expect(await identity.storeName("tenant-a")).toBe("tenant-a");
    expect(await identity.storeName("tenant-b")).toBe("tenant-b");
    expect(getPublicStore.mock.calls).toEqual([["tenant-a"], ["tenant-b"]]);
  });

  it("reads the store name, empty when unreadable", async () => {
    expect(
      await tenancyStoreIdentity(async () => ({
        status: 200,
        body: { name: "Nour", currency: "EGP" },
      })).storeName("t"),
    ).toBe("Nour");
    expect(
      await tenancyStoreIdentity(async () => ({ status: 500, body: null })).storeName("t"),
    ).toBe("");
  });

  it("reads the store name as empty when the read itself rejects", async () => {
    const port = tenancyStoreIdentity(() => Promise.reject(new Error("tenancy is down")));
    await expect(port.storeName("t")).resolves.toBe("");
  });

  it("hashes with scrypt and verifies", async () => {
    const hasher = scryptStorefrontPasswordHasher({ log2N: 10 });
    const hash = await hasher.hash("open sesame");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await hasher.verify("open sesame", hash)).toBe(true);
    expect(await hasher.verify("nope", hash)).toBe(false);
  });

  it("every adapter is closures only: no object the tenant-mode guard could walk into", () => {
    const adapters = {
      a: mediaImageRefs(
        async () => [],
        async () => new Map(),
      ),
      b: tenancyShopHost(async () => ({ status: 200, body: { items: [] } })),
      c: tenancyStoreIdentity(async () => ({ status: 200, body: { name: "" } })),
      d: scryptStorefrontPasswordHasher(),
    };
    for (const adapter of Object.values(adapters)) {
      for (const value of Object.values(adapter)) expect(typeof value).toBe("function");
    }
    expect(findConstructionTimeTenants(adapters, [])).toEqual([]);
  });
});
