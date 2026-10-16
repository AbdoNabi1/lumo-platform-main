import { describe, expect, it } from "vitest";
import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import { Cart } from "../domain/cart";
import { Quantity } from "../domain/value-objects/quantity";
import { GetCurrentCart } from "./get-current-cart.use-case";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function guestCartWithOneItem(sessionRef = "session-1"): Cart {
  const cart = Cart.create(UniqueEntityId.from("cart-1"), undefined, sessionRef, "USD");
  cart.addItem(
    UniqueEntityId.from("item-1"),
    must(ProductRef.create("product-1")),
    must(Quantity.create(2)),
    must(Money.create(1500, "USD")),
  );
  return cart;
}

const notSaved = async () => {
  throw new Error("save() not used by GetCurrentCart");
};
const notFoundById = async () => {
  throw new Error("findById() not used by GetCurrentCart");
};
const notListed = async () => {
  throw new Error("list() not used by GetCurrentCart");
};

describe("GetCurrentCart", () => {
  it("returns the session's active cart when found", async () => {
    const cart = guestCartWithOneItem();
    const repo = {
      findBySessionRef: async () => cart,
      findById: notFoundById,
      save: notSaved,
      list: notListed,
    };
    const useCase = new GetCurrentCart({ carts: repo });

    const result = await useCase.execute({ tenantId: "tenant-a", sessionRef: "session-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(cart);
    expect(result.value?.items).toHaveLength(1);
  });

  it("returns null (never a NotFoundError) when the session has no cart", async () => {
    const repo = {
      findBySessionRef: async () => null,
      findById: notFoundById,
      save: notSaved,
      list: notListed,
    };
    const useCase = new GetCurrentCart({ carts: repo });

    const result = await useCase.execute({
      tenantId: "tenant-a",
      sessionRef: "session-never-shopped",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it("rejects an empty sessionRef at the boundary", async () => {
    const repo = {
      findBySessionRef: notFoundById,
      findById: notFoundById,
      save: notSaved,
      list: notListed,
    };
    const useCase = new GetCurrentCart({ carts: repo });

    const result = await useCase.execute({ tenantId: "tenant-a", sessionRef: "" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
  });

  it("never calls save — a read must not mutate the cart", async () => {
    const cart = guestCartWithOneItem();
    let saveCalled = false;
    const repo = {
      findBySessionRef: async () => cart,
      findById: notFoundById,
      save: async () => {
        saveCalled = true;
      },
      list: notListed,
    };
    const useCase = new GetCurrentCart({ carts: repo });

    await useCase.execute({ tenantId: "tenant-a", sessionRef: "session-1" });

    expect(saveCalled).toBe(false);
  });
});
