import { describe, expect, it } from "vitest";
import type { Product } from "@platform/catalog";
import type { ResolvedImage } from "@platform/media";
import type { WiredAdmin } from "../composition";
import {
  featuredImageOf,
  hoverImageOf,
  lineKey,
  loadImages,
  productMedia,
  resolveLineImages,
  variantImageIdOf,
  withLineImages,
} from "./product-images";

const image = (id: string): ResolvedImage => ({
  id,
  url: `https://cdn.example.test/${id}.png`,
  alt: `alt ${id}`,
  width: 10,
  height: 10,
});

interface FakeVariant {
  id: string;
  mediaRef: string | null;
}
function fakeProduct(id: string, media: string[], variants: FakeVariant[] = []): Product {
  return {
    id: { toString: () => id, value: id },
    media: media.map((assetId) => ({ assetId })),
    variants: variants.map((v) => ({ id: { toString: () => v.id }, mediaRef: v.mediaRef })),
  } as unknown as Product;
}

function fakeAdmin(known: string[], products: Product[] = []) {
  const calls = { images: [] as string[][], products: [] as string[][] };
  const admin = {
    mediaImages: {
      execute: async ({ ids }: { ids: readonly string[] }) => {
        calls.images.push([...ids]);
        return new Map(ids.filter((id) => known.includes(id)).map((id) => [id, image(id)]));
      },
    },
    publicReads: {
      products: {
        getByIds: async ({ ids }: { ids: readonly string[] }) => {
          calls.products.push([...ids]);
          return { status: 200, body: products.filter((p) => ids.includes(p.id.toString())) };
        },
      },
    },
  } as unknown as WiredAdmin;
  return { admin, calls };
}

