// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

/**
 * Plan 2C-3 — the media server actions: upload, attach (many, in order), detach (many), reorder, alt
 * text, variant image, and "a new product gets the images uploaded before it existed".
 */

const products = vi.hoisted(() => ({
  attachProductMedia: vi.fn(),
  detachProductMedia: vi.fn(),
  reorderProductMedia: vi.fn(),
  setProductVariantImage: vi.fn(),
  createProduct: vi.fn(),
  fetchProduct: vi.fn(),
}));
const media = vi.hoisted(() => ({
  uploadProductImage: vi.fn(),
  updateMediaAlt: vi.fn(),
}));
const inventory = vi.hoisted(() => ({
  fetchWarehouses: vi.fn(),
  registerWarehouse: vi.fn(),
  receiveStock: vi.fn(),
  adjustStock: vi.fn(),
}));
const brands = vi.hoisted(() => ({ fetchBrandsPage: vi.fn(), createBrand: vi.fn() }));

vi.mock("@/lib/api/products", () => products);
vi.mock("@/lib/api/media", () => media);
vi.mock("@/lib/api/brands", () => brands);
vi.mock("@/lib/api/inventory", () => inventory);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

const {
  attachProductMediaAction,
  createProductAction,
  detachProductMediaAction,
  reorderProductMediaAction,
  setVariantImageAction,
  updateMediaAltAction,
  uploadProductImageAction,
} = await import("./actions");

const idle: FormState = { status: "idle" };
const ok = { outcome: "ok", data: {} } as const;

function form(fields: Record<string, string | string[] | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const v of value) data.append(name, v);
    else data.append(name, value);
  }
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const fn of [
    products.attachProductMedia,
    products.detachProductMedia,
    products.reorderProductMedia,
    products.setProductVariantImage,
    media.updateMediaAlt,
  ]) {
    fn.mockResolvedValue(ok);
  }
});

describe("uploadProductImageAction", () => {
  const webp = () => new File([new Uint8Array([1, 2, 3])], "front.webp", { type: "image/webp" });
  const image = { id: "m-1", url: "https://cdn.test/a.webp", alt: null, width: 3, height: 2 };

  it("sends the file bytes, type and name, and returns the stored image", async () => {
    media.uploadProductImage.mockResolvedValue({ outcome: "ok", image });

    const state = await uploadProductImageAction(form({ file: webp() }));

    expect(state).toEqual({ status: "ok", image });
    const input = media.uploadProductImage.mock.calls[0]![0] as {
      bytes: Uint8Array;
      contentType: string;
      fileName: string;
      idempotencyKey: string;
    };
    expect([...input.bytes]).toEqual([1, 2, 3]);
    expect(input.contentType).toBe("image/webp");
    expect(input.fileName).toBe("front.webp");
    expect(input.idempotencyKey.length).toBeGreaterThan(8);
  });

  it.each([
    [{ outcome: "unavailable" }, "unavailable"],
    [{ outcome: "too_large" }, "too_large"],
    [{ outcome: "unsupported" }, "unsupported"],
    [{ outcome: "unauthorized" }, "failed"],
    [{ outcome: "error", message: "boom" }, "failed"],
  ])("maps %j to the reason %s", async (outcome, reason) => {
    media.uploadProductImage.mockResolvedValue(outcome);
    expect(await uploadProductImageAction(form({ file: webp() }))).toEqual({
      status: "error",
      reason,
    });
  });

  it("refuses a missing file and a file over 8 MB without calling the API", async () => {
    expect(await uploadProductImageAction(form({}))).toEqual({
      status: "error",
      reason: "unsupported",
    });
    const big = new File([new Uint8Array(1)], "big.webp", { type: "image/webp" });
    Object.defineProperty(big, "size", { value: 8 * 1024 * 1024 + 1 });
    expect(await uploadProductImageAction(form({ file: big }))).toEqual({
      status: "error",
      reason: "too_large",
    });
    expect(media.uploadProductImage).not.toHaveBeenCalled();
  });
});

describe("attachProductMediaAction", () => {
  it("attaches every posted asset in the posted order", async () => {
    const state = await attachProductMediaAction(
      idle,
      form({ productId: "p1", assetId: ["a", "b", "c"] }),
    );
    expect(state).toEqual({ status: "success" });
    expect(products.attachProductMedia.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["p1", "a"],
      ["p1", "b"],
      ["p1", "c"],
    ]);
  });

  it("stops at the first failure and reports it", async () => {
    products.attachProductMedia
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ outcome: "not_found" });
    const state = await attachProductMediaAction(
      idle,
      form({ productId: "p1", assetId: ["a", "b", "c"] }),
    );
    expect(state.status).toBe("error");
    expect(products.attachProductMedia).toHaveBeenCalledTimes(2);
  });

  it("refuses a post with no asset", async () => {
    expect((await attachProductMediaAction(idle, form({ productId: "p1" }))).status).toBe("error");
    expect(products.attachProductMedia).not.toHaveBeenCalled();
  });
});

