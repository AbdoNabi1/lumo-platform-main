import { describe, expect, it } from "vitest";
import { BusinessRuleError, Money, UniqueEntityId, ValidationError } from "@platform/domain";
import { Product } from "./product";
import { ProductOption } from "./value-objects/product-option";
import { Sku } from "./value-objects/sku";
import { Slug } from "./value-objects/slug";
import { VariantSelection } from "./value-objects/variant-selection";
import { toVariantAttributes } from "../application/variant-attributes-input";
import { DEFAULT_VARIANT_ATTRIBUTES, Variant, type VariantAttributes } from "./variant";

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}
const money = (amount: number, currency = "USD") => must(Money.create(amount, currency));
const sku = (value: string) => must(Sku.create(value));
const selection = (values: Record<string, string>) => must(VariantSelection.create(values));
const attrs = (overrides: Partial<VariantAttributes>): VariantAttributes => ({
  ...DEFAULT_VARIANT_ATTRIBUTES,
  ...overrides,
});

function product(variants: Variant[]): Product {
  return Product.create(
    UniqueEntityId.from("product-1"),
    { sku: sku("P-1"), name: "Tee", slug: must(Slug.create("tee")), variants },
    "evt-0",
    new Date(0),
  );
}

describe("Variant attributes (Plan 2C-1)", () => {
  it("defaults to no compare-at/cost/barcode/weight, physical and taxable", () => {
    const variant = Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000));
    expect(variant.attributes).toEqual(DEFAULT_VARIANT_ATTRIBUTES);
    expect(variant.attributes.requiresShipping).toBe(true);
    expect(variant.attributes.taxable).toBe(true);
  });

  it("keeps a compare-at price higher than the price, and a cost", () => {
    const variant = Variant.create(
      UniqueEntityId.from("v-1"),
      sku("S-1"),
      money(1000),
      null,
      attrs({ compareAtPrice: money(1500), cost: money(400), barcode: "6221234567890" }),
    );
    expect(variant.attributes.compareAtPrice?.amountMinor).toBe(1500);
    expect(variant.attributes.cost?.amountMinor).toBe(400);
  });

  it("rejects a compare-at price that is not higher than the price", () => {
    expect(() =>
      Variant.create(
        UniqueEntityId.from("v-1"),
        sku("S-1"),
        money(1000),
        null,
        attrs({ compareAtPrice: money(1000) }),
      ),
    ).toThrow(ValidationError);
  });

  it("rejects attributes in another currency, a blank barcode and a negative weight", () => {
    for (const bad of [
      attrs({ compareAtPrice: money(1500, "EGP") }),
      attrs({ cost: money(100, "EGP") }),
      attrs({ barcode: "   " }),
      attrs({ weightGrams: -1 }),
      attrs({ weightGrams: 1.5 }),
    ]) {
      expect(() =>
        Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000), null, bad),
      ).toThrow(ValidationError);
    }
  });
});

describe("Product.updateVariant with changes (Plan 2C-1)", () => {
  it("changes the selection of a variant to one the options declare", () => {
    const p = product([Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000))]);
    p.setOptions([must(ProductOption.create("Size", ["S", "L"]))]);
    p.updateVariant(
      "v-1",
      {
        sku: sku("S-1"),
        price: money(1000),
        selection: selection({ Size: "S" }),
        attributes: DEFAULT_VARIANT_ATTRIBUTES,
      },
      "evt-1",
      new Date(0),
    );
    expect(p.variants[0]?.selection?.values).toEqual({ Size: "S" });
  });

  it("rejects a selection that another variant already has, or that no option declares", () => {
    const p = product([Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000))]);
    p.setOptions([must(ProductOption.create("Size", ["S", "L"]))]);
    p.addVariant(
      Variant.create(UniqueEntityId.from("v-2"), sku("S-2"), money(1200), selection({ Size: "L" })),
      "evt-1",
      new Date(0),
    );
    const change = (values: Record<string, string>) => () =>
      p.updateVariant(
        "v-1",
        {
          sku: sku("S-1"),
          price: money(1000),
          selection: selection(values),
          attributes: DEFAULT_VARIANT_ATTRIBUTES,
        },
        "evt-2",
        new Date(0),
      );
    expect(change({ Size: "L" })).toThrow(BusinessRuleError);
    expect(change({ Size: "XL" })).toThrow(BusinessRuleError);
  });

  it("keeps every variant of a product in one currency", () => {
    const p = product([Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000))]);
    expect(() =>
      p.addVariant(
        Variant.create(UniqueEntityId.from("v-2"), sku("S-2"), money(1000, "EGP")),
        "evt-1",
        new Date(0),
      ),
    ).toThrow(BusinessRuleError);
    // A single-variant product may still change its own currency.
    p.updateVariant(
      "v-1",
      {
        sku: sku("S-1"),
        price: money(5000, "EGP"),
        selection: null,
        attributes: DEFAULT_VARIANT_ATTRIBUTES,
      },
      "evt-2",
      new Date(0),
    );
    expect(p.variants[0]?.price.currency).toBe("EGP");
  });

  it("rejects creating a product whose variants use two currencies", () => {
    expect(() =>
      product([
        Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000)),
        Variant.create(UniqueEntityId.from("v-2"), sku("S-2"), money(1000, "EGP")),
      ]),
    ).toThrow(BusinessRuleError);
  });
});

describe("Variant inventory switches (Plan 2B-1)", () => {
  const make = (overrides: Partial<VariantAttributes> = {}) =>
    Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000), null, attrs(overrides));

  it("defaults to tracked and stopping at zero, so it is stock-limited", () => {
    const variant = Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000));
    expect(variant.attributes.tracksInventory).toBe(true);
    expect(variant.attributes.inventoryPolicy).toBe("deny");
    expect(variant.isStockLimited()).toBe(true);
  });

  it("is not stock-limited when untracked, or when it continues selling past zero", () => {
    expect(make({ tracksInventory: false }).isStockLimited()).toBe(false);
    expect(make({ inventoryPolicy: "continue" }).isStockLimited()).toBe(false);
    expect(make({ tracksInventory: false, inventoryPolicy: "continue" }).isStockLimited()).toBe(
      false,
    );
  });

  it("rejects an unknown inventory policy, naming the field", () => {
    try {
      make({ inventoryPolicy: "sometimes" as never });
      throw new Error("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fields.map((issue) => issue.field)).toContain(
        "inventoryPolicy",
      );
    }
  });
});

describe("toVariantAttributes with the inventory switches (Plan 2B-1)", () => {
  it("keeps the base when neither switch is given", () => {
    const base = attrs({ tracksInventory: false, inventoryPolicy: "continue" });
    const result = toVariantAttributes({}, "USD", base);
    expect(result.ok && result.value.tracksInventory).toBe(false);
    expect(result.ok && result.value.inventoryPolicy).toBe("continue");
  });

  it("changes only the switch that is given", () => {
    const result = toVariantAttributes(
      { tracksInventory: false },
      "USD",
      DEFAULT_VARIANT_ATTRIBUTES,
    );
    expect(result.ok && result.value).toEqual({
      ...DEFAULT_VARIANT_ATTRIBUTES,
      tracksInventory: false,
    });
  });

  it("sets the inventory policy", () => {
    const result = toVariantAttributes({ inventoryPolicy: "continue" }, "USD");
    expect(result.ok && result.value.inventoryPolicy).toBe("continue");
    expect(result.ok && result.value.tracksInventory).toBe(true);
  });
});
