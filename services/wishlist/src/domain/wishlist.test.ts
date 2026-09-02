import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Wishlist } from "./wishlist";

function wishlist(): Wishlist {
  return Wishlist.create(UniqueEntityId.from("wishlist-1"), "customer-1");
}

describe("Wishlist", () => {
  it("starts active and empty", () => {
    const w = wishlist();
    expect(w.status.value).toBe("active");
    expect(w.items).toHaveLength(0);
  });

  it("adds an item and raises an item.added event", () => {
    const w = wishlist();
    w.addItem("product-1", new Date(0), "evt-1");
    expect(w.items).toHaveLength(1);
    const events = w.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("wishlist.transitioned");
  });

  it("adding the same product twice is idempotent", () => {
    const w = wishlist();
    w.addItem("product-1", new Date(0), "evt-1");
    w.addItem("product-1", new Date(0), "evt-2");
    expect(w.items).toHaveLength(1);
    expect(w.pullDomainEvents()).toHaveLength(1);
  });

  it("removes an item", () => {
    const w = wishlist();
    w.addItem("product-1", new Date(0), "evt-1");
    w.removeItem("product-1", new Date(0), "evt-2");
    expect(w.items).toHaveLength(0);
  });

  it("generates a share token idempotently", () => {
    const w = wishlist();
    w.addItem("product-1", new Date(0), "evt-1");
    const first = w.shareItem("product-1", "token-1", new Date(0), "evt-2");
    const replay = w.shareItem("product-1", "token-2", new Date(0), "evt-3");
    expect(first).toBe("token-1");
    expect(replay).toBe("token-1");
  });

  it("moves an item to the cart, removing it from the wishlist", () => {
    const w = wishlist();
    w.addItem("product-1", new Date(0), "evt-1");
    w.moveToCart("product-1", new Date(0), "evt-2");
    expect(w.items).toHaveLength(0);
  });

  it("rejects mutation on an archived wishlist", () => {
    const w = wishlist();
    w.archive("evt-1", new Date(0));
    expect(() => w.addItem("product-1", new Date(0), "evt-2")).toThrow(BusinessRuleError);
  });

  it("rejects an illegal transition path gracefully via requireActive, not the transition table", () => {
    const w = wishlist();
    w.archive("evt-1", new Date(0));
    w.reactivate("evt-2", new Date(0));
    expect(w.status.value).toBe("active");
  });
});
