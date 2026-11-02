import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";

const request = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: async () => "en",
  getPreviewToken: async () => request.token,
}));
const runtime = vi.hoisted(() => ({
  getCheckoutSession: vi.fn(),
  getPaymentMethods: vi.fn(async () => null),
  getShippableCountries: vi.fn(async () => null),
}));
vi.mock("@/lib/runtime-api", () => runtime);
const resolveCurrentCustomer = vi.hoisted(() =>
  vi.fn(async () => ({ status: "signed-out" as const })),
);
vi.mock("@/lib/customer-session", () => ({
  CUSTOMER_SESSION_COOKIE: "customer",
  resolveCurrentCustomer,
}));
vi.mock("@/lib/cart", () => ({
  CHECKOUT_SESSION_COOKIE: "checkout",
  GUEST_SESSION_COOKIE: "guest",
}));
vi.mock("@/components/checkout-view", () => ({ CheckoutView: () => null }));
const { default: CheckoutPage } = await import("./page");

afterEach(() => vi.clearAllMocks());

describe("CheckoutPage in preview (Ruling 15)", () => {
  it("says 'Not available in preview' and reads nothing", async () => {
    request.token = "tok";
    render(await CheckoutPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en.preview.unavailable);
    expect(runtime.getPaymentMethods).not.toHaveBeenCalled();
    expect(resolveCurrentCustomer).not.toHaveBeenCalled();
  });

  it("is the ordinary checkout page otherwise", async () => {
    request.token = null;
    render(await CheckoutPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      en.checkout.ownershipErrorTitle,
    );
    expect(runtime.getPaymentMethods).toHaveBeenCalledTimes(1);
  });
});
