import { describe, expect, it } from "vitest";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InventoryItem } from "./inventory-item";
import { resolveStockRow } from "./resolve-stock-row";
import { WarehouseId } from "./value-objects/warehouse-id";

function row(id: string, variantRef: string | null): InventoryItem {
  const product = ProductRef.create("p1");
  const warehouse = WarehouseId.create("w1");
  if (!product.ok || !warehouse.ok) throw new Error("invalid fixture");
  return InventoryItem.create(UniqueEntityId.from(id), product.value, warehouse.value, variantRef);
}

describe("resolveStockRow (Plan 2B-1 lookup rule)", () => {
  const m = row("m", "v-m");
  const l = row("l", "v-l");
  const legacy = row("legacy", null);

  it("with a variant id, returns that variant's own row", () => {
    expect(resolveStockRow([m, l], "v-l")).toBe(l);
  });

  it("with a variant id and no row of its own, falls back to the product's only legacy row", () => {
    expect(resolveStockRow([legacy], "v-only")).toBe(legacy);
  });

  it("with a variant id and no row of its own, never stands in for it while other rows exist", () => {
    expect(resolveStockRow([m, l], "v-s")).toBeNull();
    expect(resolveStockRow([legacy, m], "v-s")).toBeNull();
    expect(resolveStockRow([m], "v-s")).toBeNull();
  });

  it("without a variant id, returns the product's only row", () => {
    expect(resolveStockRow([legacy], undefined)).toBe(legacy);
    expect(resolveStockRow([m], undefined)).toBe(m);
  });

  it("without a variant id and with several rows, names nothing", () => {
    expect(resolveStockRow([m, l], undefined)).toBeNull();
    expect(resolveStockRow([], undefined)).toBeNull();
    expect(resolveStockRow([], "v-m")).toBeNull();
  });
});
