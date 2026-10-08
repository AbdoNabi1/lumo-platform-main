import { describe, expect, it } from "vitest";
import { wireCatalog, type ProductController } from "@platform/catalog";
import { CheckoutItem } from "@platform/checkout";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import {
  controllerDriver,
  seedCatalogProduct,
  type SeededProduct,
} from "../../http/testing/seed-catalog";
import { CatalogPricingValidationAdapter } from "./catalog-pricing-validation.adapter";

const clock: Clock = { now: () => new Date("2026-10-08T00:00:00.000Z") };
const TENANT = "tenant-a";

function must<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`invalid fixture: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function item(
  productRef: string,
  unitPriceAmountMinor: number,
  currency = "USD",
  variantRef?: string,
): CheckoutItem {
  const merchandise: Parameters<typeof CheckoutItem.create>[4] =
    variantRef === undefined
      ? undefined
      : { variantRef, sku: "SKU", title: "Product", variantTitle: null };
  return must(CheckoutItem.create(productRef, 1, unitPriceAmountMinor, currency, merchandise));
}

function world() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const catalog = wireCatalog({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
  const driver = controllerDriver(catalog.products, TENANT);
  /** Records every lookup the adapter makes, then delegates to the real catalog read. */
  const lookups: { productId: string; tenantId: string }[] = [];
  const recording: Pick<ProductController, "get"> = {
    get: (input) => {
      lookups.push({ productId: input.productId, tenantId: input.tenantId });
      return catalog.products.get(input);
    },
  };
  return { catalog, driver, lookups, adapter: new CatalogPricingValidationAdapter(recording) };
}

function variantOf(seeded: SeededProduct, sku: string): string {
  const found = seeded.variants.find((v) => v.sku === sku);
  if (found === undefined) throw new Error(`variant ${sku} missing`);
  return found.id;
}

describe("CatalogPricingValidationAdapter (Plan 2C-1: the variant is the only price source)", () => {
  it("valid: the snapshot equals the named variant's price", async () => {
    const w = world();
    const mug = await seedCatalogProduct(w.driver, {
      sku: "MUG",
      variants: [{ sku: "MUG-STD", priceAmountMinor: 1999 }],
    });
    const result = await w.adapter.validate(
      [item(mug.productId, 1999, "USD", mug.variantId)],
      "USD",
      TENANT,
    );
    expect(result).toEqual({ valid: true });
  });

  it("invalid: a stale snapshot (the variant is now priced differently)", async () => {
    const w = world();
    const mug = await seedCatalogProduct(w.driver, {
      sku: "MUG",
      variants: [{ sku: "MUG-STD", priceAmountMinor: 1999 }],
    });
    const result = await w.adapter.validate(
      [item(mug.productId, 1500, "USD", mug.variantId)],
      "USD",
      TENANT,
    );
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toContain("stale price");
  });

  it("invalid: an unknown variantRef, and an unknown product", async () => {
    const w = world();
    const mug = await seedCatalogProduct(w.driver, {
      sku: "MUG",
      variants: [{ sku: "MUG-STD", priceAmountMinor: 1999 }],
    });
    expect(
      (
        await w.adapter.validate(
          [item(mug.productId, 1999, "USD", "no-such-variant")],
          "USD",
          TENANT,
        )
      ).valid,
    ).toBe(false);
    expect(
      (await w.adapter.validate([item("no-such-product", 1999, "USD")], "USD", TENANT)).valid,
    ).toBe(false);
  });

  it("a legacy item (no variantRef): checked against the only variant, invalid when there are several", async () => {
    const w = world();
    const mug = await seedCatalogProduct(w.driver, {
      sku: "MUG",
      variants: [{ sku: "MUG-STD", priceAmountMinor: 1999 }],
    });
    expect(await w.adapter.validate([item(mug.productId, 1999)], "USD", TENANT)).toEqual({
      valid: true,
    });
    expect((await w.adapter.validate([item(mug.productId, 1500)], "USD", TENANT)).valid).toBe(
      false,
    );

    const shirt = await seedCatalogProduct(w.driver, {
      sku: "SHIRT",
      options: [{ name: "Size", values: ["S", "L"] }],
      variants: [
        { sku: "SHIRT-S", priceAmountMinor: 10000, selection: { Size: "S" } },
        { sku: "SHIRT-L", priceAmountMinor: 12000, selection: { Size: "L" } },
      ],
    });
    const ambiguous = await w.adapter.validate([item(shirt.productId, 10000)], "USD", TENANT);
    expect(ambiguous.valid).toBe(false);
    // The named variant of the same product is fine, each at its own price.
    expect(
      (
        await w.adapter.validate(
          [item(shirt.productId, 12000, "USD", variantOf(shirt, "SHIRT-L"))],
          "USD",
          TENANT,
        )
      ).valid,
    ).toBe(true);
  });

  it("a draft or archived product is invalid; an unlisted one is valid", async () => {
    const w = world();
    const draft = await seedCatalogProduct(w.driver, {
      sku: "DRAFT",
      variants: [{ sku: "DRAFT-STD", priceAmountMinor: 1000 }],
      publish: false,
    });
    const archived = await seedCatalogProduct(w.driver, {
      sku: "ARCHIVED",
      variants: [{ sku: "ARCHIVED-STD", priceAmountMinor: 1000 }],
    });
    await w.catalog.products.archive({ productId: archived.productId, tenantId: TENANT });
    const unlisted = await seedCatalogProduct(w.driver, {
      sku: "UNLISTED",
      variants: [{ sku: "UNLISTED-STD", priceAmountMinor: 1000 }],
    });
    await w.catalog.products.unlist({ productId: unlisted.productId, tenantId: TENANT });

    const check = (seeded: SeededProduct) =>
      w.adapter.validate([item(seeded.productId, 1000, "USD", seeded.variantId)], "USD", TENANT);
    expect((await check(draft)).valid).toBe(false);
    expect((await check(archived)).valid).toBe(false);
    expect((await check(unlisted)).valid).toBe(true);
  });

  it("a currency different from the variant's is invalid", async () => {
    const w = world();
    const mug = await seedCatalogProduct(w.driver, {
      sku: "MUG",
      variants: [{ sku: "MUG-STD", priceAmountMinor: 1999 }],
    });
    const result = await w.adapter.validate(
      [item(mug.productId, 1999, "EGP", mug.variantId)],
      "EGP",
      TENANT,
    );
    expect(result.valid).toBe(false);
  });

  it("looks the product up by the item's product id and the call's tenant, never another tenant", async () => {
    const w = world();
    const mug = await seedCatalogProduct(w.driver, {
      sku: "MUG",
      variants: [{ sku: "MUG-STD", priceAmountMinor: 1999 }],
    });
    await w.adapter.validate([item(mug.productId, 1999, "USD", mug.variantId)], "USD", TENANT);
    expect(w.lookups).toEqual([{ productId: mug.productId, tenantId: TENANT }]);

    // The same product is invisible to another tenant: not found, hence invalid.
    const other = await w.adapter.validate(
      [item(mug.productId, 1999, "USD", mug.variantId)],
      "USD",
      "tenant-b",
    );
    expect(other.valid).toBe(false);
    expect(w.lookups.at(-1)).toEqual({ productId: mug.productId, tenantId: "tenant-b" });
  });
});
