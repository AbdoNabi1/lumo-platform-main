import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import type { CheckoutSessionSummary } from "@/lib/runtime-api";
import type { CheckoutActionResult, ShippingQuoteActionResult } from "@/app/checkout/actions";
import { CheckoutView } from "./checkout-view";

const setContactEmail = vi.fn<(id: string, email: string) => Promise<CheckoutActionResult>>();
const setShippingAddress = vi.fn<(id: string, address: unknown) => Promise<CheckoutActionResult>>();
const requestShippingQuote = vi.fn<(id: string) => Promise<ShippingQuoteActionResult>>();
const selectShipping = vi.fn<(id: string, method: string) => Promise<CheckoutActionResult>>();
const setBillingAddress = vi.fn<(id: string, address: unknown) => Promise<CheckoutActionResult>>();
const selectPayment =
  vi.fn<(id: string, ref: string, provider: string) => Promise<CheckoutActionResult>>();
const recalculate = vi.fn<(id: string) => Promise<CheckoutActionResult>>();
const requestTax = vi.fn<(id: string) => Promise<CheckoutActionResult>>();
const completeCheckout = vi.fn<(id: string) => Promise<CheckoutActionResult>>();

vi.mock("@/app/checkout/actions", () => ({
  setContactEmail: (id: string, email: string) => setContactEmail(id, email),
  setShippingAddress: (id: string, address: unknown) => setShippingAddress(id, address),
  requestShippingQuote: (id: string) => requestShippingQuote(id),
  selectShipping: (id: string, method: string) => selectShipping(id, method),
  setBillingAddress: (id: string, address: unknown) => setBillingAddress(id, address),
  selectPayment: (id: string, ref: string, provider: string) => selectPayment(id, ref, provider),
  recalculate: (id: string) => recalculate(id),
  requestTax: (id: string) => requestTax(id),
  completeCheckout: (id: string) => completeCheckout(id),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  vi.clearAllMocks();
});

function session(overrides: Partial<CheckoutSessionSummary> = {}): CheckoutSessionSummary {
  return {
    id: "checkout-1",
    status: "started",
    currency: "USD",
    items: [{ productId: "p1", quantity: 1, unitPriceAmountMinor: 1000 }],
    totals: null,
    shippingAddress: null,
    billingAddress: null,
    // Most tests are about later steps, so the default session already has its contact email.
    contactEmail: "guest@example.com",
    selectedShippingMethod: null,
    orderRef: null,
    ...overrides,
  };
}

const address = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };

describe("CheckoutView — step derivation from the session (never skips a server-known step)", () => {
  it("starts at the shipping-address step for a fresh session", () => {
    render(<CheckoutView session={session()} t={en} locale="en" />);

    expect(screen.getByLabelText(en.checkout.address.line1)).toBeInTheDocument();
  });

  it("resumes at the shipping-method step when the session already has a shipping address but no quotes loaded yet", () => {
    render(<CheckoutView session={session({ shippingAddress: address })} t={en} locale="en" />);

    // No local quotes yet (a fresh mount never re-derives past what the session can prove), so it
    // falls back to asking for the address again rather than fabricating a quote list.
    expect(screen.getByLabelText(en.checkout.address.line1)).toBeInTheDocument();
  });

  it("resumes at the billing-address step when a shipping method is already selected", () => {
    render(
      <CheckoutView
        session={session({ shippingAddress: address, selectedShippingMethod: "standard" })}
        t={en}
        locale="en"
      />,
    );

    expect(screen.getByText(en.checkout.sameAsShipping)).toBeInTheDocument();
  });

  it("resumes at the payment step once billing address and shipping method are both set", () => {
    render(
      <CheckoutView
        session={session({
          shippingAddress: address,
          billingAddress: address,
          selectedShippingMethod: "standard",
        })}
        t={en}
        locale="en"
      />,
    );

    expect(screen.getByText(en.checkout.paymentCardOption)).toBeInTheDocument();
  });
});

