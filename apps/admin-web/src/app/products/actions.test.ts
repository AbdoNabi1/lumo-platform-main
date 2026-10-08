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
}));

vi.mock("@/lib/api/products", () => api);
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
  saveProductAction,
  saveProductOptionsAction,
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
    sku: v.sku,
    barcode: "",
    requiresShipping: "on",
    weight: "",
    weightUnit: "g",
    seoTitle: "",
    seoDescription: "",
    status: p.status,
    productType: "",
    brandId: "",
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

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
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
      formFor(product(), { title: "Renamed", brandId: "b1" }),
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
        createForm({ status: "published", brandId: "b1", categoryIds: ["c1", "c2"] }),
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

  it("rejects a blank title without calling the API", async () => {
    const state = await createProductAction(idle, createForm({ title: " " }));
    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.fieldErrors["title"]).toBeDefined();
    expect(api.createProduct).not.toHaveBeenCalled();
  });
});

describe("saveProductOptionsAction", () => {
  function optionsForm(rows: [string, string][]): FormData {
    const formData = new FormData();
    formData.append("productId", "p1");
    for (const [name, values] of rows) {
      formData.append("optionName", name);
      formData.append("optionValues", values);
    }
    return formData;
  }

  it("runs the planner's operations in order and keeps the existing variant's values", async () => {
    use(product());
    const state = await saveProductOptionsAction(idle, optionsForm([["Size", "S, M"]]));

    expect(state).toEqual({ status: "success" });
    // The planner declares the options first, then assigns, then adds — every step legal.
    const order = [
      api.setProductOptions.mock.invocationCallOrder[0]!,
      api.updateProductVariant.mock.invocationCallOrder[0]!,
      api.addProductVariant.mock.invocationCallOrder[0]!,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(api.updateProductVariant).toHaveBeenCalledWith(
      "p1",
      "v1",
      { sku: "SKU-1", priceAmountMinor: 15000, currency: "EGP", selection: { Size: "S" } },
      expect.any(String),
    );
    expect(api.addProductVariant).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ selection: { Size: "M" } }),
      expect.any(String),
    );
  });

  it("refuses too many variants without calling the API", async () => {
    use(product());
    const many = Array.from({ length: 11 }, (_, i) => `v${i}`).join(",");
    const state = await saveProductOptionsAction(
      idle,
      optionsForm([
        ["A", many],
        ["B", many],
      ]),
    );
    expect(state).toEqual({
      status: "error",
      message: en.productEditor.tooManyVariants,
      fieldErrors: {},
    });
    expect(api.setProductOptions).not.toHaveBeenCalled();
    expect(api.addProductVariant).not.toHaveBeenCalled();
  });

  it("stops at a failing operation and prefixes the message", async () => {
    use(product());
    api.updateProductVariant.mockResolvedValue({ outcome: "error", message: "boom" });
    const state = await saveProductOptionsAction(idle, optionsForm([["Size", "S, M"]]));

    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message.startsWith(en.productEditor.partiallySaved)).toBe(true);
    }
    expect(api.addProductVariant).not.toHaveBeenCalled();
  });

  it("treats a form with no option rows as removing every option", async () => {
    const withOptions = product({
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        variant({ selection: { Size: "S" } }),
        variant({ id: "v2", sku: "SKU-2", selection: { Size: "M" } }),
      ],
    });
    use(withOptions);
    const state = await saveProductOptionsAction(idle, optionsForm([]));

    expect(state).toEqual({ status: "success" });
    expect(api.removeProductVariant).toHaveBeenCalledWith("p1", "v2", expect.any(String));
    expect(api.setProductOptions).toHaveBeenCalledWith("p1", [], expect.any(String));
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
    // requiresShipping and taxable unchecked → absent → false

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
      },
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
