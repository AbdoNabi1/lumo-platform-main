import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { ProductDetailDto, ProductVariantDto } from "@/lib/api/products";

const api = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  updateProductVariant: vi.fn(),
  addProductVariant: vi.fn(),
  removeProductVariant: vi.fn(),
  setProductOptions: vi.fn(),
  setProductSeo: vi.fn(),
  setProductBrand: vi.fn(),
  assignProductCategories: vi.fn(),
  publishProduct: vi.fn(),
  unpublishProduct: vi.fn(),
  unlistProduct: vi.fn(),
  schedulePublishProduct: vi.fn(),
  archiveProduct: vi.fn(),
  deleteProduct: vi.fn(),
  attachProductMedia: vi.fn(),
  detachProductMedia: vi.fn(),
  reorderProductMedia: vi.fn(),
  fetchProductInventory: vi.fn(),
}));

const inventory = vi.hoisted(() => ({
  fetchWarehouses: vi.fn(),
  registerWarehouse: vi.fn(),
  receiveStock: vi.fn(),
  adjustStock: vi.fn(),
}));

const brands = vi.hoisted(() => ({
  fetchBrandsPage: vi.fn(),
  createBrand: vi.fn(),
}));

vi.mock("@/lib/api/products", () => api);
vi.mock("@/lib/api/brands", () => brands);
vi.mock("@/lib/api/inventory", () => inventory);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const {
  createProductAction,
  duplicateProductAction,
  saveProductAction,
  updateVariantDetailsAction,
} = await import("./actions");

const ok = { outcome: "ok", data: {} } as const;
const idle: FormState = { status: "idle" };

const variant = (overrides: Partial<ProductVariantDto> = {}): ProductVariantDto => ({
  id: "v1",
  sku: "SKU-1",
  priceAmountMinor: 15000,
  currency: "EGP",
  selection: null,
  compareAtAmountMinor: null,
  costAmountMinor: null,
  barcode: null,
  weightGrams: null,
  requiresShipping: true,
  taxable: true,
  tracksInventory: true,
  inventoryPolicy: "deny",
  ...overrides,
});

const product = (overrides: Partial<ProductDetailDto> = {}): ProductDetailDto => ({
  id: "p1",
  sku: "P-ABC123",
  name: "Plush Bear",
  slug: "plush-bear",
  status: "published",
  scheduledAt: null,
  brandId: null,
  categoryIds: [],
  options: [],
  seoTitle: null,
  seoDescription: null,
  description: null,
  productType: null,
  tags: [],
  variants: [variant()],
  mediaAssetIds: [],
  ...overrides,
});

/** A form that mirrors `p` exactly, so only the overrides count as changes. */
function formFor(p: ProductDetailDto, overrides: Record<string, string | string[]> = {}): FormData {
  const v = p.variants[0]!;
  const fields: Record<string, string | string[]> = {
    productId: p.id,
    variantId: v.id,
    hasVariantFields: "1",
    title: p.name,
    handle: p.slug,
    description: p.description ?? "",
    price: (v.priceAmountMinor / 100).toFixed(2),
    compareAtPrice: "",
    costPerItem: "",
    currency: v.currency,
    taxable: "on",
    tracksInventory: v.tracksInventory ? "on" : [],
    continueSelling: v.inventoryPolicy === "continue" ? "on" : [],
    sku: v.sku,
    barcode: "",
    requiresShipping: "on",
    weight: "",
    weightUnit: "g",
    seoTitle: "",
    seoDescription: "",
    status: p.status,
    productType: "",
    vendor: "",
    categoryIds: [],
    tags: "",
    ...overrides,
  };
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) formData.append(key, item);
  }
  return formData;
}

const acme = { id: "b1", name: "Acme Toys", slug: "acme-toys" };
const onePage = { hasNextPage: false, endCursor: null };

const shop = { id: "w1", code: "SHOP", name: "Shop", status: "active" };

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(inventory), ...Object.values(brands)]) {
    fn.mockReset();
  }
  brands.fetchBrandsPage.mockResolvedValue({ outcome: "ok", items: [acme], pageInfo: onePage });
  brands.createBrand.mockResolvedValue({ outcome: "ok", data: { id: "nb1" } });
  inventory.fetchWarehouses.mockResolvedValue({ outcome: "ok", items: [shop] });
  api.fetchProductInventory.mockResolvedValue({ outcome: "ok", rows: [] });
  for (const name of ["registerWarehouse", "receiveStock", "adjustStock"] as const) {
    inventory[name].mockResolvedValue(ok);
  }
  for (const name of [
    "updateProduct",
    "updateProductVariant",
    "addProductVariant",
    "removeProductVariant",
    "setProductOptions",
    "setProductSeo",
    "setProductBrand",
    "assignProductCategories",
    "publishProduct",
    "unpublishProduct",
    "unlistProduct",
  ] as const) {
    api[name].mockResolvedValue(ok);
  }
});

function use(p: ProductDetailDto): void {
  api.fetchProduct.mockResolvedValue({ outcome: "ok", product: p });
}

describe("saveProductAction", () => {
  it("calls only what changed", async () => {
    use(product());
    const state = await saveProductAction(
      idle,
      formFor(product(), { title: "Plush Bear XL", price: "199.50" }),
    );

    expect(state).toEqual({ status: "success" });
    expect(api.updateProduct).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ name: "Plush Bear XL", slug: "plush-bear" }),
      expect.any(String),
    );
    expect(api.updateProductVariant).toHaveBeenCalledWith(
      "p1",
      "v1",
      expect.objectContaining({
        priceAmountMinor: 19950,
        compareAtAmountMinor: null,
        costAmountMinor: null,
      }),
      expect.any(String),
    );
    for (const untouched of [
      "setProductSeo",
      "setProductBrand",
      "assignProductCategories",
      "publishProduct",
      "unpublishProduct",
      "unlistProduct",
    ] as const) {
      expect(api[untouched]).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["published", "draft", "unpublishProduct"],
    ["draft", "published", "publishProduct"],
    ["draft", "unlisted", "unlistProduct"],
    ["published", "unlisted", "unlistProduct"],
    ["unlisted", "published", "publishProduct"],
    ["unlisted", "draft", "unpublishProduct"],
  ] as const)("maps status %s → %s to %s, called last", async (from, to, call) => {
    use(product({ status: from }));
    await saveProductAction(
      idle,
      formFor(product({ status: from }), { status: to, title: "Renamed" }),
    );

    expect(api[call]).toHaveBeenCalledTimes(1);
    expect(api.updateProduct.mock.invocationCallOrder[0]).toBeLessThan(
      api[call].mock.invocationCallOrder[0]!,
    );
  });

  it("stops at the first failure and renames the field error", async () => {
    use(product());
    api.updateProduct.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "slug", message: "taken" }],
    });

    const state = await saveProductAction(
      idle,
      formFor(product(), { handle: "taken", price: "200", status: "draft" }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.fieldErrors["handle"]).toBe("taken");
    expect(api.updateProductVariant).not.toHaveBeenCalled();
    expect(api.unpublishProduct).not.toHaveBeenCalled();
  });

  it("reports a bad price without calling the API", async () => {
    use(product());
    const state = await saveProductAction(idle, formFor(product(), { price: "12.345" }));

    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.fieldErrors["price"]).toBeDefined();
    expect(api.updateProduct).not.toHaveBeenCalled();
    expect(api.updateProductVariant).not.toHaveBeenCalled();
  });

  it.each([
    ["1.5", "kg", 1500],
    ["250", "g", 250],
    ["", "g", null],
  ] as const)("reads weight %s %s as %s grams", async (weight, weightUnit, grams) => {
    use(product());
    await saveProductAction(idle, formFor(product(), { weight, weightUnit, sku: "SKU-1" }));
    if (grams === null) {
      expect(api.updateProductVariant).not.toHaveBeenCalled();
    } else {
      expect(api.updateProductVariant).toHaveBeenCalledWith(
        "p1",
        "v1",
        expect.objectContaining({ weightGrams: grams }),
        expect.any(String),
      );
    }
  });

  it("splits tags on commas, trimming and dropping blanks", async () => {
    use(product());
    await saveProductAction(idle, formFor(product(), { tags: "summer, Sale , ,summer" }));
    expect(api.updateProduct).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ tags: ["summer", "Sale", "summer"] }),
      expect.any(String),
    );
  });

  it("never touches the variant of a multi-variant product", async () => {
    const multi = product({
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        variant({ selection: { Size: "S" } }),
        variant({ id: "v2", selection: { Size: "M" } }),
      ],
    });
    use(multi);
    const form = formFor(multi, { title: "Renamed" });
    form.delete("hasVariantFields");
    await saveProductAction(idle, form);

    expect(api.updateProduct).toHaveBeenCalled();
    expect(api.updateProductVariant).not.toHaveBeenCalled();
  });

  it("prefixes the message when an earlier call already saved", async () => {
    use(product());
    api.setProductBrand.mockResolvedValue({ outcome: "error", message: "boom" });

    const state = await saveProductAction(
      idle,
      formFor(product(), { title: "Renamed", vendor: "Acme Toys" }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message.startsWith(en.productEditor.partiallySaved)).toBe(true);
    }
  });
});

