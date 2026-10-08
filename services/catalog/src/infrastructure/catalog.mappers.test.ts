import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { Product } from "../domain/product";
import { ProductDetails } from "../domain/value-objects/product-details";
import { ProductOption } from "../domain/value-objects/product-option";
import { Sku } from "../domain/value-objects/sku";
import { Slug } from "../domain/value-objects/slug";
import { VariantSelection } from "../domain/value-objects/variant-selection";
import { DEFAULT_VARIANT_ATTRIBUTES, Variant } from "../domain/variant";
import { type ProductRow, ProductMapper, type VariantRow } from "./catalog.mappers";

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}
const money = (amount: number) => must(Money.create(amount, "USD"));

describe("ProductMapper — product details and variant attributes (Plan 2C-1)", () => {
  it("round-trips every new field through the rows", () => {
    const variant = Variant.create(
      UniqueEntityId.from("33333333-3333-4333-8333-333333333333"),
      must(Sku.create("SKU-1")),
      money(1000),
      must(VariantSelection.create({ Size: "S" })),
      {
        compareAtPrice: money(1500),
        cost: money(400),
        barcode: "622",
        weightGrams: 250,
        requiresShipping: false,
        taxable: false,
      },
    );
    const product = Product.create(
      UniqueEntityId.from("22222222-2222-4222-8222-222222222222"),
      {
        sku: must(Sku.create("P-1")),
        name: "Tee",
        slug: must(Slug.create("tee")),
        variants: [variant],
        details: must(
          ProductDetails.create({ description: "d", productType: "Shirts", tags: ["a", "b"] }),
        ),
      },
      "evt-0",
      new Date(0),
    );
    product.setOptions([must(ProductOption.create("Size", ["S", "L"]))]);

    const productRow = ProductMapper.toProductRow(product, "tenant-1");
    const variantRows = ProductMapper.toVariantRows(product, "tenant-1");
    expect(productRow.description).toBe("d");
    expect(productRow.productType).toBe("Shirts");
    expect(productRow.tags).toEqual(["a", "b"]);
    expect(variantRows[0]).toMatchObject({
      compareAtAmountMinor: 1500,
      costAmountMinor: 400,
      barcode: "622",
      weightGrams: 250,
      requiresShipping: false,
      taxable: false,
    });

    const restored = ProductMapper.toDomain(
      { ...productRow, version: 3, deletedAt: null } as ProductRow,
      variantRows as VariantRow[],
    );
    expect(restored.details.description).toBe("d");
    expect(restored.details.productType).toBe("Shirts");
    expect(restored.details.tags).toEqual(["a", "b"]);
    const restoredAttributes = restored.variants[0]?.attributes;
    expect(restoredAttributes?.compareAtPrice?.amountMinor).toBe(1500);
    expect(restoredAttributes?.cost?.amountMinor).toBe(400);
    expect(restoredAttributes?.barcode).toBe("622");
    expect(restoredAttributes?.weightGrams).toBe(250);
    expect(restoredAttributes?.requiresShipping).toBe(false);
    expect(restoredAttributes?.taxable).toBe(false);
    expect(restored.variants[0]?.selection?.values).toEqual({ Size: "S" });
  });

  it("maps legacy rows (written before the migration) to empty details and default attributes", () => {
    // Exactly what Postgres returns for a pre-migration row once the columns exist.
    const legacyProduct: ProductRow = {
      id: "22222222-2222-4222-8222-222222222222",
      sku: "P-1",
      name: "Tee",
      slug: "tee",
      publishState: "published",
      scheduledAt: null,
      brandId: null,
      categoryRefs: [],
      options: [],
      seo: null,
      mediaRefs: [],
      deletedAt: null,
      version: 1,
      description: null,
      productType: null,
      tags: [],
    };
    const legacyVariant: VariantRow = {
      id: "33333333-3333-4333-8333-333333333333",
      sku: "SKU-1",
      priceAmountMinor: 1999,
      currency: "USD",
      selection: null,
      compareAtAmountMinor: null,
      costAmountMinor: null,
      barcode: null,
      weightGrams: null,
      requiresShipping: true,
      taxable: true,
    };
    const product = ProductMapper.toDomain(legacyProduct, [legacyVariant]);
    expect(product.details).toEqual(ProductDetails.empty());
    expect(product.variants[0]?.attributes).toEqual(DEFAULT_VARIANT_ATTRIBUTES);
  });
});
