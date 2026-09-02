import { describe, expect, it } from "vitest";
import { BusinessRuleError, ProductRef, UniqueEntityId } from "@platform/domain";
import { InventoryItem } from "./inventory-item";
import { Quantity } from "./value-objects/quantity";
import { WarehouseId } from "./value-objects/warehouse-id";

function qty(value: number): Quantity {
  const result = Quantity.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function item(): InventoryItem {
  const product = ProductRef.create("product-1");
  const warehouse = WarehouseId.create("wh-1");
  if (!product.ok || !warehouse.ok) throw new Error("invalid fixture");
  return InventoryItem.create(UniqueEntityId.from("item-1"), product.value, warehouse.value);
}

describe("InventoryItem", () => {
  it("receives stock and emits inventory.adjusted (received)", () => {
    const inventory = item();
    inventory.receive(qty(10), "evt-1", new Date(0));

    expect(inventory.stockLevel.onHand).toBe(10);
    const events = inventory.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("inventory.adjusted");
  });

  it("reserves and releases, tracking available stock", () => {
    const inventory = item();
    inventory.receive(qty(10), "e1", new Date(0));
    inventory.reserve(UniqueEntityId.from("res-1"), qty(4), "order-1", "e2", new Date(0));
    expect(inventory.stockLevel.available).toBe(6);

    inventory.releaseReservation("res-1", "e3", new Date(0));
    expect(inventory.stockLevel.available).toBe(10);
  });

  it("rejects reserving more than available", () => {
    const inventory = item();
    inventory.receive(qty(3), "e1", new Date(0));
    expect(() =>
      inventory.reserve(UniqueEntityId.from("res-2"), qty(5), "order-2", "e2", new Date(0)),
    ).toThrow(BusinessRuleError);
  });

  it("rejects releasing an unknown reservation", () => {
    const inventory = item();
    inventory.receive(qty(3), "e1", new Date(0));
    expect(() => inventory.releaseReservation("missing", "e2", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });
});