describe("createProductAction", () => {
  beforeEach(() => {
    api.createProduct.mockResolvedValue({ outcome: "ok", data: { id: "new-1" } });
  });

  function createForm(overrides: Record<string, string | string[]> = {}): FormData {
    const base = formFor(product(), {
      title: "Plush Bear",
      handle: "",
      sku: "",
      price: "150.50",
      status: "draft",
      ...overrides,
    });
    base.delete("productId");
    base.delete("variantId");
    return base;
  }

  async function redirectOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      return (error as Error).message;
    }
    return "";
  }

  it("generates the handle and SKUs, then redirects to the new product", async () => {
    const target = await redirectOf(createProductAction(idle, createForm()));

    expect(target).toBe("NEXT_REDIRECT:/products/new-1");
    const input = api.createProduct.mock.calls[0]![0] as {
      sku: string;
      slug: string;
      variants: { sku: string; priceAmountMinor: number }[];
    };
    expect(input.slug).toBe("plush-bear");
    expect(input.sku).toMatch(/^P-[A-Z0-9]{6}$/);
    expect(input.variants).toHaveLength(1);
    expect(input.variants[0]!.sku).toBe(`${input.sku}-1`);
    expect(input.variants[0]!.priceAmountMinor).toBe(15050);
  });

  it("falls back to product-<token> for an Arabic title", async () => {
    await redirectOf(createProductAction(idle, createForm({ title: "قميص قطن" })));
    const input = api.createProduct.mock.calls[0]![0] as { slug: string };
    expect(input.slug).toMatch(/^product-[a-z0-9]{6}$/);
  });

  it("retries once with a suffix when a generated handle conflicts, but never a typed one", async () => {
    api.createProduct
      .mockResolvedValueOnce({ outcome: "conflict", message: "slug taken" })
      .mockResolvedValueOnce({ outcome: "ok", data: { id: "new-2" } });
    const target = await redirectOf(createProductAction(idle, createForm()));
    expect(target).toBe("NEXT_REDIRECT:/products/new-2");
    expect(api.createProduct).toHaveBeenCalledTimes(2);
    const retried = api.createProduct.mock.calls[1]![0] as { slug: string };
    expect(retried.slug).toMatch(/^plush-bear-[a-z0-9]{4}$/);

    api.createProduct.mockReset();
    api.createProduct.mockResolvedValue({ outcome: "conflict", message: "slug taken" });
    const state = await createProductAction(idle, createForm({ handle: "mine" }));
    expect(api.createProduct).toHaveBeenCalledTimes(1);
    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.fieldErrors["handle"]).toBeDefined();
  });

  it("publishes, assigns the brand and categories after creating", async () => {
    await redirectOf(
      createProductAction(
        idle,
        createForm({ status: "published", vendor: "Acme Toys", categoryIds: ["c1", "c2"] }),
      ),
    );
    expect(api.publishProduct).toHaveBeenCalledWith("new-1", expect.any(String));
    expect(api.setProductBrand).toHaveBeenCalledWith("new-1", "b1", expect.any(String));
    expect(api.assignProductCategories).toHaveBeenCalledWith(
      "new-1",
      ["c1", "c2"],
      expect.any(String),
    );
  });

  it("redirects to the new product with ?saved=partial when a later step fails", async () => {
    api.publishProduct.mockResolvedValue({ outcome: "error", message: "boom" });
    const target = await redirectOf(createProductAction(idle, createForm({ status: "published" })));
    expect(target).toBe("NEXT_REDIRECT:/products/new-1?saved=partial");
  });

  it("creates the variant with the tracking switches from the inventory card", async () => {
    await redirectOf(createProductAction(idle, createForm({ continueSelling: "on" })));
    let input = api.createProduct.mock.calls[0]![0] as { variants: Record<string, unknown>[] };
    expect(input.variants[0]).toMatchObject({ tracksInventory: true, inventoryPolicy: "continue" });

    api.createProduct.mockClear();
    await redirectOf(createProductAction(idle, createForm({ tracksInventory: [] })));
    input = api.createProduct.mock.calls[0]![0] as { variants: Record<string, unknown>[] };
    expect(input.variants[0]).toMatchObject({ tracksInventory: false, inventoryPolicy: "deny" });
  });

  describe("an opening quantity", () => {
    beforeEach(() => {
      api.fetchProduct.mockResolvedValue({
        outcome: "ok",
        product: product({ id: "new-1", variants: [variant({ id: "v-first" })] }),
      });
    });

    it("is received on the shop location against the variant the create made", async () => {
      const target = await redirectOf(createProductAction(idle, createForm({ available: "6" })));

      expect(target).toBe("NEXT_REDIRECT:/products/new-1");
      expect(api.fetchProduct).toHaveBeenCalledWith("new-1");
      expect(inventory.receiveStock).toHaveBeenCalledWith(
        { productId: "new-1", variantId: "v-first", warehouseId: "w1", quantity: 6 },
        expect.any(String),
      );
    });

    describe("with several locations (Plan 2B-3)", () => {
      beforeEach(() => {
        inventory.fetchWarehouses.mockResolvedValue({
          outcome: "ok",
          items: [shop, { ...shop, id: "w2", code: "B", name: "Warehouse" }],
        });
      });

      it("sets opening quantities per location when creating a product", async () => {
        api.fetchProduct.mockResolvedValue({
          outcome: "ok",
          product: product({ id: "new-1", variants: [variant({ id: "v-first" })] }),
        });
        await redirectOf(
          createProductAction(idle, createForm({ "available-w1": "3", "available-w2": "7" })),
        );

        expect(inventory.receiveStock).toHaveBeenCalledWith(
          { productId: "new-1", variantId: "v-first", warehouseId: "w1", quantity: 3 },
          expect.any(String),
        );
        expect(inventory.receiveStock).toHaveBeenCalledWith(
          { productId: "new-1", variantId: "v-first", warehouseId: "w2", quantity: 7 },
          expect.any(String),
        );
      });

      it("creates nothing when an opening quantity names an unknown location", async () => {
        const state = await createProductAction(idle, createForm({ "available-w9": "3" }));

        expect(state.status).toBe("error");
        if (state.status === "error") {
          expect(state.fieldErrors["available-w9"]).toBeDefined();
        }
        expect(api.createProduct).not.toHaveBeenCalled();
      });
    });

    it("registers the shop location first when there is none", async () => {
      inventory.fetchWarehouses.mockResolvedValue({ outcome: "ok", items: [] });
      inventory.registerWarehouse.mockResolvedValue({
        outcome: "ok",
        data: { warehouseId: "w-new" },
      });
      await redirectOf(createProductAction(idle, createForm({ available: "6" })));

      expect(inventory.registerWarehouse).toHaveBeenCalledWith(
        { code: "SHOP", name: en.productEditor.shopLocation },
        expect.any(String),
      );
      expect(inventory.receiveStock).toHaveBeenCalledWith(
        expect.objectContaining({ warehouseId: "w-new", quantity: 6 }),
        expect.any(String),
      );
    });

    it("is skipped when blank, zero, or when the product is not tracked", async () => {
      await redirectOf(createProductAction(idle, createForm({ available: "" })));
      await redirectOf(createProductAction(idle, createForm({ available: "0" })));
      await redirectOf(
        createProductAction(idle, createForm({ available: "6", tracksInventory: [] })),
      );

      expect(inventory.receiveStock).not.toHaveBeenCalled();
      expect(inventory.registerWarehouse).not.toHaveBeenCalled();
    });

    it("rejects a bad quantity before creating anything", async () => {
      const state = await createProductAction(idle, createForm({ available: "-3" }));
      expect(state.status).toBe("error");
      if (state.status === "error") expect(state.fieldErrors["available"]).toBeDefined();
      expect(api.createProduct).not.toHaveBeenCalled();
    });

    it("flags the redirect as partial when the quantity could not be saved", async () => {
      inventory.receiveStock.mockResolvedValue({ outcome: "error", message: "boom" });
      const target = await redirectOf(createProductAction(idle, createForm({ available: "6" })));
      expect(target).toBe("NEXT_REDIRECT:/products/new-1?saved=partial");
    });
  });

  it("rejects a blank title without calling the API", async () => {
    const state = await createProductAction(idle, createForm({ title: " " }));
    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.fieldErrors["title"]).toBeDefined();
    expect(api.createProduct).not.toHaveBeenCalled();
  });
});

