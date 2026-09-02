import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CheckoutSessionSummary,
  CurrentCartResponse,
  ShippingQuoteSummary,
} from "@/lib/runtime-api";

const getCurrentCart = vi.fn();
const startCheckoutApi = vi.fn();
const loadCheckoutItems = vi.fn();
const setCheckoutShippingAddress = vi.fn();
const setCheckoutBillingAddress = vi.fn();
const requestCheckoutShippingQuote = vi.fn();
const selectCheckoutShipping = vi.fn();
const requestCheckoutTax = vi.fn();
const selectCheckoutPayment = vi.fn();
const recalculateCheckoutApi = vi.fn();
const completeCheckoutApi = vi.fn();

vi.mock("@/lib/runtime-api", () => ({
  getCurrentCart: (...args: unknown[]) => getCurrentCart(...args),
  startCheckout: (...args: unknown[]) => startCheckoutApi(...args),
  loadCheckoutItems: (...args: unknown[]) => loadCheckoutItems(...args),
  setCheckoutShippingAddress: (...args: unknown[]) => setCheckoutShippingAddress(...args),
  setCheckoutBillingAddress: (...args: unknown[]) => setCheckoutBillingAddress(...args),
  requestCheckoutShippingQuote: (...args: unknown[]) => requestCheckoutShippingQuote(...args),
  selectCheckoutShipping: (...args: unknown[]) => selectCheckoutShipping(...args),
  requestCheckoutTax: (...args: unknown[]) => requestCheckoutTax(...args),
  selectCheckoutPayment: (...args: unknown[]) => selectCheckoutPayment(...args),
  recalculateCheckout: (...args: unknown[]) => recalculateCheckoutApi(...args),
  completeCheckout: (...args: unknown[]) => completeCheckoutApi(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

let cookieStore = new Map<string, string>();
const cookieSet = vi.fn((name: string, value: string) => {
  cookieStore.set(name, value);
});
const cookieDelete = vi.fn((name: string) => {
  cookieStore.delete(name);
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { value };
    },
    set: cookieSet,
    delete: cookieDelete,
  }),
}));

// Imported after the mocks above so the module under test picks them up.
const actions = await import("./actions");

function cartResponse(overrides: Partial<CurrentCartResponse["cart"]> = {}): {
  readonly status: number;
  readonly body: CurrentCartResponse;
} {
  return {
    status: 200,
    body: {
      cart: {
        id: "cart-1",
        status: "active",
        currency: "USD",
        isGuest: true,
        items: [],
        subtotalAmountMinor: 0,
        ...overrides,
      },
    },
  };
}

function session(overrides: Partial<CheckoutSessionSummary> = {}): CheckoutSessionSummary {
  return {
    id: "checkout-1",
    status: "started",
    currency: "USD",
    items: [],
    totals: null,
    shippingAddress: null,
    billingAddress: null,
    selectedShippingMethod: null,
    orderRef: null,
    ...overrides,
  };
}

const address = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };

beforeEach(() => {
  cookieStore = new Map();
  vi.clearAllMocks();
});

