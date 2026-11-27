import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentCart = vi.fn();
const addCartItem = vi.fn();
const changeCartItemQuantity = vi.fn();

vi.mock("@/lib/runtime-api", () => ({
  getCurrentCart: (...args: unknown[]) => getCurrentCart(...args),
  createCart: vi.fn(),
  addCartItem: (...args: unknown[]) => addCartItem(...args),
  getPublicStore: async () => ({ name: "Lumo", currency: "EGP" }),
  getInventory: async () => [],
  getPrices: async () => [],
  changeCartItemQuantity: (...args: unknown[]) => changeCartItemQuantity(...args),
  clearCart: vi.fn(),
  removeCartItem: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => ({ value: "guest-1" }),
    set: vi.fn(),
  }),
}));

const actions = await import("./actions");

const LIMIT_422 = {
  status: 422,
  body: {
    code: "VALIDATION",
    message: "Validation failed",
    retryable: false,
    fields: [{ field: "quantity", message: "You can add up to 3 of this item" }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentCart.mockResolvedValue({
    status: 200,
    body: { cart: { id: "cart-1", currency: "EGP" } },
  });
});

describe("the shop's add-to-cart limit", () => {
  it("changing a line above the limit says so with the server's sentence, and refreshes nothing", async () => {
    changeCartItemQuantity.mockResolvedValue(LIMIT_422);
    expect(await actions.changeQuantity("cart-1", "p1", 4)).toEqual({
      ok: false,
      reason: "limit",
      message: "You can add up to 3 of this item",
    });
  });

  it("adding past the limit is 'limit', not 'unavailable'", async () => {
    addCartItem.mockResolvedValue(LIMIT_422);
    expect(await actions.addToCart("p1", 1, undefined, true)).toEqual({
      ok: false,
      reason: "limit",
      message: "You can add up to 3 of this item",
    });
  });

  it("any other 422 stays as it was (unavailable on add, network on change)", async () => {
    addCartItem.mockResolvedValue({ status: 422, body: { code: "VALIDATION", fields: [] } });
    expect(await actions.addToCart("p1", 1, undefined, true)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    changeCartItemQuantity.mockResolvedValue({ status: 422, body: null });
    expect(await actions.changeQuantity("cart-1", "p1", 4)).toEqual({
      ok: false,
      reason: "network",
    });
  });
});