describe("saveProductAction — options, variant prices and stock (Plan 2B-2)", () => {
  /** The page form for `p` plus an options section and one row per resulting variant. */
  function optionsForm(
    p: ProductDetailDto,
    options: { name: string; values: string[] }[],
    rows: { key: string; price: string; available?: string }[],
    overrides: Record<string, string | string[]> = {},
  ): FormData {
    const fields: Record<string, string | string[]> = { optionsPresent: "1", ...overrides };
    options.forEach((option, index) => {
      fields[`optionName-${index}`] = option.name;
      fields[`optionValue-${index}`] = option.values;
    });
    rows.forEach((row, index) => {
      fields[`row-${index}-key`] = row.key;
      fields[`row-${index}-price`] = row.price;
      if (row.available !== undefined) fields[`row-${index}-available`] = row.available;
    });
    return formFor(p, fields);
  }

  const sizeRows = [
    { key: "Size=S", price: "150" },
    { key: "Size=M", price: "175" },
  ];
  const sizeOption = [{ name: "Size", values: ["S", "M"] }];
  const added = { outcome: "ok", data: { productId: "p1", variantId: "v-new" } } as const;

  const multi = () =>
    product({
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        variant({ selection: { Size: "S" } }),
        variant({ id: "v2", sku: "SKU-2", selection: { Size: "M" }, priceAmountMinor: 17500 }),
      ],
    });

  /** The calls that only set a price (the planner's own calls carry a `selection`). */
  function priceWrites(variantId: string) {
    return api.updateProductVariant.mock.calls.filter(
      (call) => call[1] === variantId && !("selection" in (call[2] as object)),
    );
  }

  it("runs the planner's operations in order and prices the new row", async () => {
    use(product());
    api.addProductVariant.mockResolvedValue(added);
    const state = await saveProductAction(
      idle,
      optionsForm(product(), [{ name: "Size", values: ["S", "M", ""] }], sizeRows),
    );

    expect(state).toEqual({ status: "success" });
    // The planner declares the options first, then assigns, then adds — every step legal.
    const order = [
      api.setProductOptions.mock.invocationCallOrder[0]!,
      api.updateProductVariant.mock.invocationCallOrder[0]!,
      api.addProductVariant.mock.invocationCallOrder[0]!,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(api.setProductOptions).toHaveBeenCalledWith("p1", sizeOption, expect.any(String));
    expect(api.updateProductVariant).toHaveBeenCalledWith(
      "p1",
      "v1",
      { sku: "SKU-1", priceAmountMinor: 15000, currency: "EGP", selection: { Size: "S" } },
      expect.any(String),
    );
    expect(api.addProductVariant).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ selection: { Size: "M" }, priceAmountMinor: 15000 }),
      expect.any(String),
    );
    // 175 differs from the copied first price → one price write for the new variant.
    expect(priceWrites("v-new")).toHaveLength(1);
    expect(priceWrites("v-new")[0]![2]).toMatchObject({ priceAmountMinor: 17500, currency: "EGP" });
    // 150 equals S's current price → no price write for S.
    expect(priceWrites("v1")).toHaveLength(0);
  });

  it("writes the price of an existing row only when it changed", async () => {
    use(product());
    api.addProductVariant.mockResolvedValue(added);
    await saveProductAction(
      idle,
      optionsForm(product(), sizeOption, [
        { key: "Size=S", price: "160" },
        { key: "Size=M", price: "150" },
      ]),
    );

    expect(priceWrites("v1")).toHaveLength(1);
    expect(priceWrites("v1")[0]![2]).toMatchObject({ priceAmountMinor: 16000 });
    expect(priceWrites("v-new")).toHaveLength(0);
  });

  it("refuses a stale page before writing anything", async () => {
    use(product());
    const state = await saveProductAction(
      idle,
      optionsForm(
        product(),
        sizeOption,
        [
          { key: "Size=S", price: "150" },
          { key: "Size=L", price: "175" },
        ],
        { title: "Renamed" },
      ),
    );

    expect(state).toEqual({
      status: "error",
      message: en.productEditor.pageOutOfDate,
      fieldErrors: {},
    });
    for (const write of [
      api.updateProduct,
      api.updateProductVariant,
      api.addProductVariant,
      api.setProductOptions,
      api.removeProductVariant,
      inventory.receiveStock,
      inventory.adjustStock,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it("refuses a page whose row count no longer matches", async () => {
    use(product());
    const state = await saveProductAction(idle, optionsForm(product(), sizeOption, [sizeRows[0]!]));
    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.message).toBe(en.productEditor.pageOutOfDate);
    expect(api.setProductOptions).not.toHaveBeenCalled();
  });

  it("sets stock per row from the available quantity", async () => {
    use(product());
    api.addProductVariant.mockResolvedValue(added);
    api.fetchProductInventory.mockResolvedValue({
      outcome: "ok",
      rows: [{ warehouseId: "w1", variantId: "v1", onHand: 2, reserved: 0, available: 2 }],
    });
    const state = await saveProductAction(
      idle,
      optionsForm(product(), sizeOption, [
        { key: "Size=S", price: "150", available: "5" },
        { key: "Size=M", price: "150", available: "3" },
      ]),
    );

    expect(state).toEqual({ status: "success" });
    expect(inventory.adjustStock).toHaveBeenCalledWith(
      { productId: "p1", variantId: "v1", warehouseId: "w1", onHand: 5 },
      expect.any(String),
    );
    expect(inventory.receiveStock).toHaveBeenCalledWith(
      { productId: "p1", variantId: "v-new", warehouseId: "w1", quantity: 3 },
      expect.any(String),
    );
  });

  it("keeps reserved units on top of the typed available quantity", async () => {
    use(multi());
    api.fetchProductInventory.mockResolvedValue({
      outcome: "ok",
      rows: [{ warehouseId: "w1", variantId: "v2", onHand: 10, reserved: 2, available: 8 }],
    });
    await saveProductAction(
      idle,
      optionsForm(multi(), sizeOption, [
        { key: "Size=S", price: "150" },
        { key: "Size=M", price: "175", available: "7" },
      ]),
    );
    expect(inventory.adjustStock).toHaveBeenCalledWith(
      { productId: "p1", variantId: "v2", warehouseId: "w1", onHand: 9 },
      expect.any(String),
    );
  });

  it("changes nothing for a blank available quantity or an untracked variant", async () => {
    const untracked = product({
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        variant({ selection: { Size: "S" }, tracksInventory: false }),
        variant({ id: "v2", sku: "SKU-2", selection: { Size: "M" } }),
      ],
    });
    use(untracked);
    await saveProductAction(
      idle,
      optionsForm(untracked, sizeOption, [
        { key: "Size=S", price: "150", available: "9" },
        { key: "Size=M", price: "150", available: "" },
      ]),
    );
    expect(inventory.receiveStock).not.toHaveBeenCalled();
    expect(inventory.adjustStock).not.toHaveBeenCalled();
  });

  it("registers the shop location before the first stock write when there is none", async () => {
    use(multi());
    inventory.fetchWarehouses.mockResolvedValue({ outcome: "ok", items: [] });
    inventory.registerWarehouse.mockResolvedValue({
      outcome: "ok",
      data: { warehouseId: "w-new" },
    });
    await saveProductAction(
      idle,
      optionsForm(multi(), sizeOption, [
        { key: "Size=S", price: "150", available: "4" },
        { key: "Size=M", price: "175" },
      ]),
    );

    expect(inventory.registerWarehouse).toHaveBeenCalledWith(
      { code: "SHOP", name: en.productEditor.shopLocation },
      expect.any(String),
    );
    expect(inventory.receiveStock).toHaveBeenCalledWith(
      { productId: "p1", variantId: "v1", warehouseId: "w-new", quantity: 4 },
      expect.any(String),
    );
    expect(inventory.registerWarehouse.mock.invocationCallOrder[0]).toBeLessThan(
      inventory.receiveStock.mock.invocationCallOrder[0]!,
    );
  });

  it("registers no location when no stock write is needed", async () => {
    use(multi());
    inventory.fetchWarehouses.mockResolvedValue({ outcome: "ok", items: [] });
    await saveProductAction(
      idle,
      optionsForm(multi(), sizeOption, [
        { key: "Size=S", price: "150", available: "0" },
        { key: "Size=M", price: "175" },
      ]),
    );
    expect(inventory.registerWarehouse).not.toHaveBeenCalled();
  });

  describe("several locations (Plan 2B-3)", () => {
    const w2 = { ...shop, id: "w2", code: "B", name: "Warehouse" };
    const writes = () => [
      inventory.receiveStock,
      inventory.adjustStock,
      inventory.registerWarehouse,
    ];
    beforeEach(() => {
      inventory.fetchWarehouses.mockResolvedValue({ outcome: "ok", items: [shop, w2] });
    });

    it("writes the table's quantities at the location named in stockLocationId", async () => {
      use(multi());
      api.fetchProductInventory.mockResolvedValue({
        outcome: "ok",
        rows: [
          { warehouseId: "w1", variantId: "v1", onHand: 9, reserved: 0, available: 9 },
          { warehouseId: "w2", variantId: "v1", onHand: 2, reserved: 0, available: 2 },
        ],
      });
      const state = await saveProductAction(
        idle,
        optionsForm(
          multi(),
          sizeOption,
          [
            { key: "Size=S", price: "150", available: "4" },
            { key: "Size=M", price: "175", available: "6" },
          ],
          { stockLocationId: "w2" },
        ),
      );

      expect(state).toEqual({ status: "success" });
      expect(inventory.adjustStock).toHaveBeenCalledWith(
        { productId: "p1", variantId: "v1", warehouseId: "w2", onHand: 4 },
        expect.any(String),
      );
      expect(inventory.receiveStock).toHaveBeenCalledWith(
        { productId: "p1", variantId: "v2", warehouseId: "w2", quantity: 6 },
        expect.any(String),
      );
      expect(inventory.registerWarehouse).not.toHaveBeenCalled();
    });

    it("refuses an unknown stockLocationId before any write", async () => {
      use(multi());
      const state = await saveProductAction(
        idle,
        optionsForm(
          multi(),
          sizeOption,
          [
            { key: "Size=S", price: "999", available: "4" },
            { key: "Size=M", price: "175" },
          ],
          { stockLocationId: "w-other-tenant", title: "Renamed" },
        ),
      );

      expect(state.status).toBe("error");
      if (state.status === "error") {
        expect(state.fieldErrors["stockLocationId"]).toBeDefined();
      }
      for (const write of writes()) expect(write).not.toHaveBeenCalled();
      expect(api.updateProduct).not.toHaveBeenCalled();
      expect(api.updateProductVariant).not.toHaveBeenCalled();
    });

    it("refuses a deactivated stockLocationId before any write", async () => {
      use(multi());
      inventory.fetchWarehouses.mockResolvedValue({
        outcome: "ok",
        items: [shop, { ...w2, status: "inactive" }],
      });
      const state = await saveProductAction(
        idle,
        optionsForm(
          multi(),
          sizeOption,
          [
            { key: "Size=S", price: "150", available: "4" },
            { key: "Size=M", price: "175" },
          ],
          { stockLocationId: "w2" },
        ),
      );

      expect(state.status).toBe("error");
      if (state.status === "error") {
        expect(state.fieldErrors["stockLocationId"]).toBeDefined();
      }
      for (const write of writes()) expect(write).not.toHaveBeenCalled();
    });

    it("refuses a quantity that names no location when there are several, instead of guessing", async () => {
      use(multi());
      const state = await saveProductAction(
        idle,
        optionsForm(multi(), sizeOption, [
          { key: "Size=S", price: "150", available: "4" },
          { key: "Size=M", price: "175" },
        ]),
      );

      expect(state.status).toBe("error");
      if (state.status === "error") {
        expect(state.fieldErrors["stockLocationId"]).toBeDefined();
      }
      for (const write of writes()) expect(write).not.toHaveBeenCalled();
    });

    it("writes a single variant's quantity at each location it names, one change per location", async () => {
      use(product());
      api.fetchProductInventory.mockResolvedValue({
        outcome: "ok",
        rows: [{ warehouseId: "w2", variantId: "v1", onHand: 1, reserved: 0, available: 1 }],
      });
      const state = await saveProductAction(
        idle,
        formFor(product(), { "available-w1": "2", "available-w2": "5" }),
      );

      expect(state).toEqual({ status: "success" });
      expect(inventory.receiveStock).toHaveBeenCalledWith(
        { productId: "p1", variantId: "v1", warehouseId: "w1", quantity: 2 },
        expect.any(String),
      );
      expect(inventory.adjustStock).toHaveBeenCalledWith(
        { productId: "p1", variantId: "v1", warehouseId: "w2", onHand: 5 },
        expect.any(String),
      );
    });

    it("refuses a single-variant quantity for a location that is not this shop's, before any write", async () => {
      use(product());
      const state = await saveProductAction(
        idle,
        formFor(product(), { "available-w1": "2", "available-w9": "5", title: "Renamed" }),
      );

      expect(state.status).toBe("error");
      if (state.status === "error") {
        expect(state.fieldErrors["available-w9"]).toBeDefined();
        expect(state.fieldErrors["available-w1"]).toBeUndefined();
      }
      for (const write of writes()) expect(write).not.toHaveBeenCalled();
      expect(api.updateProduct).not.toHaveBeenCalled();
    });

    it("reports a malformed per-location quantity on that field, before any call", async () => {
      use(product());
      const state = await saveProductAction(
        idle,
        formFor(product(), { "available-w1": "2", "available-w2": "-4" }),
      );

      expect(state.status).toBe("error");
      if (state.status === "error") {
        expect(state.fieldErrors["available-w2"]).toBeDefined();
      }
      expect(inventory.fetchWarehouses).not.toHaveBeenCalled();
    });

    it("leaves a blank or unchanged location alone", async () => {
      use(product());
      api.fetchProductInventory.mockResolvedValue({
        outcome: "ok",
        rows: [{ warehouseId: "w2", variantId: "v1", onHand: 5, reserved: 0, available: 5 }],
      });
      await saveProductAction(
        idle,
        formFor(product(), { "available-w1": "", "available-w2": "5" }),
      );

      for (const write of writes()) expect(write).not.toHaveBeenCalled();
    });
  });

  it("does not count a deactivated warehouse as a location", async () => {
    use(multi());
    inventory.fetchWarehouses.mockResolvedValue({
      outcome: "ok",
      items: [shop, { ...shop, id: "w2", code: "B", status: "inactive" }],
    });
    await saveProductAction(
      idle,
      optionsForm(multi(), sizeOption, [
        { key: "Size=S", price: "150", available: "5" },
        { key: "Size=M", price: "175" },
      ]),
    );
    expect(inventory.receiveStock).toHaveBeenCalledWith(
      expect.objectContaining({ warehouseId: "w1", quantity: 5 }),
      expect.any(String),
    );
  });

  it("saves the single variant's tracking switches", async () => {
    use(product());
    await saveProductAction(
      idle,
      formFor(product(), { tracksInventory: [], continueSelling: "on" }),
    );

    expect(api.updateProductVariant).toHaveBeenCalledWith(
      "p1",
      "v1",
      expect.objectContaining({ tracksInventory: false, inventoryPolicy: "continue" }),
      expect.any(String),
    );
  });

  it("sets the single variant's stock only while it is tracked", async () => {
    use(product());
    await saveProductAction(idle, formFor(product(), { available: "12" }));
    expect(inventory.receiveStock).toHaveBeenCalledWith(
      { productId: "p1", variantId: "v1", warehouseId: "w1", quantity: 12 },
      expect.any(String),
    );

    inventory.receiveStock.mockClear();
    await saveProductAction(idle, formFor(product(), { available: "12", tracksInventory: [] }));
    expect(inventory.receiveStock).not.toHaveBeenCalled();
    expect(inventory.adjustStock).not.toHaveBeenCalled();
  });

  it("reads a legacy product-level stock row as the only variant's stock", async () => {
    use(product());
    api.fetchProductInventory.mockResolvedValue({
      outcome: "ok",
      rows: [{ warehouseId: "w1", variantId: null, onHand: 3, reserved: 0, available: 3 }],
    });
    await saveProductAction(idle, formFor(product(), { available: "8" }));
    expect(inventory.adjustStock).toHaveBeenCalledWith(
      { productId: "p1", variantId: "v1", warehouseId: "w1", onHand: 8 },
      expect.any(String),
    );
  });

  it("rejects bad row numbers before any call", async () => {
    use(product());
    const state = await saveProductAction(
      idle,
      optionsForm(
        product(),
        sizeOption,
        [
          { key: "Size=S", price: "abc", available: "-1" },
          { key: "Size=M", price: "175", available: "2.5" },
        ],
        { title: "Renamed" },
      ),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.fieldErrors["row-0-price"]).toBeDefined();
      expect(state.fieldErrors["row-0-available"]).toBeDefined();
      expect(state.fieldErrors["row-1-available"]).toBeDefined();
    }
    expect(api.updateProduct).not.toHaveBeenCalled();
    expect(api.setProductOptions).not.toHaveBeenCalled();
    expect(inventory.fetchWarehouses).not.toHaveBeenCalled();
  });

  it("makes no option calls when the options are unchanged, but still applies price edits", async () => {
    use(multi());
    const state = await saveProductAction(
      idle,
      optionsForm(multi(), sizeOption, [
        { key: "Size=S", price: "150" },
        { key: "Size=M", price: "180" },
      ]),
    );

    expect(state).toEqual({ status: "success" });
    expect(api.setProductOptions).not.toHaveBeenCalled();
    expect(api.addProductVariant).not.toHaveBeenCalled();
    expect(api.removeProductVariant).not.toHaveBeenCalled();
    expect(api.updateProductVariant).toHaveBeenCalledTimes(1);
    expect(priceWrites("v2")[0]![2]).toMatchObject({ priceAmountMinor: 18000 });
  });

  it("refuses too many variants without calling the API", async () => {
    use(product());
    const many = Array.from({ length: 11 }, (_, i) => `v${i}`);
    const state = await saveProductAction(
      idle,
      optionsForm(
        product(),
        [
          { name: "A", values: many },
          { name: "B", values: many },
        ],
        [],
        { title: "Renamed" },
      ),
    );
    expect(state).toEqual({
      status: "error",
      message: en.productEditor.tooManyVariants,
      fieldErrors: {},
    });
    expect(api.updateProduct).not.toHaveBeenCalled();
    expect(api.setProductOptions).not.toHaveBeenCalled();
    expect(api.addProductVariant).not.toHaveBeenCalled();
  });

  it("refuses an option with no values", async () => {
    use(product());
    const state = await saveProductAction(
      idle,
      optionsForm(product(), [{ name: "Size", values: ["", ""] }], []),
    );
    expect(state).toEqual({
      status: "error",
      message: en.productEditor.invalidOptions,
      fieldErrors: {},
    });
    expect(api.setProductOptions).not.toHaveBeenCalled();
  });

  it("stops at a failing operation and prefixes the message", async () => {
    use(product());
    api.updateProductVariant.mockResolvedValue({ outcome: "error", message: "boom" });
    const state = await saveProductAction(idle, optionsForm(product(), sizeOption, sizeRows));

    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message.startsWith(en.productEditor.partiallySaved)).toBe(true);
    }
    expect(api.addProductVariant).not.toHaveBeenCalled();
    expect(inventory.receiveStock).not.toHaveBeenCalled();
  });

  it("treats a page with no option rows as removing every option", async () => {
    use(multi());
    const state = await saveProductAction(idle, optionsForm(multi(), [], []));

    expect(state).toEqual({ status: "success" });
    expect(api.removeProductVariant).toHaveBeenCalledWith("p1", "v2", expect.any(String));
    expect(api.setProductOptions).toHaveBeenCalledWith("p1", [], expect.any(String));
  });

  it("writes in a fixed order: details, options, prices, stock, SEO, brand, categories, status", async () => {
    use(product());
    api.addProductVariant.mockResolvedValue(added);
    await saveProductAction(
      idle,
      optionsForm(
        product(),
        sizeOption,
        [
          { key: "Size=S", price: "150", available: "5" },
          { key: "Size=M", price: "175" },
        ],
        {
          title: "Renamed",
          seoTitle: "A title",
          vendor: "Acme Toys",
          categoryIds: ["c1"],
          status: "draft",
        },
      ),
    );

    const at = (fn: { mock: { invocationCallOrder: number[] } }, index = 0) =>
      fn.mock.invocationCallOrder[index]!;
    const sequence = [
      at(api.updateProduct),
      at(api.setProductOptions),
      at(api.addProductVariant),
      at(api.updateProductVariant, api.updateProductVariant.mock.calls.length - 1),
      at(inventory.receiveStock),
      at(api.setProductSeo),
      at(api.setProductBrand),
      at(api.assignProductCategories),
      at(api.unpublishProduct),
    ];
    expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
  });
});

