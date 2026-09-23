import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import type { CheckoutSessionSummary } from "@/lib/runtime-api";
import type {
  CheckoutActionResult,
  PaymentInitiationResult,
  ShippingQuoteActionResult,
} from "@/app/checkout/actions";
import { ar } from "@/messages/ar";
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
const initiatePayment = vi.fn<(id: string) => Promise<PaymentInitiationResult>>();

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
  initiatePayment: (id: string) => initiatePayment(id),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
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

const METHODS = ["stripe", "cod"] as const;
const address = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };

describe("CheckoutView — step derivation from the session (never skips a server-known step)", () => {
  it("starts at the shipping-address step for a fresh session", () => {
    render(<CheckoutView session={session()} t={en} locale="en" paymentMethods={METHODS} />);

    expect(screen.getByLabelText(en.checkout.address.line1)).toBeInTheDocument();
  });

  it("resumes at the shipping-method step when the session already has a shipping address but no quotes loaded yet", () => {
    render(
      <CheckoutView
        session={session({ shippingAddress: address })}
        t={en}
        locale="en"
        paymentMethods={METHODS}
      />,
    );

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
        paymentMethods={METHODS}
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
        paymentMethods={METHODS}
      />,
    );

    expect(screen.getByRole("radio", { name: en.checkout.paymentMethod.cod })).toBeInTheDocument();
  });
});

describe("CheckoutView — contact step (WP-1, G-52)", () => {
  it("starts at the contact step when the session has no contact email — before any address", () => {
    render(
      <CheckoutView
        session={session({ contactEmail: null })}
        t={en}
        locale="en"
        paymentMethods={METHODS}
      />,
    );

    expect(screen.getByLabelText(en.checkout.contact.label)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.checkout.address.line1)).not.toBeInTheDocument();
  });

  it("submits the email, and stays on the contact step with an alert when it is rejected", async () => {
    setContactEmail.mockResolvedValue({ ok: false, reason: "validation" });
    render(
      <CheckoutView
        session={session({ contactEmail: null })}
        t={en}
        locale="en"
        paymentMethods={METHODS}
      />,
    );

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
        paymentMethods={METHODS}
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
        paymentMethods={METHODS}
      />,
    );

    await waitFor(() => expect(setContactEmail).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(en.checkout.contact.label)).toHaveValue("member@example.com");
  });

  it("does not re-apply anything once the session already has a contact email", () => {
    render(
      <CheckoutView
        session={session()}
        t={en}
        locale="en"
        accountEmail="member@example.com"
        paymentMethods={METHODS}
      />,
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
    render(<CheckoutView session={session()} t={en} locale="en" paymentMethods={METHODS} />);

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
    render(<CheckoutView session={session()} t={en} locale="en" paymentMethods={METHODS} />);

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
    render(<CheckoutView session={session()} t={en} locale="en" paymentMethods={METHODS} />);

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
        paymentMethods={METHODS}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: en.checkout.paymentMethod.stripe }));
    fireEvent.click(screen.getByRole("button", { name: en.checkout.paymentContinue }));

    await waitFor(() =>
      expect(selectPayment).toHaveBeenCalledWith("checkout-1", "stripe", "stripe"),
    );
    await waitFor(() => expect(recalculate).toHaveBeenCalledWith("checkout-1"));
    expect(
      await screen.findByRole("button", { name: en.checkout.review.placeOrder }),
    ).toBeInTheDocument();
    expect(screen.getByText("$16.00")).toBeInTheDocument();
  });

  it("placing the order requests tax, recalculates, completes, opens the payment, and navigates to confirmation", async () => {
    selectPayment.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    recalculate.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    requestTax.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    completeCheckout.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    initiatePayment.mockResolvedValue({ ok: true, next: "confirmation" });
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
        paymentMethods={METHODS}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: en.checkout.paymentMethod.cod }));
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

const PAYMENT_READY = () =>
  session({
    shippingAddress: address,
    billingAddress: address,
    selectedShippingMethod: "standard",
    totals: { subtotalMinor: 1000, shippingMinor: 500, taxMinor: 100, grandTotalMinor: 1600 },
  });

/** Walks a payment-ready session through choosing `label` and reaching a settled review step. */
async function reachReview(label: string, paymentMethods: readonly string[]) {
  selectPayment.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
  recalculate.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
  requestTax.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
  completeCheckout.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
  render(
    <CheckoutView session={PAYMENT_READY()} t={en} locale="en" paymentMethods={paymentMethods} />,
  );
  fireEvent.click(screen.getByRole("radio", { name: label }));
  fireEvent.click(screen.getByRole("button", { name: en.checkout.paymentContinue }));
  const placeOrder = await screen.findByRole("button", { name: en.checkout.review.placeOrder });
  await waitFor(() => expect(recalculate).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(placeOrder).not.toBeDisabled());
  return placeOrder;
}

