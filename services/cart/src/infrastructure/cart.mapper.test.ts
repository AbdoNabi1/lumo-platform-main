import { describe, expect, it } from "vitest";
import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import { Cart } from "../domain/cart";
import { Quantity } from "../domain/value-objects/quantity";
import { CartMapper } from "./cart.mapper";

function ref(value: string): ProductRef {
  const result = ProductRef.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}
function qty(value: number): Quantity {
  const result = Quantity.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}
function egp(value: number): Money {
  const result = Money.create(value, "EGP");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

describe("CartMapper — variant lines (Plan 2A)", () => {
  it("round-trips a variant line and a legacy line", () => {
    const cart = Cart.create(UniqueEntityId.from("c1"), undefined, "s1", "EGP");
    cart.addItem(UniqueEntityId.from("i1"), ref("p-shirt"), qty(2), egp(12000), {
      merchandise: { variantRef: "v-l", sku: "SHIRT-L", title: "Shirt", variantTitle: "L" },
    });
    cart.addItem(UniqueEntityId.from("i2"), ref("p-mug"), qty(1), egp(5000));

    const rows = CartMapper.toItemRows(cart, "t1");
    expect(rows[0]).toMatchObject({
      variantRef: "v-l",
      sku: "SHIRT-L",
      title: "Shirt",
      variantTitle: "L",
    });
    expect(rows[1]).toMatchObject({ variantRef: null, sku: null, title: null, variantTitle: null });

    const back = CartMapper.toDomain(
      { ...CartMapper.toCartRow(cart, "t1"), customerRef: null },
      rows.map((row) => ({ ...row })),
    );
    expect(back.items.map((i) => [i.lineKey, i.sku, i.title, i.variantTitle])).toEqual([
      ["v-l", "SHIRT-L", "Shirt", "L"],
      ["p-mug", undefined, undefined, undefined],
    ]);
  });

  it("maps a row cached before the columns existed as a legacy line", () => {
    const back = CartMapper.toDomain(
      {
        id: "c1",
        customerRef: null,
        sessionRef: "s1",
        currency: "EGP",
        status: "active",
        version: 1,
      },
      [
        {
          id: "i1",
          productRef: "p-mug",
          quantity: 1,
          unitPriceAmountMinor: 5000,
          inventorySnapshot: null,
          metadata: null,
        },
      ],
    );
    expect(back.items[0]?.lineKey).toBe("p-mug");
    expect(back.items[0]?.variantRef).toBeUndefined();
  });
});