describe("updateVariantDetailsAction", () => {
  it("sends the full attribute set with the variant's own currency", async () => {
    use(product({ variants: [variant({ currency: "USD", selection: { Size: "S" } })] }));
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      productId: "p1",
      variantId: "v1",
      price: "12.50",
      compareAtPrice: "",
      costPerItem: "5",
      sku: "SKU-9",
      barcode: "  ",
      weight: "2",
      weightUnit: "kg",
      currency: "EGP", // must be ignored: the server uses the fetched variant's currency
    })) {
      formData.append(key, value);
    }
    // requiresShipping, taxable and the inventory switches unchecked → absent → false / deny

    const state = await updateVariantDetailsAction(idle, formData);

    expect(state).toEqual({ status: "success" });
    expect(api.updateProductVariant).toHaveBeenCalledWith(
      "p1",
      "v1",
      {
        sku: "SKU-9",
        priceAmountMinor: 1250,
        currency: "USD",
        compareAtAmountMinor: null,
        costAmountMinor: 500,
        barcode: null,
        weightGrams: 2000,
        requiresShipping: false,
        taxable: false,
        tracksInventory: false,
        inventoryPolicy: "deny",
      },
      expect.any(String),
    );
  });

  it("saves the two inventory switches", async () => {
    use(product({ variants: [variant({ tracksInventory: false })] }));
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      productId: "p1",
      variantId: "v1",
      price: "150",
      tracksInventory: "on",
      continueSelling: "on",
    })) {
      formData.append(key, value);
    }

    await updateVariantDetailsAction(idle, formData);

    expect(api.updateProductVariant).toHaveBeenCalledWith(
      "p1",
      "v1",
      expect.objectContaining({ tracksInventory: true, inventoryPolicy: "continue" }),
      expect.any(String),
    );
  });

  it("reports a missing variant as not found", async () => {
    use(product());
    const formData = new FormData();
    formData.append("productId", "p1");
    formData.append("variantId", "nope");
    formData.append("price", "1");
    const state = await updateVariantDetailsAction(idle, formData);
    expect(state.status).toBe("error");
    expect(api.updateProductVariant).not.toHaveBeenCalled();
  });
});

