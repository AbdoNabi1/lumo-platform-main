import { describe, expect, it } from "vitest";
import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import { Cart } from "./cart";
import { Quantity } from "./value-objects/quantity";

const ref = (v: string): ProductRef => {
  const r = ProductRef.create(v);
  if (!r.ok) throw new Error("bad ref");
  return r.value;
};
const qty = (n: number): Quantity => {
  const q = Quantity.create(n);
  if (!q.ok) throw new Error("bad qty");
  return q.value;
};
const egp = (n: number): Money => {
  const m = Money.create(n, "EGP");
  if (!m.ok) throw new Error("bad money");
  return m.value;
};
const shirtS = { variantRef: "v-s", sku: "SHIRT-S", title: "Shirt", variantTitle: "S" };
const shirtL = { variantRef: "v-l", sku: "SHIRT-L", title: "Shirt", variantTitle: "L" };

function emptyCart(): Cart {
  return Cart.create(UniqueEntityId.from("cart-1"), "customer-1", "session-1", "EGP");
}

describe("cart lines keyed by variant (Plan 2A)", () => {
  it("two sizes of one product are two lines; the same size twice increments", () => {
    const cart = emptyCart();
    cart.addItem(UniqueEntityId.from("i1"), ref("p-shirt"), qty(1), egp(10000), {
      merchandise: shirtS,
    });
    cart.addItem(UniqueEntityId.from("i2"), ref("p-shirt"), qty(1), egp(12000), {
      merchandise: shirtL,
    });
    cart.addItem(UniqueEntityId.from("i3"), ref("p-shirt"), qty(2), egp(10000), {
      merchandise: shirtS,
    });
    expect(cart.items.map((i) => [i.lineKey, i.quantity.value])).toEqual([
      ["v-s", 3],
      ["v-l", 1],
    ]);
    expect(cart.totalAmount().amountMinor).toBe(3 * 10000 + 12000);
  });

  it("quantity and remove address a line by its variant", () => {
    const cart = emptyCart();
    cart.addItem(UniqueEntityId.from("i1"), ref("p-shirt"), qty(1), egp(10000), {
      merchandise: shirtS,
    });
    cart.addItem(UniqueEntityId.from("i2"), ref("p-shirt"), qty(1), egp(12000), {
      merchandise: shirtL,
    });
    cart.changeItemQuantity("v-l", qty(4));
    cart.removeItem("v-s");
    expect(cart.items.map((i) => [i.lineKey, i.quantity.value, i.sku, i.variantTitle])).toEqual([
      ["v-l", 4, "SHIRT-L", "L"],
    ]);
  });

  it("a line without a variant is keyed by product exactly as before", () => {
    const cart = emptyCart();
    cart.addItem(UniqueEntityId.from("i1"), ref("p-mug"), qty(1), egp(5000));
    cart.changeItemQuantity("p-mug", qty(2));
    expect(cart.items[0]?.lineKey).toBe("p-mug");
    expect(cart.items[0]?.variantRef).toBeUndefined();
    cart.removeItem("p-mug");
    expect(cart.items).toHaveLength(0);
  });

  it("a legacy line and a variant line of the same product stay separate lines", () => {
    const cart = emptyCart();
    cart.addItem(UniqueEntityId.from("i1"), ref("p-shirt"), qty(1), egp(9000));
    cart.addItem(UniqueEntityId.from("i2"), ref("p-shirt"), qty(1), egp(10000), {
      merchandise: shirtS,
    });
    expect(cart.items.map((i) => i.lineKey)).toEqual(["p-shirt", "v-s"]);
  });

  it("replace-variant finds the old line by its key and swaps in the new merchandise", () => {
    const cart = emptyCart();
    cart.addItem(UniqueEntityId.from("i1"), ref("p-shirt"), qty(2), egp(10000), {
      merchandise: shirtS,
    });
    cart.replaceItemVariant(UniqueEntityId.from("i2"), "v-s", ref("p-shirt"), qty(2), egp(12000), {
      merchandise: shirtL,
    });
    expect(cart.items.map((i) => [i.lineKey, i.quantity.value, i.variantTitle])).toEqual([
      ["v-l", 2, "L"],
    ]);
  });

  it("merge folds matching variant lines together and keeps other sizes apart", () => {
    const target = emptyCart();
    target.addItem(UniqueEntityId.from("i1"), ref("p-shirt"), qty(1), egp(10000), {
      merchandise: shirtS,
    });
    const source = Cart.create(UniqueEntityId.from("cart-2"), undefined, "session-2", "EGP");
    source.addItem(UniqueEntityId.from("j1"), ref("p-shirt"), qty(2), egp(10000), {
      merchandise: shirtS,
    });
    source.addItem(UniqueEntityId.from("j2"), ref("p-shirt"), qty(1), egp(12000), {
      merchandise: shirtL,
    });
    target.merge(source, "evt-1", new Date("2026-01-01T00:00:00.000Z"));
    expect(target.items.map((i) => [i.lineKey, i.quantity.value])).toEqual([
      ["v-s", 3],
      ["v-l", 1],
    ]);
  });

  it("a product id alone reaches the line when the product has exactly one line (older clients)", () => {
    const cart = emptyCart();
    cart.addItem(UniqueEntityId.from("i1"), ref("p-shirt"), qty(1), egp(10000), {
      merchandise: shirtS,
    });
    cart.changeItemQuantity("p-shirt", qty(3));
    expect(cart.items[0]?.quantity.value).toBe(3);
    cart.removeItem("p-shirt");
    expect(cart.items).toHaveLength(0);
  });

  it("a product id alone names nothing once the product has two lines", () => {
    const cart = emptyCart();
    cart.addItem(UniqueEntityId.from("i1"), ref("p-shirt"), qty(1), egp(10000), {
      merchandise: shirtS,
    });
    cart.addItem(UniqueEntityId.from("i2"), ref("p-shirt"), qty(1), egp(12000), {
      merchandise: shirtL,
    });
    expect(() => cart.removeItem("p-shirt")).toThrow("Item not found in cart");
    expect(() => cart.changeItemQuantity("p-shirt", qty(2))).toThrow("Item not found in cart");
    expect(cart.items).toHaveLength(2);
  });
});
