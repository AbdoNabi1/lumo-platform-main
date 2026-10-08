import { describe, expect, it } from "vitest";
import { wireCatalog, type WiredCatalog } from "@platform/catalog";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { WiredAdmin } from "../composition";
import {
  merchandiseUnresolvedResponse,
  resolveMerchandise,
  variantTitleOf,
} from "./merchandise-resolution";
import { publicCatalogRoutes, type PublicProductDto } from "./public-catalog-routes";
import { controllerDriver, seedCatalogProduct, type SeededProduct } from "./testing/seed-catalog";

/**
 * Plan 2A: the variant is what is sold. These tests drive the REAL `wireCatalog` composition
 * (in-memory branch), the same way `public-catalog-routes.test.ts` does, and pin the one server-side
 * resolver every cart route uses to price and snapshot a line.
 */

const T = "tenant-local";
const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

function catalogFixture(): WiredCatalog {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireCatalog({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

function adminOf(catalog: WiredCatalog): WiredAdmin {
  return { publicReads: { products: catalog.products } } as unknown as WiredAdmin;
}

interface Seeded {
  readonly admin: WiredAdmin;
  readonly a: { readonly id: string; readonly variantId: string };
  readonly b: { readonly id: string; readonly s: string; readonly l: string };
  readonly draft: { readonly id: string };
}

async function seed(): Promise<Seeded> {
  const catalog = catalogFixture();
  const driver = controllerDriver(catalog.products, T);

  // Product A: one variant, 10000 EGP.
  const a = await seedCatalogProduct(driver, {
    sku: "MUG",
    name: "Mug",
    currency: "EGP",
    variants: [{ sku: "MUG-STD", priceAmountMinor: 10000 }],
  });
  // Product B: Size [S, L]; S = 10000, L = 12000.
  const b = await seedCatalogProduct(driver, {
    sku: "SHIRT",
    name: "Shirt",
    currency: "EGP",
    options: [{ name: "Size", values: ["S", "L"] }],
    variants: [
      { sku: "SHIRT-S", priceAmountMinor: 10000, selection: { Size: "S" } },
      { sku: "SHIRT-L", priceAmountMinor: 12000, selection: { Size: "L" } },
    ],
  });
  // A draft product (never published).
  const draft = await seedCatalogProduct(driver, {
    sku: "DRAFT",
    name: "Draft",
    currency: "EGP",
    variants: [{ sku: "DRAFT-STD", priceAmountMinor: 500 }],
    publish: false,
  });

  const idOf = (product: SeededProduct, sku: string): string => {
    const variant = product.variants.find((v) => v.sku === sku);
    if (variant === undefined) throw new Error(`seeded variant ${sku} missing`);
    return variant.id;
  };
  return {
    admin: adminOf(catalog),
    a: { id: a.productId, variantId: a.variantId },
    b: { id: b.productId, s: idOf(b, "SHIRT-S"), l: idOf(b, "SHIRT-L") },
    draft: { id: draft.productId },
  };
}

describe("resolveMerchandise", () => {
  it("a single-variant product resolves without a variantId", async () => {
    const { admin, a } = await seed();
    expect(await resolveMerchandise(admin, { productId: a.id }, T)).toEqual({
      status: "ok",
      productId: a.id,
      variantId: a.variantId,
      sku: "MUG-STD",
      title: "Mug",
      variantTitle: null,
      amountMinor: 10000,
      currency: "EGP",
    });
  });

  it("a multi-variant product without a variantId says choose_variant", async () => {
    const { admin, b } = await seed();
    expect(await resolveMerchandise(admin, { productId: b.id }, T)).toEqual({
      status: "choose_variant",
    });
  });

  it("a named variant resolves to ITS price and title", async () => {
    const { admin, b } = await seed();
    expect(await resolveMerchandise(admin, { productId: b.id, variantId: b.l }, T)).toEqual({
      status: "ok",
      productId: b.id,
      variantId: b.l,
      sku: "SHIRT-L",
      title: "Shirt",
      variantTitle: "L",
      amountMinor: 12000,
      currency: "EGP",
    });
  });

  it("a variantId that belongs to another product is unavailable", async () => {
    const { admin, a, b } = await seed();
    expect(await resolveMerchandise(admin, { productId: a.id, variantId: b.l }, T)).toEqual({
      status: "unavailable",
    });
  });

  it("a draft product is unavailable", async () => {
    const { admin, draft } = await seed();
    expect(await resolveMerchandise(admin, { productId: draft.id }, T)).toEqual({
      status: "unavailable",
    });
  });

  it("an unknown product is unavailable", async () => {
    const { admin } = await seed();
    expect(await resolveMerchandise(admin, { productId: "nope" }, T)).toEqual({
      status: "unavailable",
    });
  });
});

describe("variantTitleOf", () => {
  it("joins values in the product's option order, not the selection's key order", () => {
    const options = [
      { name: "Color", values: ["Red", "Blue"] },
      { name: "Size", values: ["S", "L"] },
    ];
    expect(variantTitleOf(options, { Size: "L", Color: "Red" })).toBe("Red / L");
  });

  it("is null when there is no selection", () => {
    expect(variantTitleOf([{ name: "Size", values: ["S"] }], null)).toBeNull();
  });
});

describe("merchandiseUnresolvedResponse", () => {
  it("answers VARIANT_REQUIRED (422) when a variant must be chosen", () => {
    const response = merchandiseUnresolvedResponse({ status: "choose_variant" });
    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe("VARIANT_REQUIRED");
  });

  it("answers a generic 422 when nothing can be resolved", () => {
    const response = merchandiseUnresolvedResponse({ status: "unavailable" });
    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).not.toBe("VARIANT_REQUIRED");
  });
});

describe("public product DTO", () => {
  it("exposes options and each variant's selection and title", async () => {
    const { admin, b } = await seed();
    const route = publicCatalogRoutes(admin).find((r) => r.path === "/public/products/:slug");
    if (route === undefined) throw new Error("no slug route");
    const response = (await route.handle({
      body: undefined,
      params: { slug: "shirt" },
      query: {},
      context: {
        tenantId: T,
        principal: { id: "anon", kind: "staff", roles: [] },
        requestId: "req-1",
      },
    } as never)) as { status: number; body: PublicProductDto };
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(b.id);
    expect(response.body.options).toEqual([{ name: "Size", values: ["S", "L"] }]);
    expect(response.body.variants.map((v) => [v.sku, v.selection, v.title])).toEqual([
      ["SHIRT-S", { Size: "S" }, "S"],
      ["SHIRT-L", { Size: "L" }, "L"],
    ]);
  });
});
