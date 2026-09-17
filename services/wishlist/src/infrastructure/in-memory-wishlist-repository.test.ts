import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Wishlist } from "../domain/wishlist";
import { WishlistEventTranslator } from "./wishlist-event-translator";
import { InMemoryWishlistRepository } from "./in-memory-wishlist-repository";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new WishlistEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "wishlist",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryWishlistRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryWishlistRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's wishlist by id, customerRef, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const wishlist = Wishlist.create(UniqueEntityId.from(nextId()), "customer-1");
    await repository.save(wishlist, "tenant-a");

    expect(await repository.findById(wishlist.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(wishlist.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByCustomerRef("customer-1", "tenant-a")).not.toBeNull();
    expect(await repository.findByCustomerRef("customer-1", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((w) => w.id.toString())).toContain(wishlist.id.toString());
    expect(pageB.items.map((w) => w.id.toString())).not.toContain(wishlist.id.toString());
  });
});
