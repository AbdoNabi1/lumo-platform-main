import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import type { CheckoutSessionSummary } from "@/lib/runtime-api";
import type {
  CheckoutActionResult,
  PaymentInitiationResult,
  ShippingQuoteActionResult,
} from "@/app/checkout/actions";
import { CheckoutView } from "./checkout-view";

/** Every action call, in order, so a test can assert the exact sequence a submit runs. */
const calls: string[] = [];

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
/** jsdom has no layout, so no `scrollIntoView`; browsers always do. */
const scrollIntoView = vi.fn();

const OK: CheckoutActionResult = { ok: true, checkoutSessionId: "checkout-1" };
const QUOTES = [
  { method: "standard", rateAmountMinor: 500 },
  { method: "express", rateAmountMinor: 1500 },
];

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
  for (const [name, mock] of Object.entries({
    setContactEmail,
    setShippingAddress,
    selectShipping,
    setBillingAddress,
    selectPayment,
    recalculate,
    requestTax,
    completeCheckout,
  })) {
    mock.mockImplementation(async () => {
      calls.push(name);
      return OK;
    });
  }
  requestShippingQuote.mockImplementation(async () => {
    calls.push("requestShippingQuote");
    return { ok: true, checkoutSessionId: "checkout-1", quotes: QUOTES };
  });
  initiatePayment.mockImplementation(async () => {
    calls.push("initiatePayment");
    return { ok: true, next: "confirmation" };
  });
});

function session(overrides: Partial<CheckoutSessionSummary> = {}): CheckoutSessionSummary {
  return {
    id: "checkout-1",
    status: "started",
    currency: "EGP",
    items: [
      {
        productId: "p1",
        title: "Linen Shirt",
        variantTitle: "L",
        quantity: 2,
        unitPriceAmountMinor: 12000,
      },
    ],
    totals: null,
    shippingAddress: null,
    billingAddress: null,
    contactEmail: null,
    selectedShippingMethod: null,
    orderRef: null,
    ...overrides,
  };
}

const METHODS = ["cod", "stripe"] as const;
const saved = {
  name: "Mona Ali",
  phone: "01012345678",
  line1: "1 Main St",
  city: "Cairo",
  postalCode: "",
  country: "EG",
};

function renderView(
  props: {
    session?: CheckoutSessionSummary;
    paymentMethods?: readonly string[] | null;
    accountEmail?: string | null;
  } = {},
) {
  return render(
    <CheckoutView
      session={props.session ?? session()}
      t={en}
      locale="en"
      accountEmail={props.accountEmail ?? null}
      paymentMethods={props.paymentMethods === undefined ? METHODS : props.paymentMethods}
    />,
  );
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /Complete order|Pay now/ });

function type(label: string, value: string): void {
  fireEvent.change(field(label), { target: { value } });
}

/** Fills the contact and delivery sections with a complete, valid address. */
function fillEverything(overrides: Record<string, string> = {}): void {
  const values = {
    email: "guest@example.com",
    name: "Mona Ali",
    line1: "1 Main St",
    city: "Cairo",
    phone: "٠١٠ ١٢٣٤ ٥٦٧٨",
    ...overrides,
  };
  type(en.checkout.contact.label, values.email);
  type(en.checkout.address.name, values.name);
  type(en.checkout.address.line1, values.line1);
  type(en.checkout.address.city, values.city);
  type(en.checkout.address.phone, values.phone);
}

describe("CheckoutView — one page (Plan 3A)", () => {
  it("renders contact, delivery, shipping method, payment and billing on one page, with no stepper", () => {
    renderView();

    for (const heading of [
      en.checkout.sections.contact,
      en.checkout.sections.delivery,
      en.checkout.sections.shippingMethod,
      en.checkout.sections.payment,
      en.checkout.sections.billing,
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
    }
    expect(document.querySelectorAll("form")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Complete order|Pay now/ })).toHaveLength(1);
  });

  it("labels the delivery fields, with the postal code optional and the phone required", () => {
    renderView();

    expect(field(en.checkout.address.country).tagName).toBe("SELECT");
    expect(field(en.checkout.address.country).value).toBe("EG");
    expect(field(en.checkout.address.name)).toBeRequired();
    expect(field(en.checkout.address.line1)).toBeRequired();
    expect(field(en.checkout.address.city)).toBeRequired();
    expect(field(en.checkout.address.postalCode)).not.toBeRequired();
    const phone = field(en.checkout.address.phone);
    expect(phone).toBeRequired();
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("dir", "ltr");
    expect(screen.getByText(en.checkout.address.phoneHint)).toBeInTheDocument();
  });

  it("offers the twenty countries, named in the page's language", () => {
    renderView();

    const options = within(field(en.checkout.address.country)).getAllByRole("option");
    expect(options.map((option) => option.getAttribute("value"))).toEqual(
      expect.arrayContaining(["EG", "SA", "AE", "US", "GB", "CA", "DZ"]),
    );
    expect(screen.getByRole("option", { name: en.checkout.countries.EG })).toBeInTheDocument();
  });
});

