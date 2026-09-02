import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerProfile } from "./runtime-api";

const getCustomerProfile =
  vi.fn<() => Promise<{ status: number; body: CustomerProfile | null }>>();

vi.mock("./runtime-api", () => ({
  getCustomerProfile: () => getCustomerProfile(),
}));

const {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_COOKIE_OPTIONS,
  CUSTOMER_SESSION_COOKIE_CLEARED,
  resolveCurrentCustomer,
} = await import("./customer-session");
const { GUEST_SESSION_COOKIE, CHECKOUT_SESSION_COOKIE } = await import("./cart");

beforeEach(() => {
  getCustomerProfile.mockReset();
});

const profile: CustomerProfile = {
  customerRef: "customer-1",
  email: "shopper@example.com",
  name: "Sam Shopper",
};

describe("CUSTOMER_SESSION_COOKIE", () => {
  it("is a THIRD cookie, distinct from the guest-cart and checkout cookies", () => {
    // T5.16 §2: reusing the cart-ownership token for identity would let a guessed/replayed cart
    // token read another customer's orders, wishlist and loyalty balance.
    expect(CUSTOMER_SESSION_COOKIE).toBe("lumo-storefront-customer-session");
    expect(CUSTOMER_SESSION_COOKIE).not.toBe(GUEST_SESSION_COOKIE);
    expect(CUSTOMER_SESSION_COOKIE).not.toBe(CHECKOUT_SESSION_COOKIE);
  });

  it("is HttpOnly and SameSite=lax so client JS can never read or forge it", () => {
    expect(CUSTOMER_SESSION_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(CUSTOMER_SESSION_COOKIE_OPTIONS.sameSite).toBe("lax");
    expect(CUSTOMER_SESSION_COOKIE_OPTIONS.path).toBe("/");
  });

  it("has a SHORT sliding window — an identity cookie, not the cart's 30 days", () => {
    expect(CUSTOMER_SESSION_COOKIE_OPTIONS.maxAge).toBe(60 * 60);
    // T5.16 §2's 30-120 minute recommendation, and far below the guest cart's 30 days.
    expect(CUSTOMER_SESSION_COOKIE_OPTIONS.maxAge).toBeLessThan(60 * 60 * 24);
  });

  it("expires immediately when cleared, keeping every other attribute identical", () => {
    expect(CUSTOMER_SESSION_COOKIE_CLEARED.maxAge).toBe(0);
    expect(CUSTOMER_SESSION_COOKIE_CLEARED.httpOnly).toBe(true);
    expect(CUSTOMER_SESSION_COOKIE_CLEARED.path).toBe(CUSTOMER_SESSION_COOKIE_OPTIONS.path);
  });
});

describe("resolveCurrentCustomer", () => {
  it("resolves a valid session to the profile the SERVER returned", async () => {
    getCustomerProfile.mockResolvedValue({ status: 200, body: profile });

    const result = await resolveCurrentCustomer("session-1");

    expect(result).toEqual({ status: "signed-in", customer: profile });
  });

  it("never calls the API when there is no cookie — a signed-out view costs no round trip", async () => {
    expect(await resolveCurrentCustomer(undefined)).toEqual({ status: "signed-out" });
    expect(await resolveCurrentCustomer("")).toEqual({ status: "signed-out" });
    expect(getCustomerProfile).not.toHaveBeenCalled();
  });

  it("treats a cookie the SERVER refused as signed out — presence is never proof", async () => {
    // A forged, expired or revoked cookie is indistinguishable from a valid one client-side; only
    // the 401 from `CustomerGuard` settles it.
    getCustomerProfile.mockResolvedValue({ status: 401, body: null });

    expect(await resolveCurrentCustomer("forged-or-revoked")).toEqual({ status: "signed-out" });
    expect(getCustomerProfile).toHaveBeenCalledTimes(1);
  });

  it("reports a transport failure as `error`, NOT as signed out", async () => {
    // Collapsing these would silently sign a customer out of the UI on any hiccup, and would render
    // "you have no data" for someone who simply could not be reached.
    getCustomerProfile.mockResolvedValue({ status: 0, body: null });
    expect(await resolveCurrentCustomer("session-1")).toEqual({ status: "error" });

    getCustomerProfile.mockResolvedValue({ status: 500, body: null });
    expect(await resolveCurrentCustomer("session-1")).toEqual({ status: "error" });
  });

  it("reports `error` for a 2xx with no body rather than inventing a customer", async () => {
    getCustomerProfile.mockResolvedValue({ status: 200, body: null });
    expect(await resolveCurrentCustomer("session-1")).toEqual({ status: "error" });
  });
});
