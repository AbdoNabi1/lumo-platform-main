import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({ fetchCheckoutSettings: vi.fn(), form: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/api/checkout-settings", () => ({
  fetchCheckoutSettings: mocks.fetchCheckoutSettings,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/settings/checkout-settings-form", () => ({
  CheckoutSettingsForm: (props: unknown) => {
    mocks.form(props);
    return <p>the form</p>;
  },
}));
const { default: Page } = await import("./page");

const SETTINGS = { nameMode: "required", version: 3 };
const t = en.checkoutSettings;

beforeEach(() => {
  cleanup();
  mocks.form.mockReset();
  mocks.fetchCheckoutSettings.mockReset().mockResolvedValue({ outcome: "ok", settings: SETTINGS });
});

describe("/settings/checkout page", () => {
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
    ).toEqual(["/settings/checkout"]);
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
