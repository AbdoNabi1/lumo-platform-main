import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import type { ShippableCountries } from "@/lib/checkout-address";
import type { PublicCheckoutSettings } from "@/lib/checkout-settings-model";
import type { CheckoutSessionSummary } from "@/lib/runtime-api";
import type {
  CheckoutActionResult,
  PaymentInitiationResult,
  RecalculateActionResult,
  ShippingQuoteActionResult,
} from "@/app/(store)/checkout/actions";

/**
 * Wave 2a (D33-D37), the storefront half: the checkout form follows the shop's checkout settings,
 * and with the DEFAULT settings (or none at all) it is exactly the form that was live before.
 * Own mock set (rest-args passthrough) so the optional third `setContactEmail` argument is visible.
 */
const calls: string[] = [];

const setContactEmail = vi.fn<(...args: unknown[]) => Promise<CheckoutActionResult>>();
const setShippingAddress = vi.fn<(id: string, address: unknown) => Promise<CheckoutActionResult>>();
const requestShippingQuote = vi.fn<(id: string) => Promise<ShippingQuoteActionResult>>();
const selectShipping = vi.fn<(id: string, method: string) => Promise<CheckoutActionResult>>();
const setBillingAddress = vi.fn<(id: string, address: unknown) => Promise<CheckoutActionResult>>();
const selectPayment =
  vi.fn<(id: string, ref: string, provider: string) => Promise<CheckoutActionResult>>();
const recalculate = vi.fn<(id: string) => Promise<RecalculateActionResult>>();
const requestTax = vi.fn<(id: string) => Promise<CheckoutActionResult>>();
const completeCheckout = vi.fn<(id: string) => Promise<CheckoutActionResult>>();
const initiatePayment = vi.fn<(id: string) => Promise<PaymentInitiationResult>>();

