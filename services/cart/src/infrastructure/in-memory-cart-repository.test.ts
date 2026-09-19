import { describe, expect, it } from "vitest";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Cart } from "../domain/cart";
import { CartEventTranslator } from "./cart-event-translator";
import { InMemoryCartRepository } from "./in-memory-cart-repository";

/**
 * `InMemoryCartRepository.findBySessionRef` (Phase 17.1). ADR-0014 (WP-10, T10.3): one instance
 * serves every tenant, keyed by `(tenantId, cartId)`; the two-tenant tests at the bottom prove it.
 */
function repo(): InMemoryCartRepository {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new CartEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    producer: "cart",
  });
  const context = rootEventContext({ generate: () => "evt-1" });
  return new InMemoryCartRepository({ outbox, context });
}

function guestCart(id: string, sessionRef: string): Cart {
  return Cart.create(UniqueEntityId.from(id), undefined, sessionRef, "USD");
}

describe("InMemoryCartRepository.findBySessionRef", () => {
  it("returns null when the session has no cart", async () => {
    const found = await repo().findBySessionRef("session-none", "tenant-a");
    expect(found).toBeNull();
  });

  it("finds the session's active cart", async () => {
    const store = repo();
    await store.save(guestCart("cart-1", "session-1"), "tenant-a");

    const found = await store.findBySessionRef("session-1", "tenant-a");

    expect(found?.id.toString()).toBe("cart-1");
  });

  it("ignores a cart belonging to a different session", async () => {
    const store = repo();
    await store.save(guestCart("cart-1", "session-1"), "tenant-a");

    const found = await store.findBySessionRef("session-2", "tenant-a");

    expect(found).toBeNull();
  });

  it("ignores a non-active cart for the session", async () => {
    const store = repo();
    const cart = guestCart("cart-1", "session-1");
    cart.abandon("evt-1", new Date(0));
    await store.save(cart, "tenant-a");

    const found = await store.findBySessionRef("session-1", "tenant-a");

    expect(found).toBeNull();
  });

  it("returns the last-saved matching cart when a session has more than one active cart (documented tie-break, not a new invariant)", async () => {
    const store = repo();
    await store.save(guestCart("cart-1", "session-1"), "tenant-a");
    await store.save(guestCart("cart-2", "session-1"), "tenant-a");

    const found = await store.findBySessionRef("session-1", "tenant-a");

    expect(found?.id.toString()).toBe("cart-2");
  });
});

describe("InMemoryCartRepository tenant isolation (ADR-0014)", () => {
  it("two tenants sharing one instance and identical ids never see each other's carts", async () => {
    const store = repo();
    await store.save(guestCart("cart-1", "session-1"), "tenant-a");

    expect(await store.findById("cart-1", "tenant-b")).toBeNull();
    expect(await store.findBySessionRef("session-1", "tenant-b")).toBeNull();
    expect((await store.list({ first: 10 }, "tenant-b")).items).toHaveLength(0);

    await store.save(guestCart("cart-1", "session-1"), "tenant-b");
    expect((await store.list({ first: 10 }, "tenant-a")).items).toHaveLength(1);
    expect((await store.list({ first: 10 }, "tenant-b")).items).toHaveLength(1);
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("cart", async (outbox, tenantId) => {
      const context = rootEventContext({ generate: () => "evt-1" });
      const store = new InMemoryCartRepository({ outbox, context });
      const cart = guestCart("cart-1", "session-1");
      cart.abandon("evt-1", new Date(0));
      await store.save(cart, tenantId);
    });
  });
});
