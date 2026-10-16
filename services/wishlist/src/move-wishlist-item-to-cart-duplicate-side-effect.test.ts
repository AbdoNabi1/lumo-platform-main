import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireWishlist } from "./composition";
import { InMemoryCartPort } from "./infrastructure/in-memory-port-adapters";

/**
 * Phase A.17 — systemic FSM/idempotency sweep.
 *
 * `MoveWishlistItemToCart` called `CartPort.addItem()` (an external, cross-context side effect)
 * BEFORE validating (via `Wishlist.moveToCart()`) that the product is actually present and the
 * wishlist is active. Two consequences, both duplicate-external-side-effect defects:
 *
 * 1. Attempting to move an absent/already-moved product still fires `cart.addItem()` before the
 *    domain rejects the call — a wasted call every time the operation is invalid.
 * 2. A client retry after a successful move (e.g. a timed-out response, ambiguous to the caller)
 *    re-invokes `execute()`; `cart.addItem()` fires again unconditionally (no dedup at that call
 *    site), and only THEN does `wishlist.moveToCart()` throw "item not found" — so the visible
 *    response is an error, silently masking that the item was just added to the cart a second
 *    time.
 */

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-13T00:00:00.000Z") };

function wire(cart = new InMemoryCartPort()) {
  return wireWishlist({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    cart,
  });
}

async function newWishlistId(app: ReturnType<typeof wire>): Promise<string> {
  const created = await app.wishlist.create({
    customerRef: "customer-1",
    tenantId: "tenant-local",
  });
  expect(created.status).toBe(201);
  return (created.body as { wishlistId: string }).wishlistId;
}

describe("MoveWishlistItemToCart duplicate side-effect (Phase A.17)", () => {
  it("does not call cart.addItem when the product is not in the wishlist", async () => {
    const cart = new InMemoryCartPort();
    const app = wire(cart);
    const id = await newWishlistId(app);

    const response = await app.wishlist.moveItemToCart({
      wishlistId: id,
      productRef: "never-added",
      tenantId: "tenant-local",
    });

    expect(response.status).not.toBe(200);
    expect(cart.addedItems).toHaveLength(0);
  });

  it("does not add the item to the cart a second time when the move is retried after it already succeeded", async () => {
    const cart = new InMemoryCartPort();
    const app = wire(cart);
    const id = await newWishlistId(app);
    await app.wishlist.addItem({
      wishlistId: id,
      productRef: "product-1",
      tenantId: "tenant-local",
    });

    const first = await app.wishlist.moveItemToCart({
      wishlistId: id,
      productRef: "product-1",
      tenantId: "tenant-local",
    });
    expect(first.status).toBe(200);
    expect(cart.addedItems).toHaveLength(1);

    const retry = await app.wishlist.moveItemToCart({
      wishlistId: id,
      productRef: "product-1",
      tenantId: "tenant-local",
    });
    expect(retry.status).not.toBe(200);
    expect(cart.addedItems).toHaveLength(1);
  });
});