vi.mock("@/app/(store)/checkout/actions", () => ({
  setContactEmail: (...args: unknown[]) => setContactEmail(...args),
  setShippingAddress: (id: string, address: unknown) => setShippingAddress(id, address),
  requestShippingQuote: (id: string) => requestShippingQuote(id),
  selectShipping: (id: string, method: string) => selectShipping(id, method),
  setBillingAddress: (id: string, address: unknown) => setBillingAddress(id, address),
  selectPayment: (id: string, ref: string, provider: string) => selectPayment(id, ref, provider),
  recalculate: (id: string) => recalculate(id),
  requestTax: (id: string) => requestTax(id),
  completeCheckout: (id: string) => completeCheckout(id),
  initiatePayment: (id: string) => initiatePayment(id),
  applyDiscountCode: vi.fn(),
  removeDiscountCode: vi.fn(),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { CheckoutView } = await import("./checkout-view");
const { DEFAULT_PUBLIC_CHECKOUT_SETTINGS } = await import("@/lib/checkout-settings-model");

const OK: CheckoutActionResult = { ok: true, checkoutSessionId: "checkout-1" };
const QUOTES = [{ method: "rate-standard", name: "Standard shipping", rateAmountMinor: 500 }];
const SHIPS_TO: ShippableCountries = { countries: ["EG", "SA", "AE", "US"], restOfWorld: false };

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  for (const [name, mock] of Object.entries({
    setContactEmail,
    setShippingAddress,
    selectShipping,
    setBillingAddress,
    selectPayment,
    requestTax,
    completeCheckout,
  })) {
    mock.mockImplementation(async () => {
      calls.push(name);
      return OK;
    });
  }
  recalculate.mockImplementation(async () => {
    calls.push("recalculate");
    return { ok: true, checkoutSessionId: "checkout-1", discounts: { order: 0, shipping: 0 } };
  });
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

function renderView(
  props: {
    settings?: PublicCheckoutSettings | undefined;
    withSettingsProp?: boolean;
    accountEmail?: string | null;
    locale?: "en" | "ar";
    session?: CheckoutSessionSummary;
  } = {},
) {
  const locale = props.locale ?? "en";
  const base = {
    session: props.session ?? session(),
    t: locale === "ar" ? (ar as unknown as typeof en) : en,
    locale,
    accountEmail: props.accountEmail ?? null,
    paymentMethods: ["cod", "stripe"] as const,
    shippableCountries: SHIPS_TO,
  };
  return render(
    props.withSettingsProp === false || props.settings === undefined ? (
      <CheckoutView {...base} />
    ) : (
      <CheckoutView {...base} settings={props.settings} />
    ),
  );
}

const settingsWith = (patch: Partial<PublicCheckoutSettings>): PublicCheckoutSettings => ({
  ...DEFAULT_PUBLIC_CHECKOUT_SETTINGS,
  ...patch,
});

const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /Complete order|Pay now/ });
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(field(label), { target: { value } });

/** Every control of the form as a user would meet it: id, kind, required, and its label text. */
function controls(container: HTMLElement): readonly (readonly [string, string, boolean, string])[] {
  return [...container.querySelectorAll<HTMLInputElement>("input, select, textarea")].map((el) => [
    el.id !== "" ? el.id : (el.getAttribute("name") ?? ""),
    el.tagName === "SELECT" ? "select" : el.type,
    el.required,
    el.id !== "" ? (container.querySelector(`label[for="${el.id}"]`)?.textContent ?? "") : "",
  ]);
}

function fill(overrides: Record<string, string> = {}): void {
  const values = {
    email: "guest@example.com",
    name: "Mona Ali",
    line1: "1 Main St",
    city: "Cairo",
    phone: "01012345678",
    province: "EG-C",
    ...overrides,
  };
  type(en.checkout.contact.label, values.email);
  if (values.name !== "") type(/^Full name/, values.name);
  type(en.checkout.address.line1, values.line1);
  type(en.checkout.address.city, values.city);
  if (values.phone !== "") type(/^Phone/, values.phone);
  type(en.checkout.address.governorate, values.province);
}

describe("D33: with the default settings the form is exactly what was live before", () => {
  // Captured from the form BEFORE this change existed (run against the unmodified view).
  const TODAY = [
    ["contact-email", "email", true, "Email address"],
    ["shipping-country", "select", true, "Country/region"],
    ["shipping-province", "select", true, "Governorate"],
    ["shipping-name", "text", true, "Full name"],
    ["shipping-line1", "text", true, "Address"],
    ["shipping-line2", "text", false, "Apartment, suite, etc. (optional)"],
    ["shipping-city", "text", true, "City"],
    ["shipping-postalCode", "text", false, "Postal code (optional)"],
    ["shipping-phone", "tel", true, "Phone"],
    ["payment-method", "radio", false, ""],
    ["payment-method", "radio", false, ""],
    ["billing-mode", "radio", false, ""],
    ["billing-mode", "radio", false, ""],
  ] as const;

  it("renders these controls, in this order, with these labels and required marks", () => {
    const { container } = renderView({ withSettingsProp: false });
    // The order summary's discount code box (its id comes from React's useId) is not part of the form.
    const actual = controls(container).filter(([id]) => !id.endsWith("-code"));
    expect(actual).toEqual(TODAY);
  });

  it("renders no marketing checkbox", () => {
    const { container } = renderView({ withSettingsProp: false });
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.queryByText(/news and offers/i)).toBeNull();
  });

  it("is the very same markup with no settings and with the default settings", () => {
    const html = (c: HTMLElement) => c.innerHTML.replace(/_r_[0-9a-z]+_/g, "_r_");
    const none = html(renderView({ withSettingsProp: false }).container);
    cleanup();
    const defaults = html(renderView({ settings: DEFAULT_PUBLIC_CHECKOUT_SETTINGS }).container);
    expect(defaults).toBe(none);
  });

  it("still refuses to place an order without a name, or without a valid phone", async () => {
    renderView({ withSettingsProp: false });
    fill({ name: "" });
    fireEvent.click(submit());
    await waitFor(() => expect(calls).toEqual([]));
    expect(setContactEmail).not.toHaveBeenCalled();

    type(/^Full name/, "Mona Ali");
    type(/^Phone/, "");
    fireEvent.click(submit());
    expect(await screen.findByText(en.checkout.address.phoneInvalid)).toBeInTheDocument();
    expect(setContactEmail).not.toHaveBeenCalled();
    expect(completeCheckout).not.toHaveBeenCalled();
  });

  it("places an order with the same calls in the same order as before, sending no marketing answer", async () => {
    renderView({ withSettingsProp: false });
    fill();
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    calls.length = 0;
    fireEvent.click(submit());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/checkout/confirmation"));
    expect(calls).toEqual([
      "setContactEmail",
      "setBillingAddress",
      "selectPayment",
      "requestTax",
      "recalculate",
      "completeCheckout",
      "initiatePayment",
    ]);
    expect(setContactEmail).toHaveBeenCalledWith("checkout-1", "guest@example.com");
  });
});

