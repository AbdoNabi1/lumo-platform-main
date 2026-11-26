import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";

const jar = new Map<string, string>();
const request = vi.hoisted(() => ({ token: null as string | null, locale: "en" as "en" | "ar" }));
vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: async () => request.locale,
  getPreviewToken: async () => request.token,
}));
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
  // Wave 2a: the page now reads the shop's checkout settings; the defaults are today's page.
  getPublicCheckoutSettings: vi.fn().mockResolvedValue({
    nameMode: "required",
    phoneMode: "required",
    line2Mode: "optional",
    marketingEmailPrompt: "hidden",
    cartLineLimit: null,
    requireLogin: false,
    accountsMode: "optional",
    showAccountLink: true,
  }),
}));
vi.mock("@/lib/customer-session", () => ({
  CUSTOMER_SESSION_COOKIE: "customer",
  resolveCurrentCustomer: vi.fn().mockResolvedValue({ status: "signed-out" }),
}));
vi.mock("@/components/checkout-view", () => ({ CheckoutView: () => <div>checkout-view</div> }));

const { default: CheckoutPage } = await import("./page");
const { getCheckoutSession, getPaymentMethods } = await import("@/lib/runtime-api");
const { resolveCurrentCustomer } = await import("@/lib/customer-session");

beforeEach(() => {
  request.token = null;
  request.locale = "en";
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

describe("/checkout when an invoice's checkout was taken over (task 10 review M4)", () => {
  const lost = () =>
    vi.mocked(getCheckoutSession).mockResolvedValueOnce({ status: 404, body: null } as never);

  it("tells the invoice shopper to open their link again — never to start from a cart", async () => {
    jar.set("morbeh_invoice_checkout", "cs-1");
    lost();
    render(await CheckoutPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole("heading", { name: en.checkout.invoiceOwnershipErrorTitle }),
    ).toBeInTheDocument();
    expect(screen.getByText(en.checkout.invoiceOwnershipErrorBody)).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.ownershipErrorBody)).toBeNull();
    expect(screen.queryByRole("link", { name: en.checkout.backToCart })).toBeNull();
    expect(screen.getByRole("link", { name: en.recovery.backToShop })).toHaveAttribute("href", "/");
  });

  it("an ordinary checkout started since keeps the cart wording", async () => {
    jar.set("morbeh_invoice_checkout", "cs-old-invoice");
    lost();
    render(await CheckoutPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole("heading", { name: en.checkout.ownershipErrorTitle }),
    ).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.invoiceOwnershipErrorBody)).toBeNull();
  });

  it("speaks Modern Standard Arabic", async () => {
    request.locale = "ar";
    jar.set("morbeh_invoice_checkout", "cs-1");
    lost();
    render(await CheckoutPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole("heading", { name: "تم فتح هذه الفاتورة في مكان آخر" }),
    ).toBeInTheDocument();
  });
});

describe("CheckoutPage in preview (Ruling 15)", () => {
  it("says 'Not available in preview' and reads nothing", async () => {
    vi.mocked(getPaymentMethods).mockClear();
    vi.mocked(resolveCurrentCustomer).mockClear();
    request.token = "tok";
    render(await CheckoutPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en.preview.unavailable);
    expect(getPaymentMethods).not.toHaveBeenCalled();
    expect(resolveCurrentCustomer).not.toHaveBeenCalled();
  });

  it("is the ordinary checkout page otherwise", async () => {
    vi.mocked(getPaymentMethods).mockClear();
    jar.clear();
    request.token = null;
    render(await CheckoutPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      en.checkout.ownershipErrorTitle,
    );
    expect(getPaymentMethods).toHaveBeenCalledTimes(1);
  });
});
