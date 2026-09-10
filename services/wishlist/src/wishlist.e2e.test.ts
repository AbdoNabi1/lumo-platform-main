import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireWishlist } from "./composition";
import { InMemoryCartPort } from "./infrastructure/in-memory-port-adapters";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

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

describe("wishlist (end to end)", () => {
  it("runs the full lifecycle: create -> add -> share -> move to cart, publishing canonical events", async () => {
    const cart = new InMemoryCartPort();
    const app = wire(cart);
    const id = await newWishlistId(app);

    const added = await app.wishlist.addItem({
      wishlistId: id,
      productRef: "product-1",
      tenantId: "tenant-local",
    });
    expect(added.status).toBe(200);
    expect((added.body as { itemCount: number }).itemCount).toBe(1);

    const shared = await app.wishlist.shareItem({
      wishlistId: id,
      productRef: "product-1",
      tenantId: "tenant-local",
    });
    expect(shared.status).toBe(200);
    expect((shared.body as { shareToken: string }).shareToken).toBeTruthy();

    const moved = await app.wishlist.moveItemToCart({
      wishlistId: id,
      productRef: "product-1",
      tenantId: "tenant-local",
    });
    expect(moved.status).toBe(200);
    expect((moved.body as { itemCount: number }).itemCount).toBe(0);
    expect(cart.addedItems).toHaveLength(1);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("wishlist.item.added");
    expect(app.deliveredEventTypes).toContain("wishlist.item.shared");
    expect(app.deliveredEventTypes).toContain("wishlist.item.moved_to_cart");
  });

  it("adding the same product twice is idempotent", async () => {
    const app = wire();
    const id = await newWishlistId(app);
    await app.wishlist.addItem({
      wishlistId: id,
      productRef: "product-1",
      tenantId: "tenant-local",
    });
    const replay = await app.wishlist.addItem({
      wishlistId: id,
      productRef: "product-1",
      tenantId: "tenant-local",
    });
    expect((replay.body as { itemCount: number }).itemCount).toBe(1);
  });

  it("rejects creating a second wishlist for the same customer (409)", async () => {
    const app = wire();
    await newWishlistId(app);
    const response = await app.wishlist.create({
      customerRef: "customer-1",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(409);
  });

  it("rejects adding an item to an archived wishlist (409)", async () => {
    const app = wire();
    const id = await newWishlistId(app);
    await app.wishlist.advance({ wishlistId: id, toStatus: "archived", tenantId: "tenant-local" });
    const response = await app.wishlist.addItem({
      wishlistId: id,
      productRef: "product-1",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown wishlist", async () => {
    const app = wire();
    const response = await app.wishlist.addItem({
      wishlistId: "missing",
      productRef: "product-1",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(404);
  });
});
