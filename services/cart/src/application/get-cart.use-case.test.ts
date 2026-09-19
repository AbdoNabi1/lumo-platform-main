import { describe, expect, it } from "vitest";
import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import { Cart } from "../domain/cart";
import { Quantity } from "../domain/value-objects/quantity";
import { GetCart } from "./get-cart.use-case";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function cartWithOneItem(): Cart {
  const cart = Cart.create(UniqueEntityId.from("cart-1"), "customer-1", "session-1", "USD");
  cart.addItem(
    UniqueEntityId.from("item-1"),
    must(ProductRef.create("product-1")),
    must(Quantity.create(2)),
    must(Money.create(1500, "USD")),
  );
  return cart;
}

const notSaved = async () => {
  throw new Error("save() not used by GetCart");
};

const notFoundBySession = async () => {
  throw new Error("findBySessionRef() not used by GetCart");
};

const notListed = async () => {
  throw new Error("list() not used by GetCart");
};

describe("GetCart", () => {
  it("returns the cart, unmutated, when found", async () => {
    const cart = cartWithOneItem();
    const repo = {
      findById: async () => cart,
      save: notSaved,
      findBySessionRef: notFoundBySession,
      list: notListed,
    };
    const useCase = new GetCart({ carts: repo });

    const result = await useCase.execute({ tenantId: "tenant-a", cartId: "cart-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(cart);
    expect(result.value.items).toHaveLength(1);
    expect(result.value.status).toBe("active");
  });

  it("returns 404 (NotFoundError) when the cart doesn't exist", async () => {
    const repo = {
      findById: async () => null,
      save: notSaved,
      findBySessionRef: notFoundBySession,
      list: notListed,
    };
    const useCase = new GetCart({ carts: repo });

    const result = await useCase.execute({ tenantId: "tenant-a", cartId: "missing" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("never calls save — a read must not mutate the cart", async () => {
    const cart = cartWithOneItem();
    let saveCalled = false;
    const repo = {
      findById: async () => cart,
      save: async () => {
        saveCalled = true;
      },
      findBySessionRef: notFoundBySession,
      list: notListed,
    };
    const useCase = new GetCart({ carts: repo });

    await useCase.execute({ tenantId: "tenant-a", cartId: "cart-1" });

    expect(saveCalled).toBe(false);
  });
});