describe("name and phone follow the shop's settings", () => {
  it("name optional: the label says so, nothing demands it, and the order goes through nameless", async () => {
    renderView({ settings: settingsWith({ nameMode: "optional" }) });
    const name = field(en.checkout.address.nameOptional);
    expect(name).not.toBeRequired();
    expect(screen.queryByLabelText(en.checkout.address.name)).toBeNull();

    fill({ name: "" });
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    expect(setShippingAddress).toHaveBeenCalledWith(
      "checkout-1",
      expect.not.objectContaining({ name: expect.anything() }),
    );
    fireEvent.click(submit());
    await waitFor(() => expect(completeCheckout).toHaveBeenCalled());
  });

  it("name required (the default) never reaches the server nameless", async () => {
    renderView({ settings: settingsWith({ nameMode: "required" }) });
    fill({ name: "" });
    fireEvent.blur(field(/^Phone/));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(setShippingAddress).not.toHaveBeenCalled();
  });

  it("phone optional: the label says so, it may be left empty, a typed one must still be valid", async () => {
    renderView({ settings: settingsWith({ phoneMode: "optional" }) });
    const phone = field(en.checkout.address.phoneOptional);
    expect(phone).not.toBeRequired();

    fill({ phone: "" });
    fireEvent.click(submit());
    await waitFor(() => expect(completeCheckout).toHaveBeenCalled());
    const sent = setShippingAddress.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("phone");

    cleanup();
    vi.clearAllMocks();
    renderView({ settings: settingsWith({ phoneMode: "optional" }) });
    fill({ phone: "12" });
    fireEvent.click(submit());
    expect(await screen.findByText(en.checkout.address.phoneInvalid)).toBeInTheDocument();
    expect(setContactEmail).not.toHaveBeenCalled();
  });

  it("the billing address keeps its own rules: name and phone are never demanded there", () => {
    renderView({ settings: settingsWith({ nameMode: "required", phoneMode: "required" }) });
    fireEvent.click(screen.getByRole("radio", { name: en.checkout.differentBilling }));
    expect(document.getElementById("billing-name")).not.toBeRequired();
    expect(document.getElementById("billing-phone")).not.toBeRequired();
    expect(document.querySelector('label[for="billing-name"]')?.textContent).toBe(
      en.checkout.address.name,
    );
  });
});