describe("CheckoutView — contact step (WP-1, G-52)", () => {
  it("starts at the contact step when the session has no contact email — before any address", () => {
    render(<CheckoutView session={session({ contactEmail: null })} t={en} locale="en" />);

    expect(screen.getByLabelText(en.checkout.contact.label)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.checkout.address.line1)).not.toBeInTheDocument();
  });

  it("submits the email, and stays on the contact step with an alert when it is rejected", async () => {
    setContactEmail.mockResolvedValue({ ok: false, reason: "validation" });
    render(<CheckoutView session={session({ contactEmail: null })} t={en} locale="en" />);

    fireEvent.change(screen.getByLabelText(en.checkout.contact.label), {
      target: { value: "a@b" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.checkout.address.continue }));

    await waitFor(() => expect(setContactEmail).toHaveBeenCalledWith("checkout-1", "a@b"));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.checkout.validationErrorBody);
    expect(screen.getByLabelText(en.checkout.contact.label)).toBeInTheDocument();
  });

  it("a signed-in customer's account email is applied once, with no re-entry", async () => {
    setContactEmail.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    render(
      <CheckoutView
        session={session({ contactEmail: null })}
        t={en}
        locale="en"
        accountEmail="member@example.com"
      />,
    );

    await waitFor(() =>
      expect(setContactEmail).toHaveBeenCalledWith("checkout-1", "member@example.com"),
    );
    expect(setContactEmail).toHaveBeenCalledTimes(1);
  });

  it("falls back to a pre-filled field when applying the account email fails", async () => {
    setContactEmail.mockResolvedValue({ ok: false, reason: "network" });
    render(
      <CheckoutView
        session={session({ contactEmail: null })}
        t={en}
        locale="en"
        accountEmail="member@example.com"
      />,
    );

    await waitFor(() => expect(setContactEmail).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(en.checkout.contact.label)).toHaveValue("member@example.com");
  });

  it("does not re-apply anything once the session already has a contact email", () => {
    render(
      <CheckoutView session={session()} t={en} locale="en" accountEmail="member@example.com" />,
    );

    expect(setContactEmail).not.toHaveBeenCalled();
    expect(screen.getByLabelText(en.checkout.address.line1)).toBeInTheDocument();
  });
});

describe("CheckoutView — shipping address step", () => {
  it("submits the address then requests a shipping quote, advancing to the shipping-method step", async () => {
    setShippingAddress.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    requestShippingQuote.mockResolvedValue({
      ok: true,
      checkoutSessionId: "checkout-1",
      quotes: [{ method: "standard", rateAmountMinor: 500 }],
    });
    render(<CheckoutView session={session()} t={en} locale="en" />);

    fireEvent.change(screen.getByLabelText(en.checkout.address.line1), {
      target: { value: "1 Main St" },
    });
    fireEvent.change(screen.getByLabelText(en.checkout.address.city), {
      target: { value: "Springfield" },
    });
    fireEvent.change(screen.getByLabelText(en.checkout.address.postalCode), {
      target: { value: "00000" },
    });
    fireEvent.change(screen.getByLabelText(en.checkout.address.country), {
      target: { value: "US" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.checkout.address.continue }));

    await waitFor(() =>
      expect(setShippingAddress).toHaveBeenCalledWith(
        "checkout-1",
        expect.objectContaining({ line1: "1 Main St", city: "Springfield" }),
      ),
    );
    await waitFor(() => expect(requestShippingQuote).toHaveBeenCalledWith("checkout-1"));
    expect(await screen.findByText("standard")).toBeInTheDocument();
  });

  it("shows a validation error and stays on the address step when the address is rejected", async () => {
    setShippingAddress.mockResolvedValue({ ok: false, reason: "validation" });
    render(<CheckoutView session={session()} t={en} locale="en" />);

    fireEvent.change(screen.getByLabelText(en.checkout.address.line1), {
      target: { value: "1 Main St" },
    });
    fireEvent.change(screen.getByLabelText(en.checkout.address.city), {
      target: { value: "Springfield" },
    });
    fireEvent.change(screen.getByLabelText(en.checkout.address.postalCode), {
      target: { value: "00000" },
    });
    fireEvent.change(screen.getByLabelText(en.checkout.address.country), {
      target: { value: "US" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.checkout.address.continue }));

    expect(await screen.findByRole("alert")).toHaveTextContent(en.checkout.validationErrorBody);
    expect(requestShippingQuote).not.toHaveBeenCalled();
  });
});

