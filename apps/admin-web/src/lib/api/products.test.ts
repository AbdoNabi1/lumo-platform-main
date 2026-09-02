import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const {
  createProduct,
  updateProduct,
  publishProduct,
  schedulePublishProduct,
  unpublishProduct,
  archiveProduct,
  deleteProduct,
  addProductVariant,
  removeProductVariant,
  updateProductVariant,
  setProductOptions,
  setProductSeo,
  setProductBrand,
  assignProductCategories,
  attachProductMedia,
  detachProductMedia,
  reorderProductMedia,
} = await import("./products");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("createProduct", () => {
  it("sends the right path, method, body and idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "product-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = {
      sku: "SKU-1",
      name: "Wooden Blocks",
      slug: "wooden-blocks",
      variants: [{ sku: "SKU-1-STD", priceAmountMinor: 2999, currency: "USD" }],
    };
    const result = await createProduct(input, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "product-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/products");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("maps a 422 to invalid, preserving the fields", async () => {
    const envelope = {
      code: "VALIDATION",
      message: "Invalid input",
      retryable: false,
      fields: [{ field: "sku", message: "must not be empty" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createProduct(
      { sku: "", name: "Wooden Blocks", slug: "wooden-blocks", variants: [] },
      "key-1",
    );

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "sku", message: "must not be empty" }],
    });
  });

  it("returns an empty id, still ok, when the response has no readable id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createProduct(
      {
        sku: "SKU-1",
        name: "Wooden Blocks",
        slug: "wooden-blocks",
        variants: [{ sku: "SKU-1-STD", priceAmountMinor: 2999, currency: "USD" }],
      },
      "key-1",
    );

    expect(result).toEqual({ outcome: "ok", data: { id: "" } });
  });
});

describe("updateProduct", () => {
  it("sends the right path, method and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await updateProduct(
      "product-1",
      { name: "New name", slug: "new-slug" },
      "key-2",
    );

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/products/product-1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "New name", slug: "new-slug" });
  });

  it("maps a 409 to conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { code: "CONCURRENCY", message: "stale version" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateProduct("product-1", { name: "x", slug: "y" }, "key-3");

    expect(result).toEqual({ outcome: "conflict", message: "stale version" });
  });
});

/**
 * T5.1's 15 write functions. Every route's handler returns an unmapped/aggregate response (see
 * the doc comment above them in `products.ts`), so these assert the request shape only (path,
 * method, body, idempotency header) plus the ok/error mapping — the same discipline
 * `updateProduct`'s own tests already use above.
 */