describe("CheckoutView — payment step renders the merchant's real methods (WP-13 T13.6)", () => {
  it("offers exactly the methods the API returned — no invented card option when only COD is enabled", () => {
    render(<CheckoutView session={PAYMENT_READY()} t={en} locale="en" paymentMethods={["cod"]} />);

    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: en.checkout.paymentMethod.cod })).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.paymentMethod.stripe)).not.toBeInTheDocument();
  });

  it("preselects nothing and cannot continue until the shopper chooses (no client-side default)", () => {
    render(
      <CheckoutView
        session={PAYMENT_READY()}
        t={en}
        locale="en"
        paymentMethods={["stripe", "paymob"]}
      />,
    );

    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(screen.getByRole("button", { name: en.checkout.paymentContinue })).toBeDisabled();
  });

  it("the shopper's click selects THAT method — the second in the list sends its provider, not the first and not stripe", async () => {
    selectPayment.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    recalculate.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    render(
      <CheckoutView
        session={PAYMENT_READY()}
        t={en}
        locale="en"
        paymentMethods={["stripe", "paymob", "cod"]}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: en.checkout.paymentMethod.paymob }));
    fireEvent.click(screen.getByRole("button", { name: en.checkout.paymentContinue }));

    await waitFor(() => expect(selectPayment).toHaveBeenCalledTimes(1));
    expect(selectPayment).toHaveBeenCalledWith("checkout-1", "paymob", "paymob");
  });

  it("fails closed with a clear message — and no way to advance — when the merchant enabled nothing", () => {
    render(<CheckoutView session={PAYMENT_READY()} t={en} locale="en" paymentMethods={[]} />);

    expect(screen.getByRole("alert")).toHaveTextContent(en.checkout.paymentNoMethods);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en.checkout.paymentContinue })).toBeNull();
  });

  it("fails closed with a distinct message when the method list could not be loaded", () => {
    render(<CheckoutView session={PAYMENT_READY()} t={en} locale="en" paymentMethods={null} />);

    expect(screen.getByRole("alert")).toHaveTextContent(en.checkout.paymentMethodsUnavailable);
    expect(screen.queryByRole("button", { name: en.checkout.paymentContinue })).toBeNull();
  });

  it("renders an unknown provider key as-is (API data is never translated or dropped)", () => {
    render(
      <CheckoutView
        session={PAYMENT_READY()}
        t={en}
        locale="en"
        paymentMethods={["mystery-pay"]}
      />,
    );

    expect(screen.getByRole("radio", { name: "mystery-pay" })).toBeInTheDocument();
  });

  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)("renders every method label and the empty state in %s", (locale, dictionary) => {
    const { unmount } = render(
      <CheckoutView
        session={PAYMENT_READY()}
        t={dictionary}
        locale={locale}
        paymentMethods={["stripe", "paymob", "cod"]}
      />,
    );
    for (const key of ["stripe", "paymob", "cod"] as const) {
      expect(
        screen.getByRole("radio", { name: dictionary.checkout.paymentMethod[key] }),
      ).toBeInTheDocument();
    }
    unmount();

    render(
      <CheckoutView session={PAYMENT_READY()} t={dictionary} locale={locale} paymentMethods={[]} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(dictionary.checkout.paymentNoMethods);
  });
});

describe("CheckoutView — after the order is placed, COD and a hosted checkout diverge explicitly", () => {
  it("initiates payment only AFTER completing the checkout", async () => {
    initiatePayment.mockResolvedValue({ ok: true, next: "confirmation" });
    const placeOrder = await reachReview(en.checkout.paymentMethod.cod, ["cod"]);

    fireEvent.click(placeOrder);

    await waitFor(() => expect(initiatePayment).toHaveBeenCalledWith("checkout-1"));
    expect(completeCheckout.mock.invocationCallOrder[0]).toBeLessThan(
      initiatePayment.mock.invocationCallOrder[0]!,
    );
  });

  it("cash on delivery lands on the confirmation page and never leaves the site", async () => {
    initiatePayment.mockResolvedValue({ ok: true, next: "confirmation" });
    const placeOrder = await reachReview(en.checkout.paymentMethod.cod, ["cod"]);

    fireEvent.click(placeOrder);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/checkout/confirmation"));
    expect(assign).not.toHaveBeenCalled();
  });

  it("a hosted-checkout method sends the shopper to the returned handle, not to confirmation", async () => {
    initiatePayment.mockResolvedValue({
      ok: true,
      next: "redirect",
      url: "https://accept.paymob.example/pay?token=t1",
    });
    const placeOrder = await reachReview(en.checkout.paymentMethod.paymob, ["paymob"]);

    fireEvent.click(placeOrder);

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://accept.paymob.example/pay?token=t1"),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("shows an alert — and goes nowhere — when a redirect was required but there is no usable handle", async () => {
    initiatePayment.mockResolvedValue({ ok: false, reason: "handoff" });
    const placeOrder = await reachReview(en.checkout.paymentMethod.paymob, ["paymob"]);

    fireEvent.click(placeOrder);

    expect(await screen.findByRole("alert")).toHaveTextContent(en.checkout.paymentHandoffError);
    expect(push).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("a failed initiation shows the order-placed error, and the retry step never completes the order again", async () => {
    initiatePayment.mockResolvedValue({ ok: false, reason: "network" });
    const placeOrder = await reachReview(en.checkout.paymentMethod.cod, ["cod"]);
    fireEvent.click(placeOrder);
    expect(await screen.findByRole("alert")).toHaveTextContent(en.checkout.paymentOpenError);
    completeCheckout.mockClear();
    cleanup();

    // The completed session now carries an orderRef (revalidate re-renders the page with it), so a
    // reload lands on the retry step, which only opens the payment.
    initiatePayment.mockResolvedValue({ ok: true, next: "confirmation" });
    render(
      <CheckoutView
        session={{ ...PAYMENT_READY(), orderRef: "order-1" }}
        t={en}
        locale="en"
        paymentMethods={["cod"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: en.checkout.paymentPayNow }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/checkout/confirmation"));
    expect(completeCheckout).not.toHaveBeenCalled();
  });

  it("an already-completed session resumes at 'pay now', never back at method selection", () => {
    render(
      <CheckoutView
        session={{ ...PAYMENT_READY(), orderRef: "order-1" }}
        t={en}
        locale="en"
        paymentMethods={["cod", "stripe"]}
      />,
    );

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.checkout.paymentPayNow })).toBeInTheDocument();
  });
});