describe("CheckoutView — contact", () => {
  it("asks for an email when the shopper is not signed in", () => {
    renderView();

    expect(field(en.checkout.contact.label)).toHaveAttribute("type", "email");
    expect(field(en.checkout.contact.label)).toBeRequired();
  });

  it("shows a signed-in customer's email as text with no field, and applies it once", async () => {
    renderView({ accountEmail: "me@example.com" });

    expect(screen.getByText(`${en.checkout.signedInAs} me@example.com`)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.checkout.contact.label)).not.toBeInTheDocument();
    await waitFor(() => expect(setContactEmail).toHaveBeenCalledTimes(1));
    expect(setContactEmail).toHaveBeenCalledWith("checkout-1", "me@example.com");
  });

  it("does not re-apply the account email when the session already has it", () => {
    renderView({
      accountEmail: "me@example.com",
      session: session({ contactEmail: "me@example.com" }),
    });

    expect(setContactEmail).not.toHaveBeenCalled();
  });
});

describe("CheckoutView — shipping methods follow a complete address", () => {
  it("shows a hint, and no methods, until the address is complete", () => {
    renderView();

    expect(screen.getByText(en.checkout.shippingMethodHint)).toBeInTheDocument();
    expect(
      screen.queryByRole("radio", { name: new RegExp(en.checkout.shippingMethodLabel.standard) }),
    ).not.toBeInTheDocument();
    expect(setShippingAddress).not.toHaveBeenCalled();
  });

  it("saves the address, quotes it and pre-selects the first method once it is complete", async () => {
    renderView();
    fillEverything();

    fireEvent.blur(field(en.checkout.address.phone));

    const standard = await screen.findByRole(
      "radio",
      { name: new RegExp(en.checkout.shippingMethodLabel.standard) },
      { timeout: 3000 },
    );
    expect(standard).toBeChecked();
    expect(
      screen.getByRole("radio", { name: new RegExp(en.checkout.shippingMethodLabel.express) }),
    ).not.toBeChecked();
    expect(setShippingAddress).toHaveBeenCalledWith("checkout-1", {
      name: "Mona Ali",
      phone: "01012345678",
      line1: "1 Main St",
      line2: "",
      city: "Cairo",
      postalCode: "",
      country: "EG",
    });
    expect(selectShipping).toHaveBeenCalledTimes(1);
    expect(selectShipping).toHaveBeenCalledWith("checkout-1", "standard");
    expect(recalculate).toHaveBeenCalled();
    expect(screen.queryByText(en.checkout.shippingMethodHint)).not.toBeInTheDocument();
  });

  it("does not save while the address is incomplete or the phone is invalid", async () => {
    renderView();
    fillEverything({ phone: "12ab" });

    fireEvent.blur(field(en.checkout.address.phone));
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(setShippingAddress).not.toHaveBeenCalled();
  });

  it("selecting another method selects it and recalculates", async () => {
    renderView();
    fillEverything();
    fireEvent.blur(field(en.checkout.address.phone));
    const express = await screen.findByRole(
      "radio",
      { name: new RegExp(en.checkout.shippingMethodLabel.express) },
      { timeout: 3000 },
    );
    selectShipping.mockClear();
    recalculate.mockClear();

    fireEvent.click(express);

    await waitFor(() => expect(selectShipping).toHaveBeenCalledWith("checkout-1", "express"));
    await waitFor(() => expect(recalculate).toHaveBeenCalled());
  });

  it("resumes with the methods listed when the session already holds a complete address", async () => {
    renderView({
      session: session({
        contactEmail: "guest@example.com",
        shippingAddress: saved,
        selectedShippingMethod: "standard",
      }),
    });

    expect(
      await screen.findByRole("radio", {
        name: new RegExp(en.checkout.shippingMethodLabel.standard),
      }),
    ).toBeChecked();
    expect(setShippingAddress).not.toHaveBeenCalled();
    expect(selectShipping).not.toHaveBeenCalled();
  });
});

