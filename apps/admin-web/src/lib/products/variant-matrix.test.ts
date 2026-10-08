import { describe, expect, it } from "vitest";
import {
  MAX_VARIANTS,
  combinations,
  planOptionChange,
  sameSelection,
  type MatrixOperation,
  type MatrixOption,
  type MatrixVariant,
} from "./variant-matrix";

interface State {
  options: MatrixOption[];
  variants: { id: string; sku: string; selection: Record<string, string> | null }[];
}

/** Applies a plan with the backend's invariants; throws on the first illegal step. */
function apply(start: State, operations: readonly MatrixOperation[]): State {
  const state: State = structuredClone(start);
  const allowed = (selection: Record<string, string>) =>
    Object.entries(selection).every(([name, value]) =>
      state.options.some((o) => o.name === name && o.values.includes(value)),
    );
  let next = 0;
  for (const op of operations) {
    if (op.kind === "remove") {
      if (state.variants.length <= 1) throw new Error("would remove the last variant");
      state.variants = state.variants.filter((v) => v.id !== op.variantId);
    } else if (op.kind === "setOptions") {
      state.options = op.options.map((o) => ({ name: o.name, values: [...o.values] }));
      for (const v of state.variants) {
        if (v.selection !== null && !allowed(v.selection)) {
          throw new Error(`setOptions while ${v.id} holds a removed value`);
        }
      }
    } else if (op.kind === "assign") {
      if (op.selection !== null) {
        if (!allowed(op.selection)) throw new Error("assign to an undeclared value");
        if (
          state.variants.some(
            (v) =>
              v.id !== op.variantId &&
              v.selection !== null &&
              sameSelection(v.selection, op.selection!),
          )
        ) {
          throw new Error("assign a duplicate selection");
        }
      }
      const target = state.variants.find((v) => v.id === op.variantId);
      if (target === undefined) throw new Error("assign to a missing variant");
      target.selection = op.selection;
    } else {
      if (!allowed(op.selection)) throw new Error("add with an undeclared value");
      if (
        state.variants.some((v) => v.selection !== null && sameSelection(v.selection, op.selection))
      ) {
        throw new Error("add a duplicate selection");
      }
      state.variants.push({ id: `new-${(next += 1)}`, sku: op.sku, selection: op.selection });
    }
  }
  return state;
}

const v = (id: string, selection: Record<string, string> | null): MatrixVariant => ({
  id,
  sku: `SKU-${id}`,
  selection,
  priceAmountMinor: 1999,
  currency: "USD",
});

