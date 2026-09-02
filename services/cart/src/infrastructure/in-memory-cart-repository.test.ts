import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Cart } from "../domain/cart";
import { CartEventTranslator } from "./cart-event-translator";
import { InMemoryCartRepository } from "./in-memory-cart-repository";

/**
 * `InMemoryCartRepository.findBySessionRef` (Phase 17.1). No tenant field exists on this branch
 * (ADR-0008 tenant scoping is a Prisma-level concern — every in-memory repo in this codebase is
 * single-tenant by construction, one instance per `wireCart()` call); cross-tenant isolation for
 * the guest-cart flow is covered at the HTTP layer instead, where two tenants are simulated with
 * two separate compositions.
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
    const found = await repo().findBySessionRef("session-none");
    expect(found).toBeNull();
  });

  it("finds the session's active cart", async () => {
    const store = repo();
    await store.save(guestCart("cart-1", "session-1"));

    const found = await store.findBySessionRef("session-1");

    expect(found?.id.toString()).toBe("cart-1");
  });

  it("ignores a cart belonging to a different session", async () => {
    const store = repo();
    await store.save(guestCart("cart-1", "session-1"));

    const found = await store.findBySessionRef("session-2");

    expect(found).toBeNull();
  });

  it("ignores a non-active cart for the session", async () => {
    const store = repo();
    const cart = guestCart("cart-1", "session-1");
    cart.abandon("evt-1", new Date(0));
    await store.save(cart);

    const found = await store.findBySessionRef("session-1");

    expect(found).toBeNull();
  });

  it("returns the last-saved matching cart when a session has more than one active cart (documented tie-break, not a new invariant)", async () => {
    const store = repo();
    await store.save(guestCart("cart-1", "session-1"));
    await store.save(guestCart("cart-2", "session-1"));

    const found = await store.findBySessionRef("session-1");

    expect(found?.id.toString()).toBe("cart-2");
  });
});
