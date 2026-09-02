import { describe, expect, it } from "vitest";
import { BusinessRuleError } from "@platform/domain";
import { Quantity } from "./quantity";
import { StockLevel } from "./stock-level";
import { WarehouseId } from "./warehouse-id";

describe("Quantity", () => {
  it("requires a positive integer", () => {
    expect(Quantity.create(5).ok).toBe(true);
    expect(Quantity.create(0).ok).toBe(false);
    expect(Quantity.create(1.5).ok).toBe(false);
  });
});

describe("WarehouseId", () => {
  it("rejects blank ids", () => {
    expect(WarehouseId.create("wh-1").ok).toBe(true);
    expect(WarehouseId.create("  ").ok).toBe(false);
  });
});

describe("StockLevel", () => {
  it("validates and computes availability", () => {
    const level = StockLevel.create(10, 3);
    expect(level.ok).toBe(true);
    if (level.ok) {
      expect(level.value.available).toBe(7);
    }
    expect(StockLevel.create(2, 5).ok).toBe(false); // reserved > onHand
  });

  it("reserves within availability and rejects over-reservation", () => {
    const level = StockLevel.zero().receive(10);
    expect(level.reserve(4).reserved).toBe(4);
    expect(() => level.reserve(11)).toThrow(BusinessRuleError);
  });

  it("rejects adjusting on-hand below reserved", () => {
    const level = StockLevel.zero().receive(10).reserve(6);
    expect(() => level.adjustTo(5)).toThrow(BusinessRuleError);
  });
});