describe("CheckoutView — an ownership failure renders the recoverable back-to-cart affordance, not a crash", () => {
  it("shows the ownership error message on a failed step", async () => {
    setShippingAddress.mockResolvedValue({ ok: false, reason: "ownership" });
    render(<CheckoutView session={session()} t={en} locale="en" />);

    fireEvent.change(screen.getByLabelText(en.checkout.address.line1), {
      target: { value: "1 Main St" },
    });
    fireEvent.change(screen.getByLabelText(en.checkout.address.city), {
      target: { value: "Springfield" },
    });
    fireEvent.change(screen.getByLabelText(en.checkout.address.postalCode), {
      target: { value: "00000" },
    });
    fireEvent.change(screen.getByLabelText(en.checkout.address.country), {
      target: { value: "US" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.checkout.address.continue }));

    expect(await screen.findByRole("alert")).toHaveTextContent(en.checkout.ownershipErrorBody);
  });
});

describe("CheckoutView — review step", () => {
  it("selecting payment advances to review, which recalculates and renders totals from the session", async () => {
    selectPayment.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    recalculate.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    render(
      <CheckoutView
        session={session({
          shippingAddress: address,
          billingAddress: address,
          selectedShippingMethod: "standard",
          totals: { subtotalMinor: 1000, shippingMinor: 500, taxMinor: 100, grandTotalMinor: 1600 },
        })}
        t={en}
        locale="en"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: en.checkout.paymentContinue }));

    await waitFor(() => expect(selectPayment).toHaveBeenCalledWith("checkout-1", "card", "stripe"));
    await waitFor(() => expect(recalculate).toHaveBeenCalledWith("checkout-1"));
    expect(
      await screen.findByRole("button", { name: en.checkout.review.placeOrder }),
    ).toBeInTheDocument();
    expect(screen.getByText("$16.00")).toBeInTheDocument();
  });

  it("placing the order requests tax, recalculates, completes, and navigates to confirmation", async () => {
    selectPayment.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    recalculate.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    requestTax.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    completeCheckout.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    render(
      <CheckoutView
        session={session({
          shippingAddress: address,
          billingAddress: address,
          selectedShippingMethod: "standard",
          totals: { subtotalMinor: 1000, shippingMinor: 500, taxMinor: 100, grandTotalMinor: 1600 },
        })}
        t={en}
        locale="en"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: en.checkout.paymentContinue }));
    await waitFor(() => expect(selectPayment).toHaveBeenCalled());
    const placeOrder = await screen.findByRole("button", { name: en.checkout.review.placeOrder });
    // Waits for the review-entry effect's own `recalculate` call (and its transition) to fully
    // settle before interacting further — clicking while that transition is still in flight is a
    // real race: `isPending` can briefly read `false` between the payment-selection transition
    // ending and this effect's own transition starting.
    await waitFor(() => expect(recalculate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(placeOrder).not.toBeDisabled());

    fireEvent.click(placeOrder);

    await waitFor(() => expect(requestTax).toHaveBeenCalledWith("checkout-1"));
    await waitFor(() => expect(recalculate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(completeCheckout).toHaveBeenCalledWith("checkout-1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/checkout/confirmation"));
  });
});