describe("address line 2 follows the shop's settings", () => {
  it("hidden: no input at all, on shipping or billing, and no second line is sent", async () => {
    renderView({ settings: settingsWith({ line2Mode: "hidden" }) });
    expect(document.getElementById("shipping-line2")).toBeNull();
    fill();
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    expect(setShippingAddress).toHaveBeenCalledWith(
      "checkout-1",
      expect.objectContaining({ line2: "" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: en.checkout.differentBilling }));
    expect(document.getElementById("billing-line2")).toBeNull();
  });

  it("required: marked required, and the address is not saved until it is filled", async () => {
    renderView({ settings: settingsWith({ line2Mode: "required" }) });
    const line2 = field(en.checkout.address.line2Required);
    expect(line2).toBeRequired();
    expect(screen.queryByLabelText(en.checkout.address.line2)).toBeNull();

    fill();
    fireEvent.blur(field(/^Phone/));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(setShippingAddress).not.toHaveBeenCalled();

    type(en.checkout.address.line2Required, "Flat 3");
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    expect(setShippingAddress).toHaveBeenCalledWith(
      "checkout-1",
      expect.objectContaining({ line2: "Flat 3" }),
    );
  });

  it("required applies to shipping only: the billing address keeps it optional", () => {
    renderView({ settings: settingsWith({ line2Mode: "required" }) });
    fireEvent.click(screen.getByRole("radio", { name: en.checkout.differentBilling }));
    expect(document.getElementById("billing-line2")).not.toBeRequired();
    expect(document.querySelector('label[for="billing-line2"]')?.textContent).toBe(
      en.checkout.address.line2,
    );
  });
});

describe("the marketing box", () => {
  const box = () => screen.getByLabelText(en.checkout.marketing.label) as HTMLInputElement;

  it("show: an UNTICKED box; ticking it sends true with the contact step", async () => {
    renderView({ settings: settingsWith({ marketingEmailPrompt: "show" }) });
    expect(box().checked).toBe(false);
    fireEvent.click(box());
    fill();
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    fireEvent.click(submit());
    await waitFor(() => expect(completeCheckout).toHaveBeenCalled());
    expect(setContactEmail).toHaveBeenCalledWith("checkout-1", "guest@example.com", true);
  });

  it("show, left unticked: the answer false is sent (the shop asked, the shopper said no)", async () => {
    renderView({ settings: settingsWith({ marketingEmailPrompt: "show" }) });
    fill();
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    fireEvent.click(submit());
    await waitFor(() => expect(completeCheckout).toHaveBeenCalled());
    expect(setContactEmail).toHaveBeenCalledWith("checkout-1", "guest@example.com", false);
  });

  it("preselect: the box starts ticked, and unticking it sends false", async () => {
    renderView({ settings: settingsWith({ marketingEmailPrompt: "preselect" }) });
    expect(box().checked).toBe(true);
    fireEvent.click(box());
    fill();
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    fireEvent.click(submit());
    await waitFor(() => expect(completeCheckout).toHaveBeenCalled());
    expect(setContactEmail).toHaveBeenCalledWith("checkout-1", "guest@example.com", false);
  });

  it("hidden: no box, and no answer is ever sent", async () => {
    renderView({ settings: settingsWith({ marketingEmailPrompt: "hidden" }) });
    expect(screen.queryByLabelText(en.checkout.marketing.label)).toBeNull();
    fill();
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    fireEvent.click(submit());
    await waitFor(() => expect(completeCheckout).toHaveBeenCalled());
    for (const call of setContactEmail.mock.calls) expect(call).toHaveLength(2);
  });

  it("a signed-in shopper whose account email was applied at once still gets their answer sent", async () => {
    renderView({
      settings: settingsWith({ marketingEmailPrompt: "show" }),
      accountEmail: "me@example.com",
    });
    await waitFor(() =>
      expect(setContactEmail).toHaveBeenCalledWith("checkout-1", "me@example.com"),
    );
    fireEvent.click(box());
    type(/^Full name/, "Mona Ali");
    type(en.checkout.address.line1, "1 Main St");
    type(en.checkout.address.city, "Cairo");
    type(/^Phone/, "01012345678");
    type(en.checkout.address.governorate, "EG-C");
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    fireEvent.click(submit());
    await waitFor(() => expect(completeCheckout).toHaveBeenCalled());
    expect(setContactEmail).toHaveBeenLastCalledWith("checkout-1", "me@example.com", true);
  });

  it("speaks Arabic", () => {
    renderView({ settings: settingsWith({ marketingEmailPrompt: "show" }), locale: "ar" });
    expect(screen.getByLabelText(ar.checkout.marketing.label)).not.toBeChecked();
  });
});

