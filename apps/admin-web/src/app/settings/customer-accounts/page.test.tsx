import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  fetchCheckoutSettings: vi.fn(),
  fetchEmailConnection: vi.fn(),
  form: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/api/checkout-settings", () => ({
  fetchCheckoutSettings: mocks.fetchCheckoutSettings,
}));
vi.mock("@/lib/api/notification-settings", () => ({
  fetchEmailConnection: mocks.fetchEmailConnection,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/settings/customer-accounts-form", () => ({
  CustomerAccountsForm: (props: unknown) => {
    mocks.form(props);
    return <p>the form</p>;
  },
}));
const { default: Page } = await import("./page");

const SETTINGS = { nameMode: "required", version: 3 };
const t = en.customerAccountSettings;
const CONNECTED = {
  credentialsConfigured: true,
  connection: { kind: "resend", state: "connected", version: 2 },
};

beforeEach(() => {
  cleanup();
  mocks.form.mockReset();
  mocks.fetchCheckoutSettings.mockReset().mockResolvedValue({ outcome: "ok", settings: SETTINGS });
  mocks.fetchEmailConnection
    .mockReset()
    .mockResolvedValue({ outcome: "ok", emailConnection: CONNECTED });
});

describe("/settings/customer-accounts page", () => {
  it("renders the title inside the settings frame with its own entry current, and hands the form what it read", async () => {
    expect.hasAssertions();
    render(await Page());

    expect(screen.getByRole("heading", { level: 1, name: t.title })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: en.settingsNav.label })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/settings/customer-accounts"]);
    expect(mocks.form).toHaveBeenCalledWith(expect.objectContaining({ settings: SETTINGS }));
  });

  it("says so when the settings cannot be read, without showing the form", async () => {
    expect.hasAssertions();
    mocks.fetchCheckoutSettings.mockResolvedValue({ outcome: "error", message: "boom" });
    render(await Page());

    expect(screen.getByText(t.loadError)).toBeInTheDocument();
    expect(mocks.form).not.toHaveBeenCalled();
  });

  it("asks to sign in when the read is unauthorized", async () => {
    expect.hasAssertions();
    mocks.fetchCheckoutSettings.mockResolvedValue({ outcome: "unauthorized" });
    render(await Page());

    expect(screen.getByText(t.unauthorized)).toBeInTheDocument();
    expect(mocks.form).not.toHaveBeenCalled();
  });
});

describe("/settings/customer-accounts sign-up warning (Wave 2b2, D51)", () => {
  const warning = () => screen.queryByText(t.noEmailAccountWarning, { exact: false });

  it("shows no warning while the store has a working email account", async () => {
    expect.hasAssertions();
    render(await Page());

    expect(warning()).toBeNull();
    expect(screen.queryByRole("link", { name: t.noEmailAccountLink })).toBeNull();
  });

  it.each([
    ["no account", { credentialsConfigured: true, connection: null }],
    [
      "an account that is switched off",
      { credentialsConfigured: true, connection: { state: "disabled", version: 3 } },
    ],
    [
      "an account that is failing",
      { credentialsConfigured: true, connection: { state: "failed", version: 3 } },
    ],
    ["a server that cannot store keys", { credentialsConfigured: false, connection: null }],
  ])("warns, with a link to Notifications, when the store has %s", async (_label, account) => {
    expect.hasAssertions();
    mocks.fetchEmailConnection.mockResolvedValue({ outcome: "ok", emailConnection: account });
    render(await Page());

    expect(screen.getByRole("status")).toHaveTextContent(
      "Customers can't sign up by email until you connect your store's email account in Notifications.",
    );
    expect(screen.getByRole("link", { name: t.noEmailAccountLink })).toHaveAttribute(
      "href",
      "/settings/notifications",
    );
    expect(mocks.form).toHaveBeenCalledTimes(1);
  });

  it("stays quiet, never guessing, when the account cannot be read", async () => {
    expect.hasAssertions();
    mocks.fetchEmailConnection.mockResolvedValue({ outcome: "error", message: "boom" });
    render(await Page());

    expect(warning()).toBeNull();
    expect(mocks.form).toHaveBeenCalledTimes(1);
  });

  it("is shown in Arabic from ar.customerAccountSettings", async () => {
    expect.hasAssertions();
    const { ar } = await import("@/messages/ar");
    expect(ar.customerAccountSettings.noEmailAccountWarning).not.toBe(t.noEmailAccountWarning);
    expect(ar.customerAccountSettings.noEmailAccountLink).not.toBe(t.noEmailAccountLink);
  });
});
