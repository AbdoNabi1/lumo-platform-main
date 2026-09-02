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