describe("server 422 fields land on their inputs", () => {
  it("a refused shipping address names the phone and name next to their inputs, and an edit clears each", async () => {
    setShippingAddress.mockImplementationOnce(async () => ({
      ok: false,
      reason: "validation",
      fields: [
        { field: "name", message: "Name is required" },
        { field: "phone", message: "Phone is required" },
      ],
    }));
    renderView();
    fill();
    fireEvent.blur(field(/^Phone/));
    expect(
      await screen.findByText(en.checkout.address.nameMissing, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(field(/^Full name/)).toHaveAttribute("aria-invalid", "true");
    expect(field(/^Phone/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(en.checkout.address.phoneInvalid)).toBeInTheDocument();
    expect(screen.getByText(en.checkout.validationErrorBody)).toBeInTheDocument();

    type(/^Full name/, "Mona Ali B");
    expect(screen.queryByText(en.checkout.address.nameMissing)).toBeNull();
    expect(screen.getByText(en.checkout.address.phoneInvalid)).toBeInTheDocument();
  });

  it("a refused completion (the settings changed mid-checkout) names line 2", async () => {
    completeCheckout.mockImplementationOnce(async () => ({
      ok: false,
      reason: "validation",
      fields: [{ field: "line2", message: "Address line 2 is required" }],
    }));
    renderView({ settings: settingsWith({ line2Mode: "optional" }) });
    fill();
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    fireEvent.click(submit());
    expect(await screen.findByText(en.checkout.address.line2Missing)).toBeInTheDocument();
    expect(field(en.checkout.address.line2)).toHaveAttribute("aria-invalid", "true");
    expect(initiatePayment).not.toHaveBeenCalled();
  });
});

describe("LOGIN_REQUIRED on placing the order", () => {
  it("shows 'Sign in to check out' with links to sign in and register, and opens no payment", async () => {
    completeCheckout.mockImplementationOnce(async () => ({ ok: false, reason: "login-required" }));
    renderView();
    fill();
    fireEvent.blur(field(/^Phone/));
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    fireEvent.click(submit());
    expect(await screen.findByText(en.checkout.loginRequired.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.checkout.loginRequired.signIn })).toHaveAttribute(
      "href",
      "/account/login",
    );
    expect(screen.getByRole("link", { name: en.checkout.loginRequired.register })).toHaveAttribute(
      "href",
      "/account/register",
    );
    expect(initiatePayment).not.toHaveBeenCalled();
  });

  it("leaves out the register link when the shop has accounts off, and speaks Arabic", async () => {
    completeCheckout.mockImplementationOnce(async () => ({ ok: false, reason: "login-required" }));
    renderView({ settings: settingsWith({ accountsMode: "disabled" }), locale: "ar" });
    // Arabic labels: drive the form through its ids.
    for (const [id, value] of [
      ["contact-email", "guest@example.com"],
      ["shipping-name", "Mona Ali"],
      ["shipping-line1", "1 Main St"],
      ["shipping-city", "Cairo"],
      ["shipping-phone", "01012345678"],
      ["shipping-province", "EG-C"],
    ] as const) {
      fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });
    }
    fireEvent.blur(document.getElementById("shipping-phone") as HTMLElement);
    await waitFor(() => expect(setShippingAddress).toHaveBeenCalled(), { timeout: 3000 });
    await screen.findByRole("radio", { name: /Standard shipping/ }, { timeout: 3000 });
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`${ar.checkout.completeOrder}|${ar.checkout.paymentPayNow}`),
      }),
    );
    expect(await screen.findByText(ar.checkout.loginRequired.title)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: ar.checkout.loginRequired.register })).toBeNull();
  });
});
