import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import { COUNTRY_CODES } from "@platform/regions";
import type { ShippableCountries } from "@/lib/checkout-address";
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
  { method: "rate-standard", name: "Standard shipping", rateAmountMinor: 500 },
  {
    method: "rate-express",
    name: "Express shipping",
    description: "1-2 days",
    rateAmountMinor: 1500,
  },
];
const STANDARD = /Standard shipping/;
const EXPRESS = /Express shipping/;

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
    selectedPaymentMethod: null,
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
  province: "EG-C",
};
const SHIPS_TO: ShippableCountries = {
  countries: ["EG", "SA", "AE", "US", "GB", "CA", "DZ"],
  restOfWorld: false,
};

function renderView(
  props: {
    session?: CheckoutSessionSummary;
    paymentMethods?: readonly string[] | null;
    accountEmail?: string | null;
    shippable?: ShippableCountries | null;
    locale?: "en" | "ar";
  } = {},
) {
  const locale = props.locale ?? "en";
  return render(
    <CheckoutView
      session={props.session ?? session()}
      t={locale === "ar" ? (ar as unknown as typeof en) : en}
      locale={locale}
      accountEmail={props.accountEmail ?? null}
      paymentMethods={props.paymentMethods === undefined ? METHODS : props.paymentMethods}
      shippableCountries={props.shippable === undefined ? SHIPS_TO : props.shippable}
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
    province: "EG-C",
    ...overrides,
  };
  type(en.checkout.contact.label, values.email);
  type(en.checkout.address.name, values.name);
  type(en.checkout.address.line1, values.line1);
  type(en.checkout.address.city, values.city);
  type(en.checkout.address.phone, values.phone);
  if (values.province !== "") type(en.checkout.address.governorate, values.province);
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

  it("offers the shop's zone countries, named in the page's language", () => {
    renderView();

    const options = within(field(en.checkout.address.country)).getAllByRole("option");
    expect(options.map((option) => option.getAttribute("value")).sort()).toEqual(
      [...SHIPS_TO.countries].sort(),
    );
    expect(screen.getByRole("option", { name: "Egypt" })).toBeInTheDocument();
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
    expect(screen.queryByRole("radio", { name: STANDARD })).not.toBeInTheDocument();
    expect(setShippingAddress).not.toHaveBeenCalled();
  });

  it("saves the address, quotes it and pre-selects the first method once it is complete", async () => {
    renderView();
    fillEverything();

    fireEvent.blur(field(en.checkout.address.phone));

    const standard = await screen.findByRole("radio", { name: STANDARD }, { timeout: 3000 });
    expect(standard).toBeChecked();
    expect(screen.getByRole("radio", { name: EXPRESS })).not.toBeChecked();
    expect(setShippingAddress).toHaveBeenCalledWith("checkout-1", {
      name: "Mona Ali",
      phone: "01012345678",
      line1: "1 Main St",
      line2: "",
      city: "Cairo",
      postalCode: "",
      country: "EG",
      province: "EG-C",
    });
    expect(selectShipping).toHaveBeenCalledTimes(1);
    expect(selectShipping).toHaveBeenCalledWith("checkout-1", "rate-standard");
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
    const express = await screen.findByRole("radio", { name: EXPRESS }, { timeout: 3000 });
    selectShipping.mockClear();
    recalculate.mockClear();

    fireEvent.click(express);

    await waitFor(() => expect(selectShipping).toHaveBeenCalledWith("checkout-1", "rate-express"));
    await waitFor(() => expect(recalculate).toHaveBeenCalled());
  });

  it("resumes with the methods listed when the session already holds a complete address", async () => {
    renderView({
      session: session({
        contactEmail: "guest@example.com",
        shippingAddress: saved,
        selectedShippingMethod: "rate-standard",
      }),
    });

    expect(
      await screen.findByRole("radio", {
        name: STANDARD,
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
    const [, billingProvince] = screen.getAllByLabelText(en.checkout.address.governorate);
    fireEvent.change(billingLine1 as HTMLInputElement, { target: { value: "9 Bill St" } });
    fireEvent.change(billingCity as HTMLInputElement, { target: { value: "Giza" } });
    fireEvent.change(billingProvince as HTMLInputElement, { target: { value: "EG-GZ" } });

    fireEvent.click(submit());

    await waitFor(() => expect(setBillingAddress).toHaveBeenCalled());
    expect(setBillingAddress.mock.calls[0]?.[1]).toMatchObject({
      line1: "9 Bill St",
      city: "Giza",
      province: "EG-GZ",
    });
  });

  it("does not repeat the contact or address calls the page already made", async () => {
    renderView({
      session: session({
        contactEmail: "guest@example.com",
        shippingAddress: saved,
        selectedShippingMethod: "rate-standard",
      }),
    });
    await screen.findByRole("radio", {
      name: STANDARD,
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
        selectedShippingMethod: "rate-standard",
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

describe("CheckoutView — line pictures (Plan 2C-3)", () => {
  it("shows each line's picture with the quantity badge over it, like Shopify", () => {
    renderView({
      session: session({
        items: [
          {
            productId: "p1",
            title: "Linen Shirt",
            variantTitle: "L",
            quantity: 2,
            unitPriceAmountMinor: 12000,
            imageUrl: "https://cdn.example.test/shirt.webp",
          },
        ],
      }),
    });

    const summary = screen.getByRole("complementary");
    const img = within(summary).getByRole("img", { name: "Linen Shirt" });
    expect(img).toHaveAttribute("src", "https://cdn.example.test/shirt.webp");
    const badge = within(summary).getByLabelText(`${en.checkout.summary.quantity} 2`);
    expect(badge).toHaveTextContent("2");
    expect(badge.className).toContain("absolute");
    expect(badge.parentElement).toBe(img.parentElement);
  });

  it("keeps the quantity badge over a placeholder when a line has no picture", () => {
    renderView();
    const summary = screen.getByRole("complementary");
    expect(within(summary).queryByRole("img", { name: "Linen Shirt" })).toBeNull();
    expect(within(summary).getByLabelText(`${en.checkout.summary.quantity} 2`)).toBeInTheDocument();
    expect(within(summary).getByLabelText(en.product.gallery.noImage)).toBeInTheDocument();
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
        selectedShippingMethod: "rate-standard",
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

describe("CheckoutView — where the shop ships (Plan 3C)", () => {
  it("offers every country when a rest-of-the-world zone exists", () => {
    renderView({ shippable: { countries: ["EG"], restOfWorld: true } });

    const options = within(field(en.checkout.address.country)).getAllByRole("option");
    expect(options).toHaveLength(COUNTRY_CODES.length);
  });

  it("says the shop ships nowhere yet, and disables the order button", () => {
    renderView({ shippable: { countries: [], restOfWorld: false } });

    expect(screen.getByText(en.checkout.noShippingDestinations)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });

  it("fails closed the same way when the list of countries could not be loaded", () => {
    renderView({ shippable: null });

    expect(screen.getByText(en.checkout.noShippingDestinations)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });
});

describe("CheckoutView — the billing address takes any country (follow-up to Plan 3C)", () => {
  function openBilling() {
    fireEvent.click(screen.getByRole("radio", { name: en.checkout.differentBilling }));
    const [shippingCountry, billingCountry] = screen.getAllByLabelText(
      en.checkout.address.country,
    ) as HTMLSelectElement[];
    return { shippingCountry, billingCountry };
  }
  const codes = (select: HTMLSelectElement | undefined) =>
    within(select as HTMLSelectElement)
      .getAllByRole("option")
      .map((option) => option.getAttribute("value"));

  it("limits only the shipping country to the shop's zones; billing offers every country", () => {
    renderView();

    const { shippingCountry, billingCountry } = openBilling();

    expect(codes(shippingCountry)).not.toContain("FR");
    expect(codes(shippingCountry)).toHaveLength(SHIPS_TO.countries.length);
    expect(codes(billingCountry)).toHaveLength(COUNTRY_CODES.length);
    expect(codes(billingCountry)).toEqual(expect.arrayContaining(["FR", "JP", "EG"]));
  });

  it("offers every country for billing even when the shop ships nowhere yet", () => {
    renderView({ shippable: { countries: [], restOfWorld: false } });

    const { billingCountry } = openBilling();

    expect(codes(billingCountry)).toHaveLength(COUNTRY_CODES.length);
  });

  it("asks for the billing governorate/region/emirate only for countries with provinces", () => {
    renderView();
    const { billingCountry } = openBilling();

    expect(screen.getAllByLabelText(en.checkout.address.governorate)).toHaveLength(2);
    fireEvent.change(billingCountry as HTMLSelectElement, { target: { value: "SA" } });
    expect(screen.getAllByLabelText(en.checkout.address.region)).toHaveLength(1);
    fireEvent.change(billingCountry as HTMLSelectElement, { target: { value: "FR" } });
    expect(screen.queryAllByLabelText(en.checkout.address.region)).toHaveLength(0);
    expect(screen.getAllByLabelText(en.checkout.address.governorate)).toHaveLength(1);
  });

  it("sends a billing address in a country the shop does not ship to, without a province", async () => {
    renderView();
    fillEverything();
    const { billingCountry } = openBilling();
    fireEvent.change(billingCountry as HTMLSelectElement, { target: { value: "FR" } });
    const [, billingLine1] = screen.getAllByLabelText(en.checkout.address.line1);
    const [, billingCity] = screen.getAllByLabelText(en.checkout.address.city);
    fireEvent.change(billingLine1 as HTMLInputElement, { target: { value: "1 Rue de Paris" } });
    fireEvent.change(billingCity as HTMLInputElement, { target: { value: "Paris" } });

    fireEvent.click(submit());

    await waitFor(() => expect(setBillingAddress).toHaveBeenCalled(), { timeout: 5000 });
    const sent = setBillingAddress.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent).toMatchObject({ country: "FR", city: "Paris" });
    expect(sent).not.toHaveProperty("province");
  });

  it("does not submit a billing address in Egypt/Saudi Arabia/the UAE until its province is chosen", async () => {
    renderView();
    fillEverything();
    openBilling();
    const [, billingLine1] = screen.getAllByLabelText(en.checkout.address.line1);
    const [, billingCity] = screen.getAllByLabelText(en.checkout.address.city);
    fireEvent.change(billingLine1 as HTMLInputElement, { target: { value: "9 Bill St" } });
    fireEvent.change(billingCity as HTMLInputElement, { target: { value: "Giza" } });

    fireEvent.click(submit());
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(setBillingAddress).not.toHaveBeenCalled();
  });

  it("shows a saved billing country the shop does not ship to as selected", () => {
    renderView({
      session: session({
        contactEmail: "guest@example.com",
        shippingAddress: saved,
        billingAddress: {
          ...saved,
          line1: "1 Rue de Paris",
          city: "Paris",
          country: "FR",
          province: null,
        },
      }),
    });

    const [, billingCountry] = screen.getAllByLabelText(
      en.checkout.address.country,
    ) as HTMLSelectElement[];
    expect(billingCountry?.value).toBe("FR");
  });
});

describe("CheckoutView — the province (Plan 3C)", () => {
  it("asks for the governorate of Egypt, from the region data, and requires it", () => {
    renderView();

    const select = field(en.checkout.address.governorate);
    expect(select.tagName).toBe("SELECT");
    expect(select).toBeRequired();
    const names = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).toEqual(expect.arrayContaining(["Cairo", "Giza"]));
    expect(within(select).getByRole("option", { name: "Cairo" })).toHaveValue("EG-C");
  });

  it("calls it a region for Saudi Arabia and an emirate for the UAE, and drops it for countries without data", () => {
    renderView();

    fireEvent.change(field(en.checkout.address.country), { target: { value: "SA" } });
    expect(field(en.checkout.address.region).tagName).toBe("SELECT");
    fireEvent.change(field(en.checkout.address.country), { target: { value: "AE" } });
    expect(field(en.checkout.address.emirate).tagName).toBe("SELECT");
    fireEvent.change(field(en.checkout.address.country), { target: { value: "US" } });
    for (const label of ["governorate", "region", "emirate"] as const) {
      expect(screen.queryByLabelText(en.checkout.address[label])).not.toBeInTheDocument();
    }
  });

  it("forgets the chosen province when the country changes", () => {
    renderView();
    type(en.checkout.address.governorate, "EG-GZ");

    fireEvent.change(field(en.checkout.address.country), { target: { value: "SA" } });

    expect(field(en.checkout.address.region).value).toBe("");
  });

  it("is named in Arabic on an Arabic page", () => {
    renderView({ locale: "ar" });

    const select = screen.getByLabelText(ar.checkout.address.governorate);
    expect(within(select).getByRole("option", { name: "القاهرة" })).toHaveValue("EG-C");
  });

  it("does not save or quote the address until the province is chosen", async () => {
    renderView();
    fillEverything({ province: "" });

    fireEvent.blur(field(en.checkout.address.phone));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(setShippingAddress).not.toHaveBeenCalled();

    type(en.checkout.address.governorate, "EG-GZ");
    fireEvent.blur(field(en.checkout.address.phone));
    await waitFor(() => expect(setShippingAddress).toHaveBeenCalled(), { timeout: 3000 });
    expect(setShippingAddress).toHaveBeenCalledWith(
      "checkout-1",
      expect.objectContaining({ country: "EG", province: "EG-GZ" }),
    );
  });

  it("sends no province for a country without province data", async () => {
    renderView();
    fillEverything({ province: "" });
    fireEvent.change(field(en.checkout.address.country), { target: { value: "US" } });

    fireEvent.blur(field(en.checkout.address.phone));
    await waitFor(() => expect(setShippingAddress).toHaveBeenCalled(), { timeout: 3000 });
    const sent = setShippingAddress.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent.country).toBe("US");
    expect(sent).not.toHaveProperty("province");
  });
});

describe("CheckoutView — the shop's rates (Plan 3C)", () => {
  it("lists each rate by the merchant's name, with its description and its price", async () => {
    renderView();
    fillEverything();
    fireEvent.blur(field(en.checkout.address.phone));

    const express = await screen.findByRole("radio", { name: EXPRESS }, { timeout: 3000 });
    expect(express).toHaveAccessibleName(expect.stringContaining("1-2 days"));
    expect(express).toHaveAccessibleName(expect.stringMatching(/15/));
    expect(selectShipping).toHaveBeenCalledWith("checkout-1", "rate-standard");
  });

  it("shows Free for a rate that costs nothing", async () => {
    requestShippingQuote.mockResolvedValue({
      ok: true,
      checkoutSessionId: "checkout-1",
      quotes: [{ method: "rate-free", name: "Free over 1000", rateAmountMinor: 0 }],
    });
    renderView();
    fillEverything();
    fireEvent.blur(field(en.checkout.address.phone));

    const free = await screen.findByRole("radio", { name: /Free over 1000/ }, { timeout: 3000 });
    expect(free).toHaveAccessibleName(expect.stringContaining(en.checkout.summary.free));
  });

  it("says shipping is not available, and disables the order button, when no rate fits the address", async () => {
    requestShippingQuote.mockResolvedValue({
      ok: true,
      checkoutSessionId: "checkout-1",
      quotes: [],
    });
    renderView();
    fillEverything();
    fireEvent.blur(field(en.checkout.address.phone));

    expect(
      await screen.findByText(en.checkout.noShippingRates, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });
});

describe("CheckoutView — taxes in the summary (Plan 3C)", () => {
  const withTotals = (totals: NonNullable<CheckoutSessionSummary["totals"]>) =>
    session({
      contactEmail: "guest@example.com",
      shippingAddress: saved,
      selectedShippingMethod: "rate-standard",
      totals,
    });

  it("says how much of the total is tax when the prices already include it", () => {
    renderView({
      session: withTotals({
        subtotalMinor: 24000,
        shippingMinor: 500,
        taxMinor: 2987,
        grandTotalMinor: 24500,
        taxIncluded: true,
      }),
    });

    const summary = screen.getByRole("complementary");
    expect(within(summary).getByText(/Including .*29\.87.* in taxes/)).toBeInTheDocument();
    expect(within(summary).queryByText(en.checkout.summary.taxes)).toBeNull();
  });

  it("shows a Taxes line when the tax is added on top", () => {
    renderView({
      session: withTotals({
        subtotalMinor: 24000,
        shippingMinor: 500,
        taxMinor: 3430,
        grandTotalMinor: 27930,
        taxIncluded: false,
      }),
    });

    const summary = screen.getByRole("complementary");
    expect(within(summary).getByText(en.checkout.summary.taxes)).toBeInTheDocument();
    expect(within(summary).queryByText(/Including/)).toBeNull();
  });

  it("shows nothing about tax when there is none", () => {
    renderView({
      session: withTotals({
        subtotalMinor: 24000,
        shippingMinor: 500,
        taxMinor: 0,
        grandTotalMinor: 24500,
        taxIncluded: false,
      }),
    });

    const summary = screen.getByRole("complementary");
    expect(within(summary).queryByText(en.checkout.summary.taxes)).toBeNull();
    expect(within(summary).queryByText(/Including/)).toBeNull();
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

  it("names the province field, the rates and the tax lines in Arabic", () => {
    expect(ar.checkout.address.governorate).toBe("المحافظة");
    expect(ar.checkout.noShippingRates).toBe("الشحن مش متاح للعنوان ده.");
    expect(ar.checkout.summary.free).toBe("مجاني");
    expect(ar.checkout.summary.includingTaxes).toContain("{tax}");
  });
});
