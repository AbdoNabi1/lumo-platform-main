import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CartSummary, CurrentCartResponse, ProductSummary } from "./runtime-api";

const getCurrentCart = vi.fn<() => Promise<{ status: number; body: CurrentCartResponse | null }>>();
const getProducts = vi.fn<() => Promise<readonly ProductSummary[] | null>>();

vi.mock("./runtime-api", () => ({
  getCurrentCart: () => getCurrentCart(),
  getProducts: () => getProducts(),
}));

const { resolveCurrentCart } = await import("./cart");

beforeEach(() => {
  getCurrentCart.mockReset();
  getProducts.mockReset();
});

function cart(overrides: Partial<CartSummary> = {}): CartSummary {
  return {
    id: "cart-1",
    status: "active",
    currency: "USD",
    isGuest: true,
    items: [],
    subtotalAmountMinor: 0,
    ...overrides,
  };
}

/** A cart line written before variants were tracked (Plan 2A): the four variant fields are null. */
const LEGACY_LINE = { variantId: null, sku: null, title: null, variantTitle: null } as const;

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: "prod-1",
    sku: "SKU-1",
    name: "Wooden Blocks",
    slug: "wooden-blocks",
    status: "published",
    description: null,
    productType: null,
    tags: [],
    options: [],
    variants: [],
    ...overrides,
  };
}

describe("resolveCurrentCart", () => {
  it("resolves an existing cart and joins its lines to Catalog product names", async () => {
    getCurrentCart.mockResolvedValue({
      status: 200,
      body: {
        cart: cart({
          items: [
            {
              productId: "prod-1",
              ...LEGACY_LINE,
              quantity: 2,
              unitPriceAmountMinor: 1500,
              currency: "USD",
              lineTotalAmountMinor: 3000,
            },
          ],
          subtotalAmountMinor: 3000,
        }),
      },
    });
    getProducts.mockResolvedValue([
      product({ id: "prod-1", name: "Wooden Blocks", slug: "wooden-blocks" }),
    ]);

    const result = await resolveCurrentCart("session-1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.lines).toEqual([
      {
        productId: "prod-1",
        variantId: null,
        variantTitle: null,
        name: "Wooden Blocks",
        slug: "wooden-blocks",
        quantity: 2,
        unitPriceAmountMinor: 1500,
        currency: "USD",
        lineTotalAmountMinor: 3000,
      },
    ]);
  });

  it("Plan 2A: a variant line keeps its variant id and label, and its snapshotted title wins over Catalog's", async () => {
    getCurrentCart.mockResolvedValue({
      status: 200,
      body: {
        cart: cart({
          items: [
            {
              productId: "prod-1",
              variantId: "variant-l",
              sku: "SKU-1-L",
              title: "Wooden Blocks (as sold)",
              variantTitle: "L",
              quantity: 1,
              unitPriceAmountMinor: 1200,
              currency: "USD",
              lineTotalAmountMinor: 1200,
            },
          ],
        }),
      },
    });
    getProducts.mockResolvedValue([product({ id: "prod-1" })]);

    const result = await resolveCurrentCart("session-1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.lines[0]).toMatchObject({
      productId: "prod-1",
      variantId: "variant-l",
      variantTitle: "L",
      name: "Wooden Blocks (as sold)",
      slug: "wooden-blocks",
    });
  });

  it("resolves a line by variant id when the product id itself doesn't match", async () => {
    getCurrentCart.mockResolvedValue({
      status: 200,
      body: {
        cart: cart({
          items: [
            {
              productId: "variant-1",
              ...LEGACY_LINE,
              quantity: 1,
              unitPriceAmountMinor: 999,
              currency: "USD",
              lineTotalAmountMinor: 999,
            },
          ],
        }),
      },
    });
    getProducts.mockResolvedValue([
      product({
        id: "prod-1",
        variants: [
          {
            id: "variant-1",
            sku: "SKU-1-A",
            priceAmountMinor: 999,
            currency: "USD",
            selection: null,
            title: null,
            compareAtAmountMinor: null,
          },
        ],
      }),
    ]);

    const result = await resolveCurrentCart("session-1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.lines[0]?.name).toBe("Wooden Blocks");
  });

  it("does not fabricate a name when the product can't be resolved", async () => {
    getCurrentCart.mockResolvedValue({
      status: 200,
      body: {
        cart: cart({
          items: [
            {
              productId: "gone",
              ...LEGACY_LINE,
              quantity: 1,
              unitPriceAmountMinor: 500,
              currency: "USD",
              lineTotalAmountMinor: 500,
            },
          ],
        }),
      },
    });
    getProducts.mockResolvedValue([]);

    const result = await resolveCurrentCart("session-1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.lines[0]).toMatchObject({ name: null, slug: null });
  });

  it("still resolves the cart when the Catalog call fails — names just come back null", async () => {
    getCurrentCart.mockResolvedValue({
      status: 200,
      body: {
        cart: cart({
          items: [
            {
              productId: "prod-1",
              ...LEGACY_LINE,
              quantity: 1,
              unitPriceAmountMinor: 500,
              currency: "USD",
              lineTotalAmountMinor: 500,
            },
          ],
        }),
      },
    });
    getProducts.mockResolvedValue(null);

    const result = await resolveCurrentCart("session-1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.lines[0]?.name).toBeNull();
  });

  it("reports empty (never an error) when the session has no cart yet", async () => {
    getCurrentCart.mockResolvedValue({ status: 200, body: { cart: null } });
    getProducts.mockResolvedValue([]);

    expect(await resolveCurrentCart("session-1")).toEqual({ status: "empty" });
  });

  it("reports empty WITHOUT calling the Runtime API when there is no session at all", async () => {
    const result = await resolveCurrentCart(undefined);

    expect(result).toEqual({ status: "empty" });
    expect(getCurrentCart).not.toHaveBeenCalled();
    expect(getProducts).not.toHaveBeenCalled();
  });

  it("reports error when the cart call fails outright (network/5xx)", async () => {
    getCurrentCart.mockResolvedValue({ status: 0, body: null });
    getProducts.mockResolvedValue([]);

    expect(await resolveCurrentCart("session-1")).toEqual({ status: "error" });
  });
});