describe("startCheckout — session cookie handling", () => {
  it("never mints a session — a missing guest session cookie is an ownership error", async () => {
    const result = await actions.startCheckout("cart-1");

    expect(result).toEqual({ ok: false, reason: "ownership" });
    expect(getCurrentCart).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("starts a checkout session, loads items, and stores the checkout-session cookie on success", async () => {
    cookieStore.set("lumo-storefront-guest-session", "session-a");
    getCurrentCart.mockResolvedValue(cartResponse());
    startCheckoutApi.mockResolvedValue({ status: 201, body: session() });
    loadCheckoutItems.mockResolvedValue({ status: 200, body: session() });

    const result = await actions.startCheckout("cart-1");

    expect(result).toEqual({ ok: true, checkoutSessionId: "checkout-1" });
    expect(startCheckoutApi).toHaveBeenCalledWith("session-a", "cart-1", "USD");
    expect(loadCheckoutItems).toHaveBeenCalledWith("checkout-1", "session-a", "cart-1");
    expect(cookieSet).toHaveBeenCalledWith(
      "lumo_checkout_session",
      "checkout-1",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("a failure reading the current cart never calls startCheckout", async () => {
    cookieStore.set("lumo-storefront-guest-session", "session-a");
    getCurrentCart.mockResolvedValue({ status: 500, body: null });

    const result = await actions.startCheckout("cart-1");

    expect(result).toEqual({ ok: false, reason: "network" });
    expect(startCheckoutApi).not.toHaveBeenCalled();
  });
});

describe("status → reason mapping (shared by every mutating action)", () => {
  it.each([
    [404, "ownership"],
    [422, "validation"],
    [409, "unavailable"],
    [500, "network"],
    [0, "network"],
  ] as const)("status %i maps to reason %s", async (status, reason) => {
    cookieStore.set("lumo-storefront-guest-session", "session-a");
    setCheckoutShippingAddress.mockResolvedValue({ status, body: null });

    const result = await actions.setShippingAddress("checkout-1", address);

    expect(result).toEqual({ ok: false, reason });
  });

  it("a 2xx response maps to ok with the checkoutSessionId echoed back, and revalidates /checkout", async () => {
    cookieStore.set("lumo-storefront-guest-session", "session-a");
    setCheckoutShippingAddress.mockResolvedValue({ status: 200, body: session() });

    const result = await actions.setShippingAddress("checkout-1", address);

    expect(result).toEqual({ ok: true, checkoutSessionId: "checkout-1" });
    expect(revalidatePath).toHaveBeenCalledWith("/checkout");
  });
});

describe("every mutating action requires an existing guest session — none mints one", () => {
  it.each([
    ["setShippingAddress", () => actions.setShippingAddress("checkout-1", address)],
    ["setBillingAddress", () => actions.setBillingAddress("checkout-1", address)],
    ["requestShippingQuote", () => actions.requestShippingQuote("checkout-1")],
    ["selectShipping", () => actions.selectShipping("checkout-1", "standard")],
    ["requestTax", () => actions.requestTax("checkout-1")],
    ["selectPayment", () => actions.selectPayment("checkout-1", "pm_1", "stripe")],
    ["recalculate", () => actions.recalculate("checkout-1")],
    ["completeCheckout", () => actions.completeCheckout("checkout-1")],
  ] as const)("%s returns an ownership error with no guest session cookie", async (_name, call) => {
    const result = await call();

    expect(result).toEqual({ ok: false, reason: "ownership" });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe("requestShippingQuote — carries quotes on success", () => {
  it("returns the quoted methods on success", async () => {
    cookieStore.set("lumo-storefront-guest-session", "session-a");
    const quotes: readonly ShippingQuoteSummary[] = [
      { method: "standard", rateAmountMinor: 500 },
      { method: "express", rateAmountMinor: 1500 },
    ];
    requestCheckoutShippingQuote.mockResolvedValue({ status: 200, body: { quotes } });

    const result = await actions.requestShippingQuote("checkout-1");

    expect(result).toEqual({ ok: true, checkoutSessionId: "checkout-1", quotes });
  });
});

describe("completeCheckout", () => {
  it("generates a fresh idempotency key server-side and never clears the checkout-session cookie itself", async () => {
    cookieStore.set("lumo-storefront-guest-session", "session-a");
    cookieStore.set("lumo_checkout_session", "checkout-1");
    completeCheckoutApi.mockResolvedValue({ status: 200, body: session({ orderRef: "order-1" }) });

    const result = await actions.completeCheckout("checkout-1");

    expect(result).toEqual({ ok: true, checkoutSessionId: "checkout-1" });
    expect(completeCheckoutApi).toHaveBeenCalledWith(
      "checkout-1",
      "session-a",
      expect.any(String),
    );
    expect(cookieDelete).not.toHaveBeenCalled();
    expect(cookieStore.get("lumo_checkout_session")).toBe("checkout-1");
  });
});

describe("clearCheckoutSession", () => {
  it("deletes the checkout-session cookie", async () => {
    cookieStore.set("lumo_checkout_session", "checkout-1");

    await actions.clearCheckoutSession();

    expect(cookieDelete).toHaveBeenCalledWith("lumo_checkout_session");
  });
});
