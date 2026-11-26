import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { DEFAULT_PUBLIC_CHECKOUT_SETTINGS } from "@/lib/checkout-settings-model";

const jar = new Map<string, string>();
vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: async () => "en",
  getPreviewToken: async () => null,
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    }),
}));
const getPublicCheckoutSettings = vi.fn();
const getCheckoutSession = vi.fn();
vi.mock("@/lib/runtime-api", () => ({
  getCheckoutSession: (...args: unknown[]) => getCheckoutSession(...args),
  getPaymentMethods: vi.fn().mockResolvedValue([]),
  getShippableCountries: vi.fn().mockResolvedValue(null),
  getPublicCheckoutSettings: () => getPublicCheckoutSettings(),
}));
const resolveCurrentCustomer = vi.fn();
vi.mock("@/lib/customer-session", () => ({
  CUSTOMER_SESSION_COOKIE: "customer",
  resolveCurrentCustomer: (...args: unknown[]) => resolveCurrentCustomer(...args),
}));
const viewProps = vi.hoisted(() => ({ settings: null as unknown }));
vi.mock("@/components/checkout-view", () => ({
  CheckoutView: (props: { settings: unknown }) => {
    viewProps.settings = props.settings;
    return <div>checkout-view</div>;
  },
}));

const { default: CheckoutPage } = await import("./page");

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  viewProps.settings = null;
  jar.clear();
  jar.set("morbeh-storefront-guest-session", "guest-1");
  jar.set("morbeh_checkout_session", "cs-1");
  getCheckoutSession.mockResolvedValue({ status: 200, body: { id: "cs-1" } });
  resolveCurrentCustomer.mockResolvedValue({ status: "signed-out" });
  getPublicCheckoutSettings.mockResolvedValue(DEFAULT_PUBLIC_CHECKOUT_SETTINGS);
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

const render_ = async () => render(await CheckoutPage({ searchParams: Promise.resolve({}) }));

describe("/checkout reads the shop's settings fresh and hands them to the form", () => {
  it("reads them on every render (no cache in between)", async () => {
    await render_();
    await render_();
    expect(getPublicCheckoutSettings).toHaveBeenCalledTimes(2);
  });

  it("passes what the server said", async () => {
    const custom = { ...DEFAULT_PUBLIC_CHECKOUT_SETTINGS, line2Mode: "hidden", cartLineLimit: 3 };
    getPublicCheckoutSettings.mockResolvedValue(custom);
    await render_();
    expect(viewProps.settings).toEqual(custom);
  });

  it("fails safe: when the read fails the form gets the D33 defaults and the failure is logged", async () => {
    getPublicCheckoutSettings.mockResolvedValue(null);
    await render_();
    expect(screen.getByText("checkout-view")).toBeInTheDocument();
    expect(viewProps.settings).toEqual(DEFAULT_PUBLIC_CHECKOUT_SETTINGS);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("checkout settings unavailable"));
  });

  it("fails safe when the read throws", async () => {
    getPublicCheckoutSettings.mockRejectedValue(new Error("boom"));
    await render_();
    expect(viewProps.settings).toEqual(DEFAULT_PUBLIC_CHECKOUT_SETTINGS);
  });
});

describe("/checkout when the shop requires sign-in", () => {
  const required = { ...DEFAULT_PUBLIC_CHECKOUT_SETTINGS, requireLogin: true };

  it("tells a guest 'Sign in to check out' with the way in, and shows no form", async () => {
    getPublicCheckoutSettings.mockResolvedValue(required);
    await render_();
    expect(screen.getByText(en.checkout.loginRequired.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.checkout.loginRequired.signIn })).toHaveAttribute(
      "href",
      "/account/login",
    );
    expect(screen.getByRole("link", { name: en.checkout.loginRequired.register })).toHaveAttribute(
      "href",
      "/account/register",
    );
    expect(screen.queryByText("checkout-view")).toBeNull();
  });

  it("shows the form to a signed-in customer", async () => {
    getPublicCheckoutSettings.mockResolvedValue(required);
    resolveCurrentCustomer.mockResolvedValue({
      status: "signed-in",
      customer: { email: "me@example.com" },
    });
    await render_();
    expect(screen.getByText("checkout-view")).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.loginRequired.title)).toBeNull();
  });

  it("shows the form when the account service could not be reached: the server decides", async () => {
    getPublicCheckoutSettings.mockResolvedValue(required);
    resolveCurrentCustomer.mockResolvedValue({ status: "error" });
    await render_();
    expect(screen.getByText("checkout-view")).toBeInTheDocument();
  });

  it("does not stop a guest when the switch is off", async () => {
    await render_();
    expect(screen.getByText("checkout-view")).toBeInTheDocument();
  });
});
