import { describe, expect, it } from "vitest";
import { activeLocations, buildStockView, stockByVariant, stockChange } from "./stock";

describe("stockChange (Plan 2B-2: the merchant edits AVAILABLE, as in Shopify)", () => {
  it("creates stock for a variant that has none", () => {
    expect(stockChange(5, null)).toEqual({ kind: "receive", quantity: 5 });
    expect(stockChange(0, null)).toEqual({ kind: "none" });
  });

  it("sets on-hand to available + reserved", () => {
    expect(stockChange(7, { onHand: 10, reserved: 2, available: 8 })).toEqual({
      kind: "adjust",
      onHand: 9,
    });
    expect(stockChange(8, { onHand: 10, reserved: 2, available: 8 })).toEqual({ kind: "none" });
    expect(stockChange(0, { onHand: 3, reserved: 0, available: 3 })).toEqual({
      kind: "adjust",
      onHand: 0,
    });
  });

  it("refuses a negative or fractional quantity", () => {
    expect(stockChange(-1, null)).toEqual({ kind: "invalid" });
    expect(stockChange(1.5, null)).toEqual({ kind: "invalid" });
  });
});

describe("stockByVariant (Plan 2B-1 legacy rule)", () => {
  const level = (onHand: number) => ({ onHand, reserved: 0, available: onHand });

  it("maps rows by variant", () => {
    expect(
      stockByVariant(
        [
          { variantId: "m", ...level(3) },
          { variantId: "l", ...level(4) },
        ],
        [{ id: "m" }, { id: "l" }],
      ),
    ).toEqual({ m: level(3), l: level(4) });
  });

  it("reads a lone legacy row as the only variant's stock, and ignores it otherwise", () => {
    expect(stockByVariant([{ variantId: null, ...level(9) }], [{ id: "only" }])).toEqual({
      only: level(9),
    });
    expect(
      stockByVariant(
        [
          { variantId: null, ...level(9) },
          { variantId: "m", ...level(1) },
        ],
        [{ id: "m" }, { id: "l" }],
      ),
    ).toEqual({ m: level(1) });
  });
});

describe("buildStockView (Plan 2B-2, per location since 2B-3)", () => {
  const warehouse = (id: string, status = "active") => ({ id, name: `Name ${id}`, status });
  const row = (warehouseId: string, variantId: string | null, onHand: number) => ({
    warehouseId,
    variantId,
    onHand,
    reserved: 0,
    available: onHand,
  });

  it("one location: its name and the quantities of its rows only", () => {
    expect(
      buildStockView([warehouse("w1")], [row("w1", "m", 3), row("w9", "m", 99)], [{ id: "m" }]),
    ).toEqual({
      locations: [{ id: "w1", name: "Name w1" }],
      defaultLocationId: "w1",
      readOnlyReason: null,
      byLocation: { w1: { m: { onHand: 3, reserved: 0, available: 3 } } },
    });
  });

  it("no location yet: nothing to show, and the first save registers one", () => {
    expect(buildStockView([], [], [{ id: "m" }])).toEqual({
      locations: [],
      defaultLocationId: null,
      readOnlyReason: null,
      byLocation: {},
    });
  });

  it("two active locations and one inactive: two locations, each keyed with its own quantities", () => {
    const view = buildStockView(
      [warehouse("w1"), warehouse("w2"), warehouse("w3", "inactive")],
      [row("w1", "m", 3), row("w2", "m", 8), row("w3", "m", 50)],
      [{ id: "m" }, { id: "l" }],
    );
    expect(view.locations).toEqual([
      { id: "w1", name: "Name w1" },
      { id: "w2", name: "Name w2" },
    ]);
    expect(view.byLocation["w1"]?.["m"]?.available).toBe(3);
    expect(view.byLocation["w2"]?.["m"]?.available).toBe(8);
    expect(view.byLocation["w3"]).toBeUndefined();
  });

  it("applies the legacy-row rule per location", () => {
    const view = buildStockView(
      [warehouse("w1"), warehouse("w2")],
      [row("w1", null, 9), row("w2", "only", 4)],
      [{ id: "only" }],
    );
    expect(view.byLocation["w1"]?.["only"]?.available).toBe(9);
    expect(view.byLocation["w2"]?.["only"]?.available).toBe(4);
  });

  it("the default location is the one holding the most of this product, else the first", () => {
    const rich = buildStockView(
      [warehouse("w1"), warehouse("w2")],
      [row("w1", "m", 3), row("w2", "m", 8)],
      [{ id: "m" }],
    );
    expect(rich.defaultLocationId).toBe("w2");

    const empty = buildStockView([warehouse("w1"), warehouse("w2")], [], [{ id: "m" }]);
    expect(empty.defaultLocationId).toBe("w1");
  });

  it("ignores a deactivated warehouse", () => {
    const view = buildStockView([warehouse("w1"), warehouse("w2", "inactive")], [], [{ id: "m" }]);
    expect(view.locations).toHaveLength(1);
    expect(activeLocations([warehouse("w1"), warehouse("w2", "inactive")])).toHaveLength(1);
  });
});
