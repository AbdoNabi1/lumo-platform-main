import { describe, expect, it } from "vitest";
import type { Cache } from "@platform/contracts";
import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import { Cart } from "../domain/cart";
import type { CartRepository } from "../domain/cart-repository";
import { Quantity } from "../domain/value-objects/quantity";
import { CachedCartRepository } from "./cached-cart-repository";

function fakeCache(): Cache & { readonly store: Map<string, unknown>; failReads?: boolean } {
  const store = new Map<string, unknown>();
  const cache = {
    store,
    failReads: false,
    async get<T>(key: string): Promise<T | null> {
      if (cache.failReads) throw new Error("redis down");
      return (store.get(key) as T | undefined) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async has(key: string): Promise<boolean> {
      return store.has(key);
    },
  };
  return cache;
}

function trackingInner(): CartRepository & { finds: number; saves: number } {
  const carts = new Map<string, Cart>();
  return {
    finds: 0,
    saves: 0,
    async save(cart: Cart, tenantId: string): Promise<void> {
      this.saves += 1;
      carts.set(`${tenantId}:${cart.id.toString()}`, cart);
    },
    async findById(id: string, tenantId: string): Promise<Cart | null> {
      this.finds += 1;
      return carts.get(`${tenantId}:${id}`) ?? null;
    },
    async findBySessionRef(sessionRef: string): Promise<Cart | null> {
      this.finds += 1;
      for (const cart of carts.values()) {
        if (cart.sessionRef === sessionRef && cart.status === "active") return cart;
      }
      return null;
    },
    async list() {
      return { items: [...carts.values()], pageInfo: { hasNextPage: false, endCursor: null } };
    },
  };
}

function unwrap<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("test setup");
  return r.value;
}

function newCart(id = "11111111-1111-4111-8111-111111111111"): Cart {
  const cart = Cart.create(UniqueEntityId.from(id), "customer-1", "session-1", "USD");
  cart.addItem(
    UniqueEntityId.from("22222222-2222-4222-8222-222222222222"),
    unwrap(ProductRef.create("prod-1")),
    unwrap(Quantity.create(2)),
    unwrap(Money.create(1999, "USD")),
  );
  return cart;
}

describe("CachedCartRepository", () => {
  it("reads through on miss, then serves the rehydrated aggregate from cache", async () => {
    const inner = trackingInner();
    const cache = fakeCache();
    const repo = new CachedCartRepository({ inner, cache });
    const cart = newCart();
    await repo.save(cart, "t-1");

    const first = await repo.findById(cart.id.toString(), "t-1");
    const second = await repo.findById(cart.id.toString(), "t-1");

    expect(inner.finds).toBe(1); // second read came from cache
    expect(second?.items).toHaveLength(1);
    expect(second?.totalAmount().amountMinor).toBe(3998); // invariants re-established via mapper
    expect(second?.status).toBe("active");
    expect(first?.id.toString()).toBe(cart.id.toString());
  });

  it("save invalidates the cached entry (delete, never update)", async () => {
    const inner = trackingInner();
    const cache = fakeCache();
    const repo = new CachedCartRepository({ inner, cache });
    const cart = newCart();
    await repo.save(cart, "t-1");
    await repo.findById(cart.id.toString(), "t-1"); // populate
    expect(cache.store.size).toBe(1);

    cart.abandon("33333333-3333-4333-8333-333333333333", new Date(0));
    await repo.save(cart, "t-1");

    expect(cache.store.size).toBe(0);
    const reloaded = await repo.findById(cart.id.toString(), "t-1");
    expect(reloaded?.status).toBe("abandoned");
  });

  it("transactional reads bypass the cache entirely (read-your-writes)", async () => {
    const inner = trackingInner();
    const cache = fakeCache();
    const repo = new CachedCartRepository({ inner, cache });
    const cart = newCart();
    await repo.save(cart, "t-1");
    await repo.findById(cart.id.toString(), "t-1"); // populate cache

    await repo.findById(cart.id.toString(), "t-1", { tx: true });

    expect(inner.finds).toBe(2); // tx read went to the source of truth
  });

  it("degrades to the source of truth when the cache read fails", async () => {
    const inner = trackingInner();
    const cache = fakeCache();
    const repo = new CachedCartRepository({ inner, cache });
    const cart = newCart();
    await repo.save(cart, "t-1");
    cache.failReads = true;

    const loaded = await repo.findById(cart.id.toString(), "t-1");

    expect(loaded).not.toBeNull();
    expect(inner.finds).toBe(1);
  });

  it("findBySessionRef is a pure passthrough — never cached (Phase 17.1)", async () => {
    const inner = trackingInner();
    const cache = fakeCache();
    const repo = new CachedCartRepository({ inner, cache });
    const cart = newCart();
    await repo.save(cart, "t-1");

    const first = await repo.findBySessionRef("session-1", "t-1");
    const second = await repo.findBySessionRef("session-1", "t-1");

    expect(first?.id.toString()).toBe(cart.id.toString());
    expect(second?.id.toString()).toBe(cart.id.toString());
    expect(inner.finds).toBe(2); // no cache read short-circuited the second call
    expect(cache.store.size).toBe(0); // nothing was ever written to the cache
  });

  it("tenant-prefixes every cache key (ADR-0008)", async () => {
    const inner = trackingInner();
    const cache = fakeCache();
    const repo = new CachedCartRepository({ inner, cache });
    const cart = newCart();
    await repo.save(cart, "t-9");
    await repo.findById(cart.id.toString(), "t-9");

    expect([...cache.store.keys()][0]).toBe(`tenant:t-9:cart:${cart.id.toString()}`);
  });

  it("one instance serves two tenants: an entry cached for tenant A is not served to tenant B (ADR-0014)", async () => {
    const inner = trackingInner();
    const cache = fakeCache();
    const repo = new CachedCartRepository({ inner, cache });
    const cart = newCart();
    await repo.save(cart, "tenant-a");
    await repo.findById(cart.id.toString(), "tenant-a"); // populate tenant A's key

    expect(await repo.findById(cart.id.toString(), "tenant-b")).toBeNull();
    expect([...cache.store.keys()]).toEqual([`tenant:tenant-a:cart:${cart.id.toString()}`]);
  });
});