describe("T5.1 write functions", () => {
  function stubOk(body: unknown = {}): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    return fetchMock;
  }

  function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  it("publishProduct posts to /publish with no body", async () => {
    const fetchMock = stubOk();
    const result = await publishProduct("product-1", "key-1");
    expect(result.outcome).toBe("ok");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/publish");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("schedulePublishProduct posts scheduledAt", async () => {
    const fetchMock = stubOk();
    await schedulePublishProduct("product-1", { scheduledAt: "2026-09-01T10:00" }, "key-2");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/schedule-publish");
    expect(JSON.parse(init.body as string)).toEqual({ scheduledAt: "2026-09-01T10:00" });
  });

  it("unpublishProduct posts to /unpublish", async () => {
    const fetchMock = stubOk();
    await unpublishProduct("product-1", "key-3");
    const [url] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/unpublish");
  });

  it("archiveProduct posts to /archive", async () => {
    const fetchMock = stubOk();
    await archiveProduct("product-1", "key-4");
    const [url] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/archive");
  });

  it("deleteProduct posts to /delete", async () => {
    const fetchMock = stubOk();
    await deleteProduct("product-1", "key-5");
    const [url] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/delete");
  });

  it("addProductVariant posts sku/price/currency/selection", async () => {
    const fetchMock = stubOk();
    await addProductVariant(
      "product-1",
      { sku: "SKU-2", priceAmountMinor: 1999, currency: "USD", selection: { Color: "Red" } },
      "key-6",
    );
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/variants");
    expect(JSON.parse(init.body as string)).toEqual({
      sku: "SKU-2",
      priceAmountMinor: 1999,
      currency: "USD",
      selection: { Color: "Red" },
    });
  });

  it("removeProductVariant posts to /variants/:variantId/remove", async () => {
    const fetchMock = stubOk();
    await removeProductVariant("product-1", "variant-1", "key-7");
    const [url] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/variants/variant-1/remove");
  });

  it("updateProductVariant posts to /variants/:variantId with sku/price/currency", async () => {
    const fetchMock = stubOk();
    await updateProductVariant(
      "product-1",
      "variant-1",
      { sku: "SKU-3", priceAmountMinor: 500, currency: "EUR" },
      "key-8",
    );
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/variants/variant-1");
    expect(JSON.parse(init.body as string)).toEqual({
      sku: "SKU-3",
      priceAmountMinor: 500,
      currency: "EUR",
    });
  });

  it("setProductOptions replaces the whole option set", async () => {
    const fetchMock = stubOk();
    await setProductOptions(
      "product-1",
      [{ name: "Color", values: ["Red", "Blue"] }],
      "key-9",
    );
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/options");
    expect(JSON.parse(init.body as string)).toEqual({
      options: [{ name: "Color", values: ["Red", "Blue"] }],
    });
  });

  it("setProductSeo posts title/description", async () => {
    const fetchMock = stubOk();
    await setProductSeo("product-1", { title: "T", description: "D" }, "key-10");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/seo");
    expect(JSON.parse(init.body as string)).toEqual({ title: "T", description: "D" });
  });

  it("setProductBrand posts a brandId, or null to clear it", async () => {
    const fetchMock = stubOk();
    await setProductBrand("product-1", "brand-1", "key-11");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/brand");
    expect(JSON.parse(init.body as string)).toEqual({ brandId: "brand-1" });

    const fetchMock2 = stubOk();
    await setProductBrand("product-1", null, "key-12");
    const [, init2] = requestOf(fetchMock2);
    expect(JSON.parse(init2.body as string)).toEqual({ brandId: null });
  });

  it("assignProductCategories posts a full categoryIds replace", async () => {
    const fetchMock = stubOk();
    await assignProductCategories("product-1", ["cat-1", "cat-2"], "key-13");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/categories");
    expect(JSON.parse(init.body as string)).toEqual({ categoryIds: ["cat-1", "cat-2"] });
  });

  it("attachProductMedia posts an assetId", async () => {
    const fetchMock = stubOk();
    await attachProductMedia("product-1", "asset-1", "key-14");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/media");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ assetId: "asset-1" });
  });

  it("detachProductMedia sends a DELETE with no body", async () => {
    const fetchMock = stubOk();
    await detachProductMedia("product-1", "asset-1", "key-15");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/media/asset-1");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("reorderProductMedia sends a PUT with the full assetIds order", async () => {
    const fetchMock = stubOk();
    await reorderProductMedia("product-1", ["asset-2", "asset-1"], "key-16");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/products/product-1/media");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ assetIds: ["asset-2", "asset-1"] });
  });

  it("maps a 403 to forbidden for a permission-gated write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await publishProduct("product-1", "key-17");
    expect(result).toEqual({ outcome: "forbidden" });
  });

  it("maps a 422 on setProductOptions to invalid with field issues", async () => {
    const envelope = {
      message: "Cannot set options on a published product",
      fields: [{ field: "", message: "Cannot set options on a published product" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);
    const result = await setProductOptions("product-1", [], "key-18");
    expect(result).toEqual({
      outcome: "invalid",
      message: "Cannot set options on a published product",
      fields: [{ field: "", message: "Cannot set options on a published product" }],
    });
  });
});