describe("detachProductMediaAction and reorderProductMediaAction", () => {
  it("detaches every posted asset", async () => {
    const state = await detachProductMediaAction(
      idle,
      form({ productId: "p1", assetId: ["a", "b"] }),
    );
    expect(state).toEqual({ status: "success" });
    expect(products.detachProductMedia.mock.calls.map((c) => c[1])).toEqual(["a", "b"]);
  });

  it("reorders to exactly the posted order", async () => {
    await reorderProductMediaAction(idle, form({ productId: "p1", assetIds: ["c", "a", "b"] }));
    expect(products.reorderProductMedia).toHaveBeenCalledWith(
      "p1",
      ["c", "a", "b"],
      expect.any(String),
    );
  });
});

describe("updateMediaAltAction", () => {
  it("saves the trimmed alt text of the asset", async () => {
    const state = await updateMediaAltAction(
      idle,
      form({ productId: "p1", mediaId: "m-1", alt: "  Red shoe  " }),
    );
    expect(state).toEqual({ status: "success" });
    expect(media.updateMediaAlt).toHaveBeenCalledWith("m-1", "Red shoe", expect.any(String));
  });

  it("clears the alt text when it is blank", async () => {
    await updateMediaAltAction(idle, form({ mediaId: "m-1", alt: "   " }));
    expect(media.updateMediaAlt).toHaveBeenCalledWith("m-1", null, expect.any(String));
  });

  it("works before a product exists (create mode posts no productId)", async () => {
    expect((await updateMediaAltAction(idle, form({ mediaId: "m-1", alt: "x" }))).status).toBe(
      "success",
    );
  });

  it("refuses a post with no media id", async () => {
    expect((await updateMediaAltAction(idle, form({ alt: "x" }))).status).toBe("error");
    expect(media.updateMediaAlt).not.toHaveBeenCalled();
  });
});

describe("setVariantImageAction", () => {
  it("sets the variant image", async () => {
    await setVariantImageAction(idle, form({ productId: "p1", variantId: "v1", mediaId: "m-2" }));
    expect(products.setProductVariantImage).toHaveBeenCalledWith(
      "p1",
      "v1",
      "m-2",
      expect.any(String),
    );
  });

  it("clears it when the media id is blank (the None choice)", async () => {
    await setVariantImageAction(idle, form({ productId: "p1", variantId: "v1", mediaId: "" }));
    expect(products.setProductVariantImage).toHaveBeenCalledWith(
      "p1",
      "v1",
      null,
      expect.any(String),
    );
  });

  it("refuses a post with no product or variant", async () => {
    expect((await setVariantImageAction(idle, form({ mediaId: "m" }))).status).toBe("error");
    expect(products.setProductVariantImage).not.toHaveBeenCalled();
  });
});

describe("createProductAction — images uploaded before the product existed", () => {
  const base = (extra: Record<string, string | string[]> = {}) =>
    form({
      title: "Plush Bear",
      handle: "",
      currency: "EGP",
      price: "150.00",
      status: "draft",
      sku: "",
      hasVariantFields: "1",
      ...extra,
    });
  async function redirectOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      return (error as Error).message;
    }
    return "";
  }

  beforeEach(() => {
    products.createProduct.mockResolvedValue({ outcome: "ok", data: { id: "new-1" } });
  });

  it("attaches the posted images to the new product in order", async () => {
    const target = await redirectOf(
      createProductAction(idle, base({ mediaAssetId: ["m1", "m2", "m3"] })),
    );
    expect(target).toBe("NEXT_REDIRECT:/products/new-1");
    expect(products.attachProductMedia.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["new-1", "m1"],
      ["new-1", "m2"],
      ["new-1", "m3"],
    ]);
  });

  it("flags ?saved=partial when an image cannot be attached", async () => {
    products.attachProductMedia.mockResolvedValue({ outcome: "error", message: "x" });
    const target = await redirectOf(createProductAction(idle, base({ mediaAssetId: ["m1"] })));
    expect(target).toBe("NEXT_REDIRECT:/products/new-1?saved=partial");
  });

  it("attaches nothing when no image was posted", async () => {
    await redirectOf(createProductAction(idle, base()));
    expect(products.attachProductMedia).not.toHaveBeenCalled();
  });
});
