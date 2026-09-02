import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetWishlistByCustomer } from "./get-wishlist-by-customer.use-case";
import { GetWishlist } from "./get-wishlist.use-case";
import { ListWishlists } from "./list-wishlists.use-case";
import { CreateWishlist } from "./wishlist.use-cases";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { InMemoryWishlistRepository } from "../infrastructure/in-memory-wishlist-repository";
import { WishlistEventTranslator } from "../infrastructure/wishlist-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new WishlistEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "wishlist",
  });
  const context = rootEventContext(sequentialIds());
  const wishlists = new InMemoryWishlistRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { wishlists, unitOfWork, idGenerator, clock };
}

describe("Wishlist read use-cases (Phase 4 T4.2)", () => {
  it("ListWishlists paginates", async () => {
    const h = harness();
    const create = new CreateWishlist(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute({ customerRef: `customer-${i}` });
    }

    const page = await new ListWishlists(h).execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListWishlists(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetWishlist returns the wishlist, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateWishlist(h).execute({ customerRef: "customer-1" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetWishlist(h).execute({ wishlistId: created.value.wishlistId });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.id.toString()).toBe(created.value.wishlistId);

    const missing = await new GetWishlist(h).execute({ wishlistId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("GetWishlistByCustomer returns the customer's one wishlist, or NotFoundError when absent", async () => {
    const h = harness();
    await new CreateWishlist(h).execute({ customerRef: "customer-1" });

    const found = await new GetWishlistByCustomer(h).execute({ customerRef: "customer-1" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.customerRef).toBe("customer-1");

    const missing = await new GetWishlistByCustomer(h).execute({ customerRef: "nobody" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