describe("CheckoutView — pre-filling from the session", () => {
  it("fills every field from what the server already holds", () => {
    renderView({
      session: session({
        contactEmail: "guest@example.com",
        shippingAddress: { ...saved, line2: "Flat 4", postalCode: "11511" },
      }),
    });

    expect(field(en.checkout.contact.label).value).toBe("guest@example.com");
    expect(field(en.checkout.address.name).value).toBe("Mona Ali");
    expect(field(en.checkout.address.phone).value).toBe("01012345678");
    expect(field(en.checkout.address.line1).value).toBe("1 Main St");
    expect(field(en.checkout.address.line2).value).toBe("Flat 4");
    expect(field(en.checkout.address.postalCode).value).toBe("11511");
  });

  it("pre-selects nothing for a free-text country the list does not hold, and requires a choice", () => {
    renderView({ session: session({ shippingAddress: { ...saved, country: "Egypt" } }) });

    expect(field(en.checkout.address.country).value).toBe("");
    expect(field(en.checkout.address.country)).toBeRequired();
  });
});

describe("CheckoutView — payment methods", () => {
  it("offers exactly the merchant's methods in API order, the first pre-selected", () => {
    renderView({ paymentMethods: ["cod", "stripe"] });

    const radios = screen.getAllByRole("radio", { name: /Cash on delivery|Card/ });
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
    expect(screen.getByText(en.checkout.paymentSecure)).toBeInTheDocument();
  });

  it("describes the selected method", () => {
    renderView({ paymentMethods: ["cod", "stripe"] });
    expect(screen.getByText(en.checkout.paymentDescription.offline)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: en.checkout.paymentMethod.stripe }));

    expect(screen.getByText(en.checkout.paymentDescription.online)).toBeInTheDocument();
  });

  it("shows no invented card option when only cash on delivery is enabled", () => {
    renderView({ paymentMethods: ["cod"] });

    expect(screen.getAllByRole("radio", { name: /Cash on delivery/ })).toHaveLength(1);
    expect(screen.queryByRole("radio", { name: en.checkout.paymentMethod.stripe })).toBeNull();
  });

  it("renders an unknown provider key as-is", () => {
    renderView({ paymentMethods: ["fawry"] });

    expect(screen.getByRole("radio", { name: "fawry" })).toBeInTheDocument();
  });

  it("fails closed, with the submit disabled, when the merchant enabled nothing", () => {
    renderView({ paymentMethods: [] });

    expect(screen.getByRole("alert")).toHaveTextContent(en.checkout.paymentNoMethods);
    expect(submit()).toBeDisabled();
  });

  it("fails closed with a distinct message when the list could not be loaded", () => {
    renderView({ paymentMethods: null });

    expect(screen.getByRole("alert")).toHaveTextContent(en.checkout.paymentMethodsUnavailable);
    expect(submit()).toBeDisabled();
  });

  it("labels the button Complete order for cash on delivery and Pay now for a card", () => {
    renderView({ paymentMethods: ["cod", "stripe"] });
    expect(screen.getByRole("button", { name: en.checkout.completeOrder })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: en.checkout.paymentMethod.stripe }));

    expect(screen.getByRole("button", { name: en.checkout.paymentPayNow })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en.checkout.completeOrder })).toBeNull();
  });
});

describe("CheckoutView — billing address", () => {
  it("defaults to the shipping address, with no extra fields", () => {
    renderView();

    expect(screen.getByRole("radio", { name: en.checkout.sameAsShipping })).toBeChecked();
    expect(screen.getAllByLabelText(en.checkout.address.line1)).toHaveLength(1);
  });

  it("reveals a second set of fields, with the phone optional, for a different billing address", () => {
    renderView();

    fireEvent.click(screen.getByRole("radio", { name: en.checkout.differentBilling }));

    expect(screen.getAllByLabelText(en.checkout.address.line1)).toHaveLength(2);
    expect(screen.getByLabelText(en.checkout.address.phoneOptional)).not.toBeRequired();
  });
});