describe("the vendor field (Plan 2C-4)", () => {
  const withBrand = () => product({ brandId: "b1" });

  describe("saveProductAction", () => {
    it("makes no brand call when the typed vendor is the brand the product already has", async () => {
      use(withBrand());

      const state = await saveProductAction(idle, formFor(withBrand(), { vendor: "acme toys" }));

      expect(state).toEqual({ status: "success" });
      expect(brands.createBrand).not.toHaveBeenCalled();
      expect(api.setProductBrand).not.toHaveBeenCalled();
    });

    it("assigns an existing brand by its name, without creating one", async () => {
      use(product());

      await saveProductAction(idle, formFor(product(), { vendor: " ACME TOYS " }));

      expect(brands.createBrand).not.toHaveBeenCalled();
      expect(api.setProductBrand).toHaveBeenCalledWith("p1", "b1", expect.any(String));
    });

    it("creates a brand for a new name, then assigns the id it answers with", async () => {
      use(withBrand());

      await saveProductAction(idle, formFor(withBrand(), { vendor: "Nile Kids" }));

      expect(brands.createBrand).toHaveBeenCalledWith(
        { name: "Nile Kids", slug: "nile-kids" },
        expect.any(String),
      );
      expect(api.setProductBrand).toHaveBeenCalledWith("p1", "nb1", expect.any(String));
      expect(brands.createBrand.mock.invocationCallOrder[0]).toBeLessThan(
        api.setProductBrand.mock.invocationCallOrder[0]!,
      );
    });

    it("clears the brand for a blank vendor, and fetches no brands to do it", async () => {
      use(withBrand());

      await saveProductAction(idle, formFor(withBrand(), { vendor: "" }));

      expect(api.setProductBrand).toHaveBeenCalledWith("p1", null, expect.any(String));
      expect(brands.fetchBrandsPage).not.toHaveBeenCalled();
    });

    it("leaves a product with no brand alone for a blank vendor", async () => {
      use(product());

      await saveProductAction(idle, formFor(product(), { vendor: "" }));

      expect(api.setProductBrand).not.toHaveBeenCalled();
    });

    it("keeps a brand the editor could not name when the vendor is left blank and flagged", async () => {
      use(product({ brandId: "far-away" }));

      await saveProductAction(idle, formFor(product({ brandId: "far-away" }), { vendorKeep: "1" }));

      expect(api.setProductBrand).not.toHaveBeenCalled();
    });

    it("still replaces that brand when a vendor is typed", async () => {
      use(product({ brandId: "far-away" }));

      await saveProductAction(
        idle,
        formFor(product({ brandId: "far-away" }), { vendorKeep: "1", vendor: "Acme Toys" }),
      );

      expect(api.setProductBrand).toHaveBeenCalledWith("p1", "b1", expect.any(String));
    });

    it("uses the brand whose slug matches when creating conflicts, after one re-fetch", async () => {
      use(product());
      brands.createBrand.mockResolvedValue({ outcome: "conflict", message: "slug taken" });
      brands.fetchBrandsPage
        .mockResolvedValueOnce({ outcome: "ok", items: [], pageInfo: onePage })
        .mockResolvedValueOnce({
          outcome: "ok",
          items: [{ id: "b9", name: "Nile-Kids", slug: "nile-kids" }],
          pageInfo: onePage,
        });

      const state = await saveProductAction(idle, formFor(product(), { vendor: "Nile Kids" }));

      expect(state).toEqual({ status: "success" });
      expect(brands.fetchBrandsPage).toHaveBeenCalledTimes(2);
      expect(api.setProductBrand).toHaveBeenCalledWith("p1", "b9", expect.any(String));
    });

    it("returns the conflict on the vendor field when no brand has that slug", async () => {
      use(product());
      brands.createBrand.mockResolvedValue({ outcome: "conflict", message: "slug taken" });

      const state = await saveProductAction(idle, formFor(product(), { vendor: "Nile Kids" }));

      expect(state.status).toBe("error");
      if (state.status === "error") expect(state.fieldErrors["vendor"]).toBe("slug taken");
      expect(api.setProductBrand).not.toHaveBeenCalled();
      expect(brands.fetchBrandsPage).toHaveBeenCalledTimes(2);
    });

    it("writes nothing when the brands cannot be read", async () => {
      use(product());
      brands.fetchBrandsPage.mockResolvedValue({ outcome: "error", message: "down" });

      const state = await saveProductAction(
        idle,
        formFor(product(), { title: "Renamed", vendor: "Acme Toys" }),
      );

      expect(state.status).toBe("error");
      expect(api.updateProduct).not.toHaveBeenCalled();
      expect(api.setProductBrand).not.toHaveBeenCalled();
    });

    it("keeps the brand step after SEO and before categories", async () => {
      use(product());

      await saveProductAction(
        idle,
        formFor(product(), { vendor: "Nile Kids", seoTitle: "T", categoryIds: ["c1"] }),
      );

      const order = [
        api.setProductSeo.mock.invocationCallOrder[0]!,
        brands.createBrand.mock.invocationCallOrder[0]!,
        api.setProductBrand.mock.invocationCallOrder[0]!,
        api.assignProductCategories.mock.invocationCallOrder[0]!,
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });
  });

  describe("createProductAction", () => {
    beforeEach(() => {
      api.createProduct.mockResolvedValue({ outcome: "ok", data: { id: "new-1" } });
    });

    function createForm(overrides: Record<string, string | string[]> = {}): FormData {
      const base = formFor(product(), {
        title: "Plush Bear",
        handle: "",
        sku: "",
        price: "150.50",
        status: "draft",
        ...overrides,
      });
      base.delete("productId");
      base.delete("variantId");
      return base;
    }

    async function redirectOf(promise: Promise<unknown>): Promise<string> {
      try {
        await promise;
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    }

    it("assigns an existing brand by name", async () => {
      await redirectOf(createProductAction(idle, createForm({ vendor: "acme toys" })));

      expect(brands.createBrand).not.toHaveBeenCalled();
      expect(api.setProductBrand).toHaveBeenCalledWith("new-1", "b1", expect.any(String));
    });

    it("creates and assigns a new brand", async () => {
      const target = await redirectOf(
        createProductAction(idle, createForm({ vendor: "Nile Kids" })),
      );

      expect(target).toBe("NEXT_REDIRECT:/products/new-1");
      expect(brands.createBrand).toHaveBeenCalledWith(
        { name: "Nile Kids", slug: "nile-kids" },
        expect.any(String),
      );
      expect(api.setProductBrand).toHaveBeenCalledWith("new-1", "nb1", expect.any(String));
    });

    it("makes no brand call, and reads no brands, for a blank vendor", async () => {
      await redirectOf(createProductAction(idle, createForm()));

      expect(brands.fetchBrandsPage).not.toHaveBeenCalled();
      expect(brands.createBrand).not.toHaveBeenCalled();
      expect(api.setProductBrand).not.toHaveBeenCalled();
    });

    it("redirects with ?saved=partial when the brand cannot be created", async () => {
      brands.createBrand.mockResolvedValue({ outcome: "error", message: "boom" });

      const target = await redirectOf(
        createProductAction(idle, createForm({ vendor: "Nile Kids" })),
      );

      expect(target).toBe("NEXT_REDIRECT:/products/new-1?saved=partial");
    });

    it("creates nothing when the brands cannot be read", async () => {
      brands.fetchBrandsPage.mockResolvedValue({ outcome: "unauthorized" });

      const state = await createProductAction(idle, createForm({ vendor: "Acme Toys" }));

      expect(state.status).toBe("error");
      expect(api.createProduct).not.toHaveBeenCalled();
    });
  });
});

describe("duplicateProductAction (Plan 2C-4)", () => {
  const richVariant = variant({
    compareAtAmountMinor: 20000,
    costAmountMinor: 9000,
    barcode: "123",
    weightGrams: 250,
    requiresShipping: false,
    taxable: false,
    tracksInventory: true,
    inventoryPolicy: "continue",
  });
  const source = (overrides: Partial<ProductDetailDto> = {}): ProductDetailDto =>
    product({
      description: "Soft and cuddly",
      productType: "Toy",
      tags: ["plush", "gift"],
      brandId: "b1",
      categoryIds: ["c1", "c2"],
      seoTitle: "Plush Bear | Shop",
      seoDescription: "The softest bear",
      mediaAssetIds: ["m1", "m2"],
      variants: [richVariant],
      ...overrides,
    });
  /** What the API answers for the new product right after it is created: one plain variant. */
  const freshCopy = product({
    id: "new-1",
    sku: "P-COPY01",
    slug: "plush-bear-copy",
    status: "draft",
    variants: [variant({ id: "cv1", sku: "P-COPY01-1" })],
  });

  function serve(original: ProductDetailDto): void {
    api.fetchProduct.mockImplementation((id: string) =>
      Promise.resolve({ outcome: "ok", product: id === original.id ? original : freshCopy }),
    );
  }

  beforeEach(() => {
    api.createProduct.mockResolvedValue({ outcome: "ok", data: { id: "new-1" } });
    api.attachProductMedia.mockResolvedValue(ok);
  });

  function formForProduct(productId = "p1"): FormData {
    const formData = new FormData();
    formData.append("productId", productId);
    return formData;
  }

  async function redirectOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      return (error as Error).message;
    }
    return "";
  }

  it("creates a draft copy named after the original, with a fresh product and variant SKU", async () => {
    serve(source());

    const target = await redirectOf(duplicateProductAction(idle, formForProduct()));

    expect(target).toBe("NEXT_REDIRECT:/products/new-1");
    expect(api.createProduct).toHaveBeenCalledTimes(1);
    const input = api.createProduct.mock.calls[0]![0];
    expect(input).toMatchObject({
      name: en.productEditor.copyOf.replace("{name}", "Plush Bear"),
      slug: "plush-bear-copy",
      description: "Soft and cuddly",
      productType: "Toy",
      tags: ["plush", "gift"],
    });
    expect(input.sku).toMatch(/^P-[A-Z0-9]{6}$/);
    expect(input.sku).not.toBe("P-ABC123");
    expect(input.variants).toHaveLength(1);
    expect(input.variants[0].sku).toBe(`${input.sku}-1`);
    expect(input.variants[0].sku).not.toBe("SKU-1");
  });

  it("copies the variant's price and attributes, and leaves the copy a draft", async () => {
    serve(source());

    await redirectOf(duplicateProductAction(idle, formForProduct()));

    expect(api.createProduct.mock.calls[0]![0].variants[0]).toMatchObject({
      priceAmountMinor: 15000,
      currency: "EGP",
      compareAtAmountMinor: 20000,
      costAmountMinor: 9000,
      barcode: "123",
      weightGrams: 250,
      requiresShipping: false,
      taxable: false,
      tracksInventory: true,
      inventoryPolicy: "continue",
    });
    expect(api.publishProduct).not.toHaveBeenCalled();
    expect(api.unlistProduct).not.toHaveBeenCalled();
    expect(api.setProductOptions).not.toHaveBeenCalled();
  });

  it("copies the description's neighbours: brand, categories, SEO and media", async () => {
    serve(source());

    await redirectOf(duplicateProductAction(idle, formForProduct()));

    expect(api.setProductBrand).toHaveBeenCalledWith("new-1", "b1", expect.any(String));
    expect(api.assignProductCategories).toHaveBeenCalledWith(
      "new-1",
      ["c1", "c2"],
      expect.any(String),
    );
    expect(api.setProductSeo).toHaveBeenCalledWith(
      "new-1",
      { title: "Plush Bear | Shop", description: "The softest bear" },
      expect.any(String),
    );
    expect(api.attachProductMedia.mock.calls.map((call) => call[1])).toEqual(["m1", "m2"]);
    expect(api.attachProductMedia.mock.calls.every((call) => call[0] === "new-1")).toBe(true);
  });

  it("does not copy stock", async () => {
    serve(source());

    await redirectOf(duplicateProductAction(idle, formForProduct()));

    expect(inventory.registerWarehouse).not.toHaveBeenCalled();
    expect(inventory.receiveStock).not.toHaveBeenCalled();
    expect(inventory.adjustStock).not.toHaveBeenCalled();
    expect(api.fetchProductInventory).not.toHaveBeenCalled();
  });

  it("skips the follow-ups the original does not have", async () => {
    serve(
      source({
        brandId: null,
        categoryIds: [],
        seoTitle: null,
        seoDescription: null,
        mediaAssetIds: [],
      }),
    );

    await redirectOf(duplicateProductAction(idle, formForProduct()));

    expect(api.setProductBrand).not.toHaveBeenCalled();
    expect(api.assignProductCategories).not.toHaveBeenCalled();
    expect(api.setProductSeo).not.toHaveBeenCalled();
    expect(api.attachProductMedia).not.toHaveBeenCalled();
  });

  it("retries once with a random suffix when the -copy handle is taken", async () => {
    serve(source());
    api.createProduct
      .mockResolvedValueOnce({ outcome: "conflict", message: "slug taken" })
      .mockResolvedValueOnce({ outcome: "ok", data: { id: "new-1" } });

    const target = await redirectOf(duplicateProductAction(idle, formForProduct()));

    expect(target).toBe("NEXT_REDIRECT:/products/new-1");
    expect(api.createProduct).toHaveBeenCalledTimes(2);
    expect(api.createProduct.mock.calls[1]![0].slug).toMatch(/^plush-bear-copy-[a-z0-9]{4}$/);
  });

  it("reports a second conflict instead of retrying again", async () => {
    serve(source());
    api.createProduct.mockResolvedValue({ outcome: "conflict", message: "slug taken" });

    const state = await duplicateProductAction(idle, formForProduct());

    expect(api.createProduct).toHaveBeenCalledTimes(2);
    expect(state).toMatchObject({ status: "error", message: "slug taken" });
  });

  describe("a product with options", () => {
    const sized = () =>
      source({
        options: [{ name: "Size", values: ["S", "M"] }],
        variants: [
          variant({ id: "s", sku: "SKU-S", selection: { Size: "S" }, priceAmountMinor: 15000 }),
          variant({
            id: "m",
            sku: "SKU-M",
            selection: { Size: "M" },
            priceAmountMinor: 25000,
            costAmountMinor: 11000,
          }),
        ],
      });

    beforeEach(() => {
      api.addProductVariant.mockResolvedValue({ outcome: "ok", data: { variantId: "cv2" } });
    });

    it("rebuilds the options on the copy with the option planner, then prices every row from the original", async () => {
      serve(sized());

      const target = await redirectOf(duplicateProductAction(idle, formForProduct()));

      expect(target).toBe("NEXT_REDIRECT:/products/new-1");
      // The copy is read back, then given the original's options.
      expect(api.fetchProduct).toHaveBeenCalledWith("new-1");
      expect(api.setProductOptions).toHaveBeenCalledWith(
        "new-1",
        [{ name: "Size", values: ["S", "M"] }],
        expect.any(String),
      );
      expect(api.addProductVariant).toHaveBeenCalledTimes(1);
      expect(api.addProductVariant.mock.calls[0]![1]).toMatchObject({
        selection: { Size: "M" },
      });

      // Each row ends up with the price of the original variant that has the same selection.
      const priced = api.updateProductVariant.mock.calls.filter(
        (call) =>
          (call[2] as { compareAtAmountMinor?: unknown }).compareAtAmountMinor !== undefined,
      );
      const byVariant = Object.fromEntries(
        priced.map((call) => [
          call[1] as string,
          (call[2] as { priceAmountMinor: number }).priceAmountMinor,
        ]),
      );
      expect(byVariant).toEqual({ cv1: 15000, cv2: 25000 });
      expect(
        (priced.find((call) => call[1] === "cv2")![2] as { costAmountMinor: number })
          .costAmountMinor,
      ).toBe(11000);
    });

    it("runs the option calls before the pricing", async () => {
      serve(sized());

      await redirectOf(duplicateProductAction(idle, formForProduct()));

      const optionsAt = api.setProductOptions.mock.invocationCallOrder[0]!;
      const addAt = api.addProductVariant.mock.invocationCallOrder[0]!;
      const lastPriceAt = Math.max(...api.updateProductVariant.mock.invocationCallOrder);
      expect(optionsAt).toBeLessThan(addAt);
      expect(addAt).toBeLessThan(lastPriceAt);
    });

    it("still redirects to the copy, flagged partial, when an option call fails", async () => {
      serve(sized());
      api.setProductOptions.mockResolvedValue({ outcome: "error", message: "boom" });

      const target = await redirectOf(duplicateProductAction(idle, formForProduct()));

      expect(target).toBe("NEXT_REDIRECT:/products/new-1?saved=partial");
    });
  });

  it("still redirects to the copy, flagged partial, when a later step fails", async () => {
    serve(source());
    api.setProductBrand.mockResolvedValue({ outcome: "error", message: "boom" });

    const target = await redirectOf(duplicateProductAction(idle, formForProduct()));

    expect(target).toBe("NEXT_REDIRECT:/products/new-1?saved=partial");
  });

  it("makes no copy of a product that cannot be read", async () => {
    api.fetchProduct.mockResolvedValue({ outcome: "not_found" });

    const state = await duplicateProductAction(idle, formForProduct());

    expect(state.status).toBe("error");
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it("rejects a form with no product id without calling the API", async () => {
    const state = await duplicateProductAction(idle, new FormData());

    expect(state.status).toBe("error");
    expect(api.fetchProduct).not.toHaveBeenCalled();
    expect(api.createProduct).not.toHaveBeenCalled();
  });
});
