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

function unwrap<T>(response: { status: number; body: unknown }, action: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
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

  // Product A: one variant, 10000 EGP.
  const a = unwrap<{ id: string }>(
    await catalog.products.create({
      sku: "MUG",
      name: "Mug",
      slug: "mug",
      variants: [{ sku: "MUG-STD", priceAmountMinor: 10000, currency: "EGP" }],
      tenantId: T,
    }),
    "create A",
  );
  unwrap(await catalog.products.publish({ productId: a.id, tenantId: T }), "publish A");
  const aProduct = unwrap<{ variants: readonly { id: { value: string } }[] }>(
    await catalog.products.get({ productId: a.id, tenantId: T }),
    "get A",
  );

  // Product B: Size [S, L]; S = 10000, L = 12000. `create` cannot carry a selection, so it is born
  // with a placeholder variant that is removed once the two real ones exist.
  const b = unwrap<{ id: string }>(
    await catalog.products.create({
      sku: "SHIRT",
      name: "Shirt",
      slug: "shirt",
      variants: [{ sku: "SHIRT-BASE", priceAmountMinor: 1, currency: "EGP" }],
      tenantId: T,
    }),
    "create B",
  );
  unwrap(
    await catalog.products.setOptions({
      productId: b.id,
      options: [{ name: "Size", values: ["S", "L"] }],
      tenantId: T,
    }),
    "options B",
  );
  const s = unwrap<{ variantId: string }>(
    await catalog.products.addVariant({
      productId: b.id,
      sku: "SHIRT-S",
      priceAmountMinor: 10000,
      currency: "EGP",
      selection: { Size: "S" },
      tenantId: T,
    }),
    "variant S",
  );
  const l = unwrap<{ variantId: string }>(
    await catalog.products.addVariant({
      productId: b.id,
      sku: "SHIRT-L",
      priceAmountMinor: 12000,
      currency: "EGP",
      selection: { Size: "L" },
      tenantId: T,
    }),
    "variant L",
  );
  const bBefore = unwrap<{
    variants: readonly { id: { value: string }; sku: { value: string } }[];
  }>(await catalog.products.get({ productId: b.id, tenantId: T }), "get B");
  const base = bBefore.variants.find((v) => v.sku.value === "SHIRT-BASE");
  if (base === undefined) throw new Error("placeholder variant missing");
  unwrap(
    await catalog.products.removeVariant({
      productId: b.id,
      variantId: base.id.value,
      tenantId: T,
    }),
    "remove placeholder",
  );
  unwrap(await catalog.products.publish({ productId: b.id, tenantId: T }), "publish B");

  // A draft product (never published).
  const draft = unwrap<{ id: string }>(
    await catalog.products.create({
      sku: "DRAFT",
      name: "Draft",
      slug: "draft",
      variants: [{ sku: "DRAFT-STD", priceAmountMinor: 500, currency: "EGP" }],
      tenantId: T,
    }),
    "create draft",
  );

  const aVariant = aProduct.variants[0];
  if (aVariant === undefined) throw new Error("A has no variant");
  return {
    admin: adminOf(catalog),
    a: { id: a.id, variantId: aVariant.id.value },
    b: { id: b.id, s: s.variantId, l: l.variantId },
    draft,
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