describe("loadImages — one read for a whole page of products", () => {
  it("resolves every product's pictures with a single call, deduplicated", async () => {
    const products = [
      fakeProduct("p1", ["a", "b"]),
      fakeProduct("p2", ["b", "c"], [{ id: "v", mediaRef: "c" }]),
      fakeProduct("p3", []),
    ];
    const { admin, calls } = fakeAdmin(["a", "b", "c"]);

    const images = await loadImages(admin, "t1", products, { perProduct: 2, variants: true });

    expect(calls.images).toHaveLength(1);
    expect([...calls.images[0]!].sort()).toEqual(["a", "b", "c"]);
    expect([...images.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("asks for only the first few pictures of a product when it has many", async () => {
    const products = [fakeProduct("p1", ["1", "2", "3", "4", "5", "6"])];
    const { admin, calls } = fakeAdmin([]);
    await loadImages(admin, "t1", products, { perProduct: 2, variants: false });
    expect(calls.images[0]).toEqual(["1", "2"]);
  });

  it("makes no call for products with no media at all", async () => {
    const { admin, calls } = fakeAdmin([]);
    const images = await loadImages(admin, "t1", [fakeProduct("p1", [])], {
      perProduct: 2,
      variants: true,
    });
    expect(images.size).toBe(0);
    expect(calls.images).toHaveLength(0);
  });
});

describe("picking images for one product", () => {
  const product = fakeProduct("p1", ["a", "b", "c"], [{ id: "v1", mediaRef: "b" }]);

  it("lists the media in the product's order, skipping the ones that did not resolve", async () => {
    const { admin } = fakeAdmin(["c", "a"]);
    const images = await loadImages(admin, "t1", [product], { perProduct: 3, variants: true });
    expect(productMedia(product, images).map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("features the first resolved image and hovers on the next one", async () => {
    const { admin } = fakeAdmin(["b", "c"]);
    const images = await loadImages(admin, "t1", [product], { perProduct: 3, variants: true });
    expect(featuredImageOf(product, images)?.id).toBe("b");
    expect(hoverImageOf(product, images)?.id).toBe("c");
  });

  it("is null when nothing resolved", () => {
    expect(featuredImageOf(product, new Map())).toBeNull();
    expect(hoverImageOf(product, new Map())).toBeNull();
  });

  it("reports a variant's image id only when that image resolved", async () => {
    const { admin } = fakeAdmin(["b"]);
    const images = await loadImages(admin, "t1", [product], { perProduct: 3, variants: true });
    const variant = product.variants[0]!;
    expect(variantImageIdOf(variant, images)).toBe("b");
    expect(variantImageIdOf(variant, new Map())).toBeNull();
  });
});

describe("resolveLineImages — order, cart and checkout lines", () => {
  it("uses the variant's image, else the product's featured image, in two reads for any number of lines", async () => {
    const p1 = fakeProduct(
      "p1",
      ["a", "b"],
      [
        { id: "v1", mediaRef: "b" },
        { id: "v2", mediaRef: null },
      ],
    );
    const p2 = fakeProduct("p2", ["c"], [{ id: "v3", mediaRef: null }]);
    const { admin, calls } = fakeAdmin(["a", "b", "c"], [p1, p2]);

    const lines = await resolveLineImages(admin, "t1", [
      { productId: "p1", variantId: "v1" },
      { productId: "p1", variantId: "v2" },
      { productId: "p2", variantId: "v3" },
      { productId: "p2", variantId: "v3" },
    ]);

    expect(calls.products).toHaveLength(1);
    expect(calls.images).toHaveLength(1);
    expect(lines.get(lineKey("p1", "v1"))?.id).toBe("b");
    expect(lines.get(lineKey("p1", "v2"))?.id).toBe("a");
    expect(lines.get(lineKey("p2", "v3"))?.id).toBe("c");
  });

  it("gives null for a product that no longer exists, and for a line with no variant", async () => {
    const p1 = fakeProduct("p1", ["a"], [{ id: "v1", mediaRef: null }]);
    const { admin } = fakeAdmin(["a"], [p1]);
    const lines = await resolveLineImages(admin, "t1", [
      { productId: "deleted", variantId: "v9" },
      { productId: "p1", variantId: null },
    ]);
    expect(lines.get(lineKey("deleted", "v9"))).toBeNull();
    expect(lines.get(lineKey("p1", null))?.id).toBe("a");
  });

  it("falls back to the product's next image when the variant's image is gone", async () => {
    const p1 = fakeProduct("p1", ["a", "b"], [{ id: "v1", mediaRef: "gone" }]);
    const { admin } = fakeAdmin(["a", "b"], [p1]);
    const lines = await resolveLineImages(admin, "t1", [{ productId: "p1", variantId: "v1" }]);
    expect(lines.get(lineKey("p1", "v1"))?.id).toBe("a");
  });

  it("makes no read at all for no lines", async () => {
    const { admin, calls } = fakeAdmin([]);
    expect((await resolveLineImages(admin, "t1", [])).size).toBe(0);
    expect(calls.products).toHaveLength(0);
    expect(calls.images).toHaveLength(0);
  });
});

describe("a failing picture lookup never fails the page (Plan 2C-3)", () => {
  const broken = () =>
    ({
      mediaImages: {
        execute: async () => {
          throw new Error("storage index down");
        },
      },
      publicReads: {
        products: {
          getByIds: async () => {
            throw new Error("catalog read down");
          },
        },
      },
    }) as unknown as WiredAdmin;

  it("loadImages answers no pictures", async () => {
    const images = await loadImages(broken(), "t1", [fakeProduct("p1", ["a"])], {
      perProduct: 1,
      variants: false,
    });
    expect(images.size).toBe(0);
  });

  it("resolveLineImages answers a placeholder for every line", async () => {
    const lines = await resolveLineImages(broken(), "t1", [{ productId: "p1", variantId: "v1" }]);
    expect(lines.get(lineKey("p1", "v1")) ?? null).toBeNull();
  });

  it("withLineImages returns the cart untouched, still a success", async () => {
    const cart = { id: "c1", items: [{ productId: "p1", variantId: "v1", imageUrl: null }] };
    const [route] = withLineImages(broken(), [
      {
        method: "GET",
        path: "/public/carts/:cartId",
        version: 1,
        permission: "cart:read",
        summary: "x",
        schema: {},
        handle: async () => ({ status: 200, body: cart }),
      },
    ]);
    const response = await route!.handle({
      body: undefined,
      params: {},
      query: {},
      context: { tenantId: "t1" },
    } as never);
    expect(response).toEqual({ status: 200, body: cart });
  });
});
