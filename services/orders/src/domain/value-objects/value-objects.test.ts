import { describe, expect, it } from "vitest";
import { Money } from "@platform/domain";
import { AddressSnapshot } from "./address-snapshot";
import { OrderNumber } from "./order-number";
import { ProductSnapshot } from "./product-snapshot";

function usd(amountMinor: number): Money {
  const result = Money.create(amountMinor, "USD");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

describe("OrderNumber", () => {
  it("rejects blank values", () => {
    expect(OrderNumber.create("ORD-1").ok).toBe(true);
    expect(OrderNumber.create("  ").ok).toBe(false);
  });
});

describe("ProductSnapshot", () => {
  it("captures product id, name and unit price", () => {
    const snapshot = ProductSnapshot.create("product-1", "Toy Wagon", usd(1999));
    expect(snapshot.ok).toBe(true);
    expect(ProductSnapshot.create("", "Toy", usd(1)).ok).toBe(false);
    expect(ProductSnapshot.create("product-1", "  ", usd(1)).ok).toBe(false);
  });
});

describe("AddressSnapshot", () => {
  it("requires every field", () => {
    expect(AddressSnapshot.create("1 Main St", "Town", "12345", "US").ok).toBe(true);
    expect(AddressSnapshot.create("1 Main St", "", "12345", "US").ok).toBe(false);
  });
});

describe("AddressSnapshot — recipient extras (Plan 3A)", () => {
  it("accepts an empty postal code but still requires line1, city and country", () => {
    expect(AddressSnapshot.create("1 Main St", "Town", "", "US").ok).toBe(true);
    expect(AddressSnapshot.create("", "Town", "", "US").ok).toBe(false);
    expect(AddressSnapshot.create("1 Main St", " ", "", "US").ok).toBe(false);
    expect(AddressSnapshot.create("1 Main St", "Town", "", "").ok).toBe(false);
  });

  it("round-trips the recipient name, phone and second line", () => {
    const result = AddressSnapshot.create("1 Main St", "Town", "12345", "US", {
      recipientName: "Mona Ali",
      phone: "+201012345678",
      line2: "Flat 4",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recipientName).toBe("Mona Ali");
    expect(result.value.phone).toBe("+201012345678");
    expect(result.value.line2).toBe("Flat 4");
  });

  it("leaves the extras undefined when none are passed (existing call sites)", () => {
    const result = AddressSnapshot.create("1 Main St", "Town", "12345", "US");
    expect(result.ok && result.value.recipientName).toBeUndefined();
    expect(result.ok && result.value.phone).toBeUndefined();
    expect(result.ok && result.value.line2).toBeUndefined();
  });
});
