import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import type { CheckoutSessionSummary } from "@/lib/runtime-api";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: (name: string) => ({ value: jar.get(name) }) }),
}));

const getCheckoutSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/runtime-api", () => ({ getCheckoutSession }));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/clear-checkout-session-cookie", () => ({
  ClearCheckoutSessionCookie: () => null,
}));

const { default: CheckoutConfirmationPage } = await import("./page");

function session(overrides: Partial<CheckoutSessionSummary> = {}): CheckoutSessionSummary {
  return {
    id: "checkout-1",
    status: "completed",
    currency: "EGP",
    items: [],
    totals: { subtotalMinor: 24000, shippingMinor: 500, taxMinor: 2400, grandTotalMinor: 26900 },
    shippingAddress: null,
    billingAddress: null,
    contactEmail: "guest@example.com",
    selectedShippingMethod: "standard",
    selectedPaymentMethod: "cod",
    orderRef: "order-1",
    ...overrides,
  };
}

async function renderPage(summary: CheckoutSessionSummary | null, locale?: string) {
  jar.clear();
  jar.set("morbeh-storefront-guest-session", "guest-1");
  jar.set("morbeh_checkout_session", "checkout-1");
  if (locale !== undefined) jar.set("morbeh-storefront-locale", locale);
  getCheckoutSession.mockResolvedValue(
    summary === null ? { status: 404, body: null } : { status: 200, body: summary },
  );
  render(await CheckoutConfirmationPage());
}

beforeEach(() => {
  getCheckoutSession.mockReset();
});

describe("checkout confirmation (Plan 3A)", () => {
  it("tells a cash-on-delivery shopper what they will pay on arrival", async () => {
    await renderPage(session());

    expect(screen.getByText(/in cash when your order arrives/)).toHaveTextContent(
      /^You'll pay .*269.* in cash when your order arrives\.$/,
    );
  });

  it("says nothing about cash for a card payment", async () => {
    await renderPage(session({ selectedPaymentMethod: "stripe" }));

    expect(screen.queryByText(/in cash when your order arrives/)).toBeNull();
  });

  it("says nothing about cash when the payment method is unknown", async () => {
    await renderPage(session({ selectedPaymentMethod: null }));

    expect(screen.queryByText(/in cash when your order arrives/)).toBeNull();
  });

  it("does not show a cash amount when the totals are missing", async () => {
    await renderPage(session({ totals: null }));

    expect(screen.queryByText(/in cash when your order arrives/)).toBeNull();
  });

  it("offers Continue shopping as a button to the home page", async () => {
    await renderPage(session());

    const link = screen.getByRole("link", { name: en.checkout.confirmation.continueShopping });
    expect(link).toHaveAttribute("href", "/");
  });

  it("still shows the nothing-to-confirm panel when there is no order", async () => {
    await renderPage(session({ orderRef: null }));

    expect(screen.getByText(en.checkout.confirmation.missingTitle)).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.confirmation.continueShopping)).toBeNull();
  });
});

describe("checkout confirmation messages", () => {
  it("has the cash notice and the button label in Arabic, with the amount placeholder", () => {
    expect(ar.checkout.confirmation.codNotice).toContain("{total}");
    expect(ar.checkout.confirmation.continueShopping).toBe("متابعة التسوق");
  });
});
