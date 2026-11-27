import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentCart = vi.fn();
const startCheckoutApi = vi.fn();
const loadCheckoutItems = vi.fn();
const setCheckoutContact = vi.fn();
const setCheckoutShippingAddress = vi.fn();
const completeCheckoutApi = vi.fn();

vi.mock("@/lib/runtime-api", () => ({
  getCurrentCart: (...args: unknown[]) => getCurrentCart(...args),
  startCheckout: (...args: unknown[]) => startCheckoutApi(...args),
  loadCheckoutItems: (...args: unknown[]) => loadCheckoutItems(...args),
  setCheckoutContact: (...args: unknown[]) => setCheckoutContact(...args),
  setCheckoutShippingAddress: (...args: unknown[]) => setCheckoutShippingAddress(...args),
  completeCheckout: (...args: unknown[]) => completeCheckoutApi(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string) => cookieStore.set(name, value),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

const actions = await import("./actions");
const { GUEST_SESSION_COOKIE } = await import("@/lib/cart");
const { CUSTOMER_SESSION_COOKIE } = await import("@/lib/customer-session");

const LOGIN_REQUIRED = {
  status: 403,
  body: { code: "LOGIN_REQUIRED", message: "Sign in to check out", retryable: false, fields: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore = new Map([[GUEST_SESSION_COOKIE, "guest-1"]]);
  getCurrentCart.mockResolvedValue({
    status: 200,
    body: { cart: { id: "cart-1", currency: "EGP" } },
  });
  startCheckoutApi.mockResolvedValue({ status: 201, body: { id: "cs-1" } });
  loadCheckoutItems.mockResolvedValue({ status: 200, body: { id: "cs-1" } });
  setCheckoutContact.mockResolvedValue({ status: 200, body: {} });
  setCheckoutShippingAddress.mockResolvedValue({ status: 200, body: {} });
  completeCheckoutApi.mockResolvedValue({ status: 200, body: {} });
});

describe("the customer's session reaches checkout create and complete (require login)", () => {
  it("startCheckout forwards the signed-in customer's session id", async () => {
    cookieStore.set(CUSTOMER_SESSION_COOKIE, "sess-1");
    expect(await actions.startCheckout("cart-1")).toEqual({ ok: true, checkoutSessionId: "cs-1" });
    expect(startCheckoutApi).toHaveBeenCalledWith("guest-1", "cart-1", "EGP", "sess-1");
  });

  it("a guest sends no customer session at all (the call is exactly today's)", async () => {
    await actions.startCheckout("cart-1");
    expect(startCheckoutApi).toHaveBeenCalledWith("guest-1", "cart-1", "EGP");
    await actions.completeCheckout("cs-1");
    expect(completeCheckoutApi).toHaveBeenCalledWith("cs-1", "guest-1", expect.any(String));
  });

  it("completeCheckout forwards it too", async () => {
    cookieStore.set(CUSTOMER_SESSION_COOKIE, "sess-1");
    await actions.completeCheckout("cs-1");
    expect(completeCheckoutApi).toHaveBeenCalledWith(
      "cs-1",
      "guest-1",
      expect.any(String),
      "sess-1",
    );
  });

  it("an empty customer cookie counts as a guest", async () => {
    cookieStore.set(CUSTOMER_SESSION_COOKIE, "");
    await actions.startCheckout("cart-1");
    expect(startCheckoutApi).toHaveBeenCalledWith("guest-1", "cart-1", "EGP");
  });

  it("403 LOGIN_REQUIRED on create / complete becomes 'login-required', not 'network'", async () => {
    startCheckoutApi.mockResolvedValue(LOGIN_REQUIRED);
    expect(await actions.startCheckout("cart-1")).toEqual({ ok: false, reason: "login-required" });
    expect(loadCheckoutItems).not.toHaveBeenCalled();
    completeCheckoutApi.mockResolvedValue(LOGIN_REQUIRED);
    expect(await actions.completeCheckout("cs-1")).toEqual({ ok: false, reason: "login-required" });
  });

  it("any other 403 stays a plain failure", async () => {
    completeCheckoutApi.mockResolvedValue({ status: 403, body: { code: "FORBIDDEN" } });
    expect(await actions.completeCheckout("cs-1")).toEqual({ ok: false, reason: "network" });
  });
});

describe("the marketing answer", () => {
  it("is sent with the contact step only when the caller passes it", async () => {
    await actions.setContactEmail("cs-1", "a@b.co");
    expect(setCheckoutContact).toHaveBeenLastCalledWith("cs-1", "guest-1", "a@b.co");
    await actions.setContactEmail("cs-1", "a@b.co", false);
    expect(setCheckoutContact).toHaveBeenLastCalledWith("cs-1", "guest-1", "a@b.co", false);
    await actions.setContactEmail("cs-1", "a@b.co", true);
    expect(setCheckoutContact).toHaveBeenLastCalledWith("cs-1", "guest-1", "a@b.co", true);
  });
});

describe("a 422 names the fields it refused", () => {
  const refused = (fields: unknown) => ({
    status: 422,
    body: { code: "VALIDATION", message: "x", retryable: false, fields },
  });

  it("the shipping address carries name / phone / line2 through", async () => {
    setCheckoutShippingAddress.mockResolvedValue(
      refused([
        { field: "name", message: "Name is required" },
        { field: "line2", message: "Address line 2 is required" },
      ]),
    );
    expect(await actions.setShippingAddress("cs-1", { line1: "x" } as never)).toEqual({
      ok: false,
      reason: "validation",
      fields: [
        { field: "name", message: "Name is required" },
        { field: "line2", message: "Address line 2 is required" },
      ],
    });
  });

  it("complete (the stale-settings re-check) carries them through", async () => {
    completeCheckoutApi.mockResolvedValue(
      refused([{ field: "phone", message: "Phone is required" }]),
    );
    expect(await actions.completeCheckout("cs-1")).toEqual({
      ok: false,
      reason: "validation",
      fields: [{ field: "phone", message: "Phone is required" }],
    });
  });

  it("checkout start with a line over the shop's limit says which field", async () => {
    loadCheckoutItems.mockResolvedValue(
      refused([{ field: "quantity", message: "You can add up to 3 of this item" }]),
    );
    expect(await actions.startCheckout("cart-1")).toEqual({
      ok: false,
      reason: "validation",
      fields: [{ field: "quantity", message: "You can add up to 3 of this item" }],
    });
  });

  it("an envelope with no usable fields is the plain validation failure, as before", async () => {
    setCheckoutShippingAddress.mockResolvedValue(refused([{ nope: 1 }, null, "x"]));
    expect(await actions.setShippingAddress("cs-1", { line1: "x" } as never)).toEqual({
      ok: false,
      reason: "validation",
    });
    setCheckoutShippingAddress.mockResolvedValue({ status: 422, body: null });
    expect(await actions.setShippingAddress("cs-1", { line1: "x" } as never)).toEqual({
      ok: false,
      reason: "validation",
    });
  });
});
