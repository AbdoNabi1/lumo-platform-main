import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentCart = vi.fn();
const createCart = vi.fn();
const addCartItem = vi.fn();
const getPrices = vi.fn();
const getPublicStore = vi.fn();

vi.mock("@/lib/runtime-api", () => ({
  getCurrentCart: (...args: unknown[]) => getCurrentCart(...args),
  createCart: (...args: unknown[]) => createCart(...args),
  addCartItem: (...args: unknown[]) => addCartItem(...args),
  getPrices: (...args: unknown[]) => getPrices(...args),
  getPublicStore: (...args: unknown[]) => getPublicStore(...args),
  getInventory: async () => [],
  changeCartItemQuantity: vi.fn(),
  clearCart: vi.fn(),
  removeCartItem: vi.fn(),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

let cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
  }),
}));

// Imported after the mocks above so the module under test picks them up.
const actions = await import("./actions");

beforeEach(() => {
  cookieStore = new Map();
  getCurrentCart.mockReset();
  createCart.mockReset();
  addCartItem.mockReset();
  getPrices.mockReset();
  getPublicStore.mockReset();
  revalidatePath.mockReset();
  getPublicStore.mockResolvedValue({ name: "Lumo", currency: "EGP" });
  getCurrentCart.mockResolvedValue({ status: 200, body: { cart: undefined } });
  createCart.mockResolvedValue({ status: 201, body: { id: "cart-1" } });
  addCartItem.mockResolvedValue({ status: 200, body: {} });
});

describe("addToCart (Plan 2C-1: the variant is the only price source)", () => {
  it("creates the cart in the STORE currency, and never reads the Pricing screen", async () => {
    getPublicStore.mockResolvedValue({ name: "Lumo", currency: "SAR" });

    const result = await actions.addToCart("prod-1", 1, "var-1");

    expect(result).toEqual({ ok: true });
    expect(createCart).toHaveBeenCalledWith(expect.any(String), "SAR");
    expect(getPrices).not.toHaveBeenCalled();
  });

  it("sends the product and variant but never a price", async () => {
    await actions.addToCart("prod-1", 2, "var-1");

    const body = addCartItem.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).toMatchObject({ productId: "prod-1", variantId: "var-1", quantity: 2 });
    expect(Object.keys(body)).not.toContain("unitPriceAmountMinor");
    expect(Object.keys(body)).not.toContain("currency");
  });

  it("fails before any cart call when the store currency cannot be read", async () => {
    getPublicStore.mockResolvedValue(null);

    expect(await actions.addToCart("prod-1", 1, "var-1")).toEqual({ ok: false, reason: "network" });
    expect(getCurrentCart).not.toHaveBeenCalled();
    expect(createCart).not.toHaveBeenCalled();
    expect(addCartItem).not.toHaveBeenCalled();
  });

  it("maps the server's plain 422 (not for sale) to `unavailable`, not `network`", async () => {
    addCartItem.mockResolvedValue({
      status: 422,
      body: { code: "VALIDATION", message: "Unable to resolve a price for this product" },
    });
    expect(await actions.addToCart("prod-1", 1, "var-1")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("still maps VARIANT_REQUIRED to `choose-variant` and a 404 to `ownership`", async () => {
    addCartItem.mockResolvedValueOnce({ status: 422, body: { code: "VARIANT_REQUIRED" } });
    expect(await actions.addToCart("prod-1", 1, undefined)).toEqual({
      ok: false,
      reason: "choose-variant",
    });
    addCartItem.mockResolvedValueOnce({ status: 404, body: null });
    expect(await actions.addToCart("prod-1", 1, "var-1")).toEqual({
      ok: false,
      reason: "ownership",
    });
  });

  it("reuses an existing cart in the store currency instead of creating one", async () => {
    getCurrentCart.mockResolvedValue({
      status: 200,
      body: { cart: { id: "cart-9", currency: "EGP" } },
    });
    await actions.addToCart("prod-1", 1, "var-1");
    expect(createCart).not.toHaveBeenCalled();
    expect(addCartItem).toHaveBeenCalledWith(
      "cart-9",
      expect.objectContaining({ productId: "prod-1" }),
    );
  });

  it("replaces a cart in another currency with a fresh one in the store currency, on a new session", async () => {
    cookieStore.set("morbeh-storefront-guest-session", "old-session");
    getCurrentCart.mockResolvedValue({
      status: 200,
      body: { cart: { id: "cart-usd", currency: "USD" } },
    });

    const result = await actions.addToCart("prod-1", 1, "var-1");

    expect(result).toEqual({ ok: true });
    const newSession = createCart.mock.calls[0]?.[0] as string;
    expect(newSession).not.toBe("old-session");
    expect(createCart).toHaveBeenCalledWith(newSession, "EGP");
    expect(addCartItem).toHaveBeenCalledWith(
      "cart-1",
      expect.objectContaining({ sessionRef: newSession, productId: "prod-1" }),
    );
    expect(cookieStore.get("morbeh-storefront-guest-session")).toBe(newSession);
  });
});