describe("CheckoutView — Complete order runs everything in order", () => {
  it("sets contact, shipping, billing, payment, tax, totals, completes, then opens the payment", async () => {
    renderView();
    fillEverything();

    fireEvent.click(submit());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/checkout/confirmation"));
    const first = (name: string) => calls.indexOf(name);
    expect(first("setContactEmail")).toBeLessThan(first("setShippingAddress"));
    expect(first("setShippingAddress")).toBeLessThan(first("requestShippingQuote"));
    expect(first("requestShippingQuote")).toBeLessThan(first("selectShipping"));
    expect(calls.slice(-6)).toEqual([
      "setBillingAddress",
      "selectPayment",
      "requestTax",
      "recalculate",
      "completeCheckout",
      "initiatePayment",
    ]);
    expect(setContactEmail).toHaveBeenCalledWith("checkout-1", "guest@example.com");
    expect(selectPayment).toHaveBeenCalledWith("checkout-1", "cod", "cod");
  });

  it("normalizes the phone before sending, and sends the shipping address as billing when it is the same", async () => {
    renderView();
    fillEverything();

    fireEvent.click(submit());

    await waitFor(() => expect(setBillingAddress).toHaveBeenCalled());
    const sent = setShippingAddress.mock.calls[0]?.[1];
    expect(sent).toMatchObject({ phone: "01012345678" });
    expect(setBillingAddress.mock.calls[0]?.[1]).toEqual(sent);
  });

  it("sends the separate billing address when one is chosen", async () => {
    renderView();
    fillEverything();
    fireEvent.click(screen.getByRole("radio", { name: en.checkout.differentBilling }));
    const [, billingLine1] = screen.getAllByLabelText(en.checkout.address.line1);
    const [, billingCity] = screen.getAllByLabelText(en.checkout.address.city);
    fireEvent.change(billingLine1 as HTMLInputElement, { target: { value: "9 Bill St" } });
    fireEvent.change(billingCity as HTMLInputElement, { target: { value: "Giza" } });

    fireEvent.click(submit());

    await waitFor(() => expect(setBillingAddress).toHaveBeenCalled());
    expect(setBillingAddress.mock.calls[0]?.[1]).toMatchObject({
      line1: "9 Bill St",
      city: "Giza",
    });
  });

  it("does not repeat the contact or address calls the page already made", async () => {
    renderView({
      session: session({
        contactEmail: "guest@example.com",
        shippingAddress: saved,
        selectedShippingMethod: "standard",
      }),
    });
    await screen.findByRole("radio", {
      name: new RegExp(en.checkout.shippingMethodLabel.standard),
    });

    fireEvent.click(submit());

    await waitFor(() => expect(initiatePayment).toHaveBeenCalled());
    expect(setContactEmail).not.toHaveBeenCalled();
    expect(setShippingAddress).not.toHaveBeenCalled();
  });

  it("stops at the first failure: a billing failure calls neither selectPayment nor completeCheckout", async () => {
    setBillingAddress.mockResolvedValue({ ok: false, reason: "validation" });
    renderView();
    fillEverything();

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(en.checkout.validationErrorBody);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(selectPayment).not.toHaveBeenCalled();
    expect(completeCheckout).not.toHaveBeenCalled();
    expect(initiatePayment).not.toHaveBeenCalled();
    // Everything typed is still there.
    expect(field(en.checkout.address.name).value).toBe("Mona Ali");
    expect(field(en.checkout.address.line1).value).toBe("1 Main St");
    expect(field(en.checkout.contact.label).value).toBe("guest@example.com");
  });

  it("shows an ownership failure from the first step and does nothing after it", async () => {
    setContactEmail.mockResolvedValue({ ok: false, reason: "ownership" });
    renderView();
    fillEverything();

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(en.checkout.ownershipErrorBody);
    expect(setShippingAddress).not.toHaveBeenCalled();
  });

  it("blocks an invalid phone with a field message and calls nothing", () => {
    renderView();
    fillEverything({ phone: "12ab" });

    fireEvent.click(submit());

    expect(screen.getByText(en.checkout.address.phoneInvalid)).toBeInTheDocument();
    expect(field(en.checkout.address.phone)).toHaveAttribute("aria-invalid", "true");
    expect(calls).toEqual([]);
  });

  it("blocks a missing required field and calls nothing", () => {
    renderView();
    fillEverything({ name: "" });

    fireEvent.click(submit());

    expect(calls).toEqual([]);
  });
});