describe("variant matrix (Plan 2C-2)", () => {
  it("builds combinations in option order", () => {
    expect(
      combinations([
        { name: "Color", values: ["Red", "Blue"] },
        { name: "Size", values: ["S", "L"] },
      ]),
    ).toEqual([
      { Color: "Red", Size: "S" },
      { Color: "Red", Size: "L" },
      { Color: "Blue", Size: "S" },
      { Color: "Blue", Size: "L" },
    ]);
  });

  it("first options on a plain product: the existing variant takes the first combination", () => {
    const start: State = { options: [], variants: [{ id: "a", sku: "SKU-a", selection: null }] };
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("a", null)],
      nextOptions: [{ name: "Size", values: ["S", "M", "L"] }],
    });
    if (!plan.ok) throw new Error(plan.reason);
    const end = apply(start, plan.operations);
    expect(end.variants.map((x) => x.selection)).toEqual([
      { Size: "S" },
      { Size: "M" },
      { Size: "L" },
    ]);
    expect(end.variants[0]?.id).toBe("a"); // id kept: carts and stock still point at it
    expect(plan.summary).toEqual({ adds: 2, removes: 0 });
  });

  it("removing a value removes only the variants that used it", () => {
    const start: State = {
      options: [{ name: "Size", values: ["S", "M", "L"] }],
      variants: [
        { id: "s", sku: "SKU-s", selection: { Size: "S" } },
        { id: "m", sku: "SKU-m", selection: { Size: "M" } },
        { id: "l", sku: "SKU-l", selection: { Size: "L" } },
      ],
    };
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("s", { Size: "S" }), v("m", { Size: "M" }), v("l", { Size: "L" })],
      nextOptions: [{ name: "Size", values: ["S", "L"] }],
    });
    if (!plan.ok) throw new Error(plan.reason);
    const end = apply(start, plan.operations);
    expect(end.variants.map((x) => x.id)).toEqual(["s", "l"]);
    expect(plan.summary).toEqual({ adds: 0, removes: 1 });
  });

  it("adding a second option re-assigns existing variants instead of recreating them", () => {
    const start: State = {
      options: [{ name: "Size", values: ["S", "L"] }],
      variants: [
        { id: "s", sku: "SKU-s", selection: { Size: "S" } },
        { id: "l", sku: "SKU-l", selection: { Size: "L" } },
      ],
    };
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("s", { Size: "S" }), v("l", { Size: "L" })],
      nextOptions: [
        { name: "Size", values: ["S", "L"] },
        { name: "Color", values: ["Red", "Blue"] },
      ],
    });
    if (!plan.ok) throw new Error(plan.reason);
    const end = apply(start, plan.operations);
    expect(end.variants).toHaveLength(4);
    expect(end.variants.find((x) => x.id === "s")?.selection).toEqual({
      Size: "S",
      Color: "Red",
    });
    expect(end.variants.find((x) => x.id === "l")?.selection).toEqual({
      Size: "L",
      Color: "Red",
    });
  });

  it("removing every option leaves one plain variant", () => {
    const start: State = {
      options: [{ name: "Size", values: ["S", "L"] }],
      variants: [
        { id: "s", sku: "SKU-s", selection: { Size: "S" } },
        { id: "l", sku: "SKU-l", selection: { Size: "L" } },
      ],
    };
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("s", { Size: "S" }), v("l", { Size: "L" })],
      nextOptions: [],
    });
    if (!plan.ok) throw new Error(plan.reason);
    const end = apply(start, plan.operations);
    expect(end.options).toEqual([]);
    expect(end.variants).toEqual([{ id: "s", sku: "SKU-s", selection: null }]);
  });

  it("new variants copy the first variant's price and get unique SKUs", () => {
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("a", null)],
      nextOptions: [{ name: "Size", values: ["S", "M"] }],
    });
    if (!plan.ok) throw new Error(plan.reason);
    const adds = plan.operations.filter((op) => op.kind === "add");
    expect(adds).toEqual([
      {
        kind: "add",
        sku: "P-1-M",
        selection: { Size: "M" },
        priceAmountMinor: 1999,
        currency: "USD",
      },
    ]);
  });

  it("refuses too many combinations, more than three options, and blank or duplicate values", () => {
    const many = Array.from({ length: 11 }, (_, i) => `v${i}`);
    expect(
      planOptionChange({
        productSku: "P-1",
        variants: [v("a", null)],
        nextOptions: [
          { name: "A", values: many },
          { name: "B", values: many },
        ],
      }),
    ).toEqual({ ok: false, reason: "too_many_variants" });
    expect(MAX_VARIANTS).toBe(100);
    for (const nextOptions of [
      [
        { name: "A", values: ["x"] },
        { name: "B", values: ["x"] },
        { name: "C", values: ["x"] },
        { name: "D", values: ["x"] },
      ],
      [{ name: " ", values: ["x"] }],
      [{ name: "A", values: ["x", "x"] }],
      [
        { name: "A", values: ["x"] },
        { name: "a", values: ["y"] },
      ],
    ]) {
      expect(
        planOptionChange({ productSku: "P-1", variants: [v("a", null)], nextOptions }),
      ).toEqual({
        ok: false,
        reason: "invalid_options",
      });
    }
  });

  it("no change produces no operations", () => {
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("s", { Size: "S" }), v("l", { Size: "L" })],
      nextOptions: [{ name: "Size", values: ["S", "L"] }],
    });
    expect(plan).toEqual({
      ok: true,
      operations: [{ kind: "setOptions", options: [{ name: "Size", values: ["S", "L"] }] }],
      summary: { adds: 0, removes: 0 },
    });
  });
});
