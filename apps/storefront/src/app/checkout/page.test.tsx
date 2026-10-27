import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    }),
}));
vi.mock("@/lib/runtime-api", () => ({
  getCheckoutSession: vi.fn().mockResolvedValue({ status: 200, body: { id: "cs-1" } }),
  getPaymentMethods: vi.fn().mockResolvedValue([]),
  getShippableCountries: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/customer-session", () => ({
  CUSTOMER_SESSION_COOKIE: "customer",
  resolveCurrentCustomer: vi.fn().mockResolvedValue({ status: "signed-out" }),
}));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/checkout-view", () => ({ CheckoutView: () => <div>checkout-view</div> }));

const { default: CheckoutPage } = await import("./page");
const { getCheckoutSession } = await import("@/lib/runtime-api");

beforeEach(() => {
  jar.clear();
  jar.set("morbeh-storefront-guest-session", "guest-1");
  jar.set("morbeh_checkout_session", "cs-1");
});

describe("/checkout after a recovery link (order operations Part 3)", () => {
  it("says some items are no longer available when the claim dropped lines", async () => {
    render(await CheckoutPage({ searchParams: Promise.resolve({ dropped: "1" }) }));
    expect(screen.getByRole("status")).toHaveTextContent(en.checkout.itemsDropped);
  });

  it("says nothing otherwise", async () => {
    render(await CheckoutPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText(en.checkout.itemsDropped)).toBeNull();
  });
});

describe("/checkout for an invoice (order operations Part 4)", () => {
  it("offers a way back to the cart on an ordinary checkout", async () => {
    render(await CheckoutPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: en.checkout.backToCart })).toHaveAttribute(
      "href",
      "/cart",
    );
  });

  it("has no 'Back to cart' on an invoice checkout — the cart is not involved", async () => {
    vi.mocked(getCheckoutSession).mockResolvedValueOnce({
      status: 200,
      body: { id: "cs-1", draftInvoice: { draftNumber: "D3" } } as never,
    });
    render(await CheckoutPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("checkout-view")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: en.checkout.backToCart })).toBeNull();
  });
});
