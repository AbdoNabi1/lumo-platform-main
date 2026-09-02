import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductSummary, WishlistSummary } from "./runtime-api";

const getMyWishlist = vi.fn<() => Promise<{ status: number; body: WishlistSummary | null }>>();
const getProducts = vi.fn<() => Promise<readonly ProductSummary[] | null>>();

vi.mock("./runtime-api", () => ({
  getMyWishlist: () => getMyWishlist(),
  getProducts: () => getProducts(),
}));

const { resolveMyWishlist } = await import("./wishlist");

beforeEach(() => {
  getMyWishlist.mockReset();
  getProducts.mockReset();
  getProducts.mockResolvedValue([]);
});

function wishlist(items: WishlistSummary["items"]): WishlistSummary {
  return { id: "wishlist-1", status: "active", items };
}

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: "prod-1",
    sku: "SKU-1",
    name: "Wooden Blocks",
    slug: "wooden-blocks",
    status: "published",
    variants: [],
    ...overrides,
  };
}

const ITEM = { productRef: "prod-1", addedAt: "2026-08-31T00:00:00.000Z", shareToken: null };

describe("resolveMyWishlist", () => {
  it("joins each saved item to its Catalog product for a name and a link", async () => {
    getMyWishlist.mockResolvedValue({ status: 200, body: wishlist([ITEM]) });
    getProducts.mockResolvedValue([product()]);

    const result = await resolveMyWishlist("session-1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.lines).toEqual([
      {
        productRef: "prod-1",
        name: "Wooden Blocks",
        slug: "wooden-blocks",
        addedAt: "2026-08-31T00:00:00.000Z",
        shareToken: null,
      },
    ]);
  });

  it("resolves an item saved by VARIANT id, since productRef is opaque", async () => {
    getMyWishlist.mockResolvedValue({
      status: 200,
      body: wishlist([{ ...ITEM, productRef: "variant-9" }]),
    });
    getProducts.mockResolvedValue([
      product({ variants: [{ id: "variant-9", sku: "V-9", priceAmountMinor: 100, currency: "USD" }] }),
    ]);

    const result = await resolveMyWishlist("session-1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.lines[0]?.name).toBe("Wooden Blocks");
  });

  it("never fabricates a name for a product that no longer resolves", async () => {
    getMyWishlist.mockResolvedValue({ status: 200, body: wishlist([ITEM]) });
    getProducts.mockResolvedValue([]);

    const result = await resolveMyWishlist("session-1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.lines[0]?.name).toBeNull();
    expect(result.lines[0]?.slug).toBeNull();
    // The saved ref itself is still real and still shown.
    expect(result.lines[0]?.productRef).toBe("prod-1");
  });

  it("carries a share token through when the item has one", async () => {
    getMyWishlist.mockResolvedValue({
      status: 200,
      body: wishlist([{ ...ITEM, shareToken: "token-abc" }]),
    });
    getProducts.mockResolvedValue([product()]);

    const result = await resolveMyWishlist("session-1");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.lines[0]?.shareToken).toBe("token-abc");
  });

  it("reports `empty` for a signed-in customer with nothing saved", async () => {
    getMyWishlist.mockResolvedValue({ status: 200, body: wishlist([]) });

    expect(await resolveMyWishlist("session-1")).toEqual({ status: "empty" });
  });

  it("reports `signed-out` without calling the API when there is no session cookie", async () => {
    expect(await resolveMyWishlist(undefined)).toEqual({ status: "signed-out" });
    expect(await resolveMyWishlist("")).toEqual({ status: "signed-out" });
    expect(getMyWishlist).not.toHaveBeenCalled();
  });

  it("reports `signed-out` for the guard's 401 — distinct from an empty wishlist", async () => {
    // Rendering "you have saved nothing" to someone who is not signed in would assert something
    // false about their account (T5.16 §3).
    getMyWishlist.mockResolvedValue({ status: 401, body: null });

    expect(await resolveMyWishlist("expired-or-revoked")).toEqual({ status: "signed-out" });
  });

  it("reports `error` for a transport failure, never an empty wishlist", async () => {
    getMyWishlist.mockResolvedValue({ status: 0, body: null });
    expect(await resolveMyWishlist("session-1")).toEqual({ status: "error" });

    getMyWishlist.mockResolvedValue({ status: 500, body: null });
    expect(await resolveMyWishlist("session-1")).toEqual({ status: "error" });
  });
});
