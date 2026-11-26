import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { DEFAULT_PUBLIC_CHECKOUT_SETTINGS } from "@/lib/checkout-settings-model";

const request = vi.hoisted(() => ({ locale: "en" as "en" | "ar" }));
vi.mock("@/lib/request-locale", () => ({ getRequestLocale: async () => request.locale }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
const resolveCurrentCustomer = vi.fn();
vi.mock("@/lib/customer-session", () => ({
  CUSTOMER_SESSION_COOKIE: "customer",
  resolveCurrentCustomer: (...args: unknown[]) => resolveCurrentCustomer(...args),
}));
const loadCheckoutSettings = vi.fn();
vi.mock("@/lib/checkout-settings", () => ({
  loadCheckoutSettings: () => loadCheckoutSettings(),
}));
vi.mock("@/components/auth-form", () => ({ AuthForm: () => <div>auth-form</div> }));
vi.mock("@/components/signup-complete-form", () => ({
  SignupCompleteForm: () => <div>signup-form</div>,
}));

const { default: LoginPage } = await import("./login/page");
const { default: RegisterPage } = await import("./register/page");
const { default: SignupCompletePage } = await import("./signup/complete/page");

const OFF = { ...DEFAULT_PUBLIC_CHECKOUT_SETTINGS, accountsMode: "disabled" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  request.locale = "en";
  resolveCurrentCustomer.mockResolvedValue({ status: "signed-out" });
  loadCheckoutSettings.mockResolvedValue(DEFAULT_PUBLIC_CHECKOUT_SETTINGS);
});

const pages = [
  ["login", () => LoginPage(), "auth-form"],
  ["register", () => RegisterPage(), "auth-form"],
  [
    "signup completion",
    () => SignupCompletePage({ searchParams: Promise.resolve({ token: "tok" }) }),
    "signup-form",
  ],
] as const;

describe.each(pages)("the %s page", (_name, page, formText) => {
  it("is today's page with accounts on", async () => {
    render(await page());
    expect(screen.getByText(formText)).toBeInTheDocument();
    expect(screen.queryByText(en.account.accountsDisabled.title)).toBeNull();
  });

  it("says 'Customer accounts are turned off for this store' instead of the form when they are off", async () => {
    loadCheckoutSettings.mockResolvedValue(OFF);
    render(await page());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Customer accounts are turned off for this store",
    );
    expect(screen.queryByText(formText)).toBeNull();
  });

  it("says it in Arabic", async () => {
    loadCheckoutSettings.mockResolvedValue(OFF);
    request.locale = "ar";
    render(await page());
    expect(screen.getByRole("status")).toHaveTextContent(ar.account.accountsDisabled.title);
  });

  it("a signed-in customer is still sent to their account (their session stays, D37)", async () => {
    loadCheckoutSettings.mockResolvedValue(OFF);
    resolveCurrentCustomer.mockResolvedValue({ status: "signed-in", customer: {} });
    await expect(page()).rejects.toThrow("REDIRECT:/account");
  });
});
