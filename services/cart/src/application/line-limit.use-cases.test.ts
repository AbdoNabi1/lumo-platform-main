import { describe, expect, it } from "vitest";
import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import type { ValidationError } from "@platform/utils";
import { Cart } from "../domain/cart";
import { Quantity } from "../domain/value-objects/quantity";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { AddItem } from "./add-item.use-case";
import { ChangeItemQuantity } from "./change-item-quantity.use-case";

/**
 * Wave 2a: the shop's add-to-cart limit, enforced where the quantity is decided. The default
 * (no `maxLineQuantity`) is today's behaviour: any positive quantity.
 */

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function cartWith(quantity: number, customerRef?: string): Cart {
  const cart = Cart.create(UniqueEntityId.from("cart-1"), customerRef, "session-1", "USD");
  cart.addItem(
    UniqueEntityId.from("item-1"),
    must(ProductRef.create("product-1")),
    must(Quantity.create(quantity)),
    must(Money.create(1500, "USD")),
  );
  return cart;
}

function repo(cart: Cart) {
  const saved: Cart[] = [];
  return {
    saved,
    carts: {
      findById: async () => cart,
      findBySessionRef: async () => cart,
      save: async (c: Cart) => {
        saved.push(c);
      },
      list: async () => {
        throw new Error("unused");
      },
    },
  };
}

const ids = { generate: () => "item-new" };

function adder(cart: Cart) {
  const { carts, saved } = repo(cart);
  const useCase = new AddItem({ carts, unitOfWork: new InMemoryUnitOfWork(), idGenerator: ids });
  const add = (quantity: number, maxLineQuantity?: number | null) =>
    useCase.execute({
      tenantId: "t1",
      cartId: "cart-1",
      productId: "product-1",
      quantity,
      unitPriceAmountMinor: 1500,
      currency: "USD",
      ...(maxLineQuantity === undefined ? {} : { maxLineQuantity }),
    });
  return { add, saved };
}

function changer(cart: Cart) {
  const { carts, saved } = repo(cart);
  const useCase = new ChangeItemQuantity({ carts, unitOfWork: new InMemoryUnitOfWork() });
  const change = (quantity: number, maxLineQuantity?: number | null) =>
    useCase.execute({
      tenantId: "t1",
      cartId: "cart-1",
      productId: "product-1",
      quantity,
      ...(maxLineQuantity === undefined ? {} : { maxLineQuantity }),
    });
  return { change, saved };
}

function quantityIssue(result: { ok: boolean; error?: unknown }) {
  if (result.ok) throw new Error("expected err");
  const error = result.error as ValidationError;
  expect(error.code).toBe("VALIDATION");
  return error.fields;
}

describe("AddItem with an add-to-cart limit", () => {
  it("no limit (default): any quantity is added, exactly as before", async () => {
    const cart = cartWith(1);
    const { add } = adder(cart);
    expect((await add(998)).ok).toBe(true);
    expect((await add(5000, null)).ok).toBe(true);
    expect(cart.items[0]?.quantity.value).toBe(1 + 998 + 5000);
  });

  it("a new line over the limit is refused on `quantity` and nothing is saved", async () => {
    const cart = Cart.create(UniqueEntityId.from("cart-1"), undefined, "session-1", "USD");
    const { add, saved } = adder(cart);
    expect(quantityIssue(await add(4, 3))).toEqual([
      { field: "quantity", message: "You can add up to 3 of this item" },
    ]);
    expect(saved).toHaveLength(0);
    expect(cart.items).toHaveLength(0);
  });

  it("adding to an existing line counts what the line already holds", async () => {
    const cart = cartWith(2);
    const { add, saved } = adder(cart);
    expect(quantityIssue(await add(2, 3))).toEqual([
      { field: "quantity", message: "You can add up to 3 of this item" },
    ]);
    expect(cart.items[0]?.quantity.value).toBe(2);
    expect(saved).toHaveLength(0);
    expect((await add(1, 3)).ok).toBe(true);
    expect(cart.items[0]?.quantity.value).toBe(3);
  });

  it("a customer's cart (assigned) is held to the same limit", async () => {
    const cart = cartWith(3, "customer-9");
    const { add } = adder(cart);
    expect(quantityIssue(await add(1, 3))).toHaveLength(1);
  });
});

describe("ChangeItemQuantity with an add-to-cart limit", () => {
  it("no limit (default): any positive quantity", async () => {
    const cart = cartWith(1);
    const { change } = changer(cart);
    expect((await change(700)).ok).toBe(true);
    expect(cart.items[0]?.quantity.value).toBe(700);
  });

  it("over the limit is refused and the line keeps its quantity", async () => {
    const cart = cartWith(2);
    const { change, saved } = changer(cart);
    expect(quantityIssue(await change(4, 3))).toEqual([
      { field: "quantity", message: "You can add up to 3 of this item" },
    ]);
    expect(cart.items[0]?.quantity.value).toBe(2);
    expect(saved).toHaveLength(0);
  });

  it("exactly the limit is fine; lowering an over-limit line to the limit is fine", async () => {
    const cart = cartWith(9);
    const { change } = changer(cart);
    expect((await change(3, 3)).ok).toBe(true);
    expect(cart.items[0]?.quantity.value).toBe(3);
  });
});