describe("CheckoutView — after the order is placed, cash and a hosted checkout diverge", () => {
  it("a hosted-checkout method sends the shopper to the returned handle, not to confirmation", async () => {
    initiatePayment.mockResolvedValue({
      ok: true,
      next: "redirect",
      url: "https://pay.example.com/s/abc",
    });
    renderView({ paymentMethods: ["stripe"] });
    fillEverything();

    fireEvent.click(submit());

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://pay.example.com/s/abc"));
    expect(push).not.toHaveBeenCalled();
  });

  it("shows an alert — and goes nowhere — when a redirect was required but there is no usable handle", async () => {
    initiatePayment.mockResolvedValue({ ok: false, reason: "handoff" });
    renderView({ paymentMethods: ["stripe"] });
    fillEverything();

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(en.checkout.paymentHandoffError);
    expect(assign).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("a placed order shows only Pay now, and paying again never completes the order twice", async () => {
    initiatePayment.mockResolvedValue({ ok: false, reason: "network" });
    renderView({
      session: session({
        status: "completed",
        orderRef: "order-1",
        contactEmail: "guest@example.com",
        shippingAddress: saved,
        selectedShippingMethod: "standard",
      }),
    });

    expect(screen.queryByLabelText(en.checkout.contact.label)).toBeNull();
    expect(screen.queryByLabelText(en.checkout.address.line1)).toBeNull();
    expect(screen.queryByRole("button", { name: en.checkout.completeOrder })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: en.checkout.paymentPayNow }));

    expect(await screen.findByRole("alert")).toHaveTextContent(en.checkout.paymentOpenError);
    expect(completeCheckout).not.toHaveBeenCalled();
    expect(setContactEmail).not.toHaveBeenCalled();
    expect(initiatePayment).toHaveBeenCalledTimes(1);
  });
});

describe("CheckoutView — out of stock at placement (Plan 2B-3)", () => {
  it("shows the message with a way back to the cart, and does not open a payment", async () => {
    completeCheckout.mockResolvedValue({ ok: false, reason: "out-of-stock" });
    renderView();
    fillEverything();

    fireEvent.click(submit());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en.checkout.outOfStock);
    expect(within(alert).getByRole("link", { name: en.checkout.backToCart })).toHaveAttribute(
      "href",
      "/cart",
    );
    expect(initiatePayment).not.toHaveBeenCalled();
  });
});

describe("CheckoutView — order summary", () => {
  it("lists each line with its variant, quantity and line total", () => {
    renderView();

    const summary = screen.getByRole("complementary");
    expect(within(summary).getByText("Linen Shirt")).toBeInTheDocument();
    expect(within(summary).getByText("L")).toBeInTheDocument();
    expect(within(summary).getByLabelText(`${en.checkout.summary.quantity} 2`)).toHaveTextContent(
      "2",
    );
    expect(within(summary).getAllByText(/240/).length).toBeGreaterThan(0);
  });

  it("asks for the shipping address, and totals the subtotal, until a method is selected", () => {
    renderView();

    const summary = screen.getByRole("complementary");
    expect(within(summary).getByText(en.checkout.summary.enterShippingAddress)).toBeInTheDocument();
    expect(within(summary).queryByText(en.checkout.summary.taxes)).toBeNull();
    expect(within(summary).getByText(en.checkout.summary.total)).toBeInTheDocument();
  });

  it("shows the server's shipping, taxes and total once they exist", () => {
    renderView({
      session: session({
        contactEmail: "guest@example.com",
        shippingAddress: saved,
        selectedShippingMethod: "standard",
        totals: {
          subtotalMinor: 24000,
          shippingMinor: 500,
          taxMinor: 2400,
          grandTotalMinor: 26900,
        },
      }),
    });

    const summary = screen.getByRole("complementary");
    expect(within(summary).getByText(en.checkout.summary.taxes)).toBeInTheDocument();
    expect(within(summary).queryByText(en.checkout.summary.enterShippingAddress)).toBeNull();
    expect(within(summary).getAllByText(/269/).length).toBeGreaterThan(0);
  });

  it("also offers the summary as a collapsible block above the form on small screens", () => {
    renderView();

    expect(screen.getByText(en.checkout.summary.show)).toBeInTheDocument();
  });
});

describe("CheckoutView — messages", () => {
  it("has every checkout key in Arabic too", () => {
    const missing: string[] = [];
    const walk = (reference: unknown, translated: unknown, path: string): void => {
      if (typeof reference === "object" && reference !== null) {
        for (const key of Object.keys(reference)) {
          const next = (translated as Record<string, unknown> | undefined)?.[key];
          if (next === undefined) missing.push(`${path}.${key}`);
          else walk((reference as Record<string, unknown>)[key], next, `${path}.${key}`);
        }
      }
    };
    walk(en.checkout, ar.checkout, "checkout");
    expect(missing).toEqual([]);
  });

  it("names all twenty countries in Arabic", () => {
    expect(Object.keys(ar.checkout.countries)).toHaveLength(20);
    expect(ar.checkout.countries.EG).toBe("مصر");
  });
});
