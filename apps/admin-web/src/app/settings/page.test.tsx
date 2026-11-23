import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({ locale: "en" as string }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: mocks.locale }) }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/api/licensing", () => ({ fetchUsageCounters: vi.fn() }));
vi.mock("@/lib/platform-tools", () => ({ showPlatformTools: () => false }));
const { default: SettingsPage } = await import("./page");

beforeEach(() => {
  cleanup();
  mocks.locale = "en";
});

describe("Settings index", () => {
  it("lists WhatsApp right after Payments, linking to /settings/whatsapp", async () => {
    expect.hasAssertions();
    render(await SettingsPage());
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs.indexOf("/settings/whatsapp")).toBe(hrefs.indexOf("/settings/payments") + 1);
    expect(hrefs.indexOf("/settings/whatsapp")).toBeGreaterThan(-1);
  });

  it("shows the section's title and body with the brand name isolated", async () => {
    expect.hasAssertions();
    render(await SettingsPage());
    const link = screen.getByRole("link", { name: new RegExp(en.settingsPage.whatsappTitle) });
    expect(link).toHaveTextContent(en.settingsPage.whatsappTitle);
    expect(link).toHaveTextContent(en.settingsPage.whatsappBody);
    expect(link.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("is translated: Arabic title and body, and the same position", async () => {
    expect.hasAssertions();
    mocks.locale = "ar";
    render(await SettingsPage());
    const link = screen.getByRole("link", { name: new RegExp(ar.settingsPage.whatsappTitle) });
    expect(link).toHaveAttribute("href", "/settings/whatsapp");
    expect(link).toHaveTextContent(ar.settingsPage.whatsappBody);
    expect(ar.settingsPage.whatsappTitle).not.toBe(en.settingsPage.whatsappTitle);
  });

  it("lists Email right after WhatsApp, linking to /settings/email, in both languages", async () => {
    expect.hasAssertions();
    render(await SettingsPage());
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs.indexOf("/settings/email")).toBe(hrefs.indexOf("/settings/whatsapp") + 1);
    const link = screen.getByRole("link", { name: new RegExp(en.settingsPage.emailTitle) });
    expect(link).toHaveTextContent(en.settingsPage.emailBody);
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    cleanup();
    mocks.locale = "ar";
    render(await SettingsPage());
    const arabic = screen.getByRole("link", { name: new RegExp(ar.settingsPage.emailTitle) });
    expect(arabic).toHaveAttribute("href", "/settings/email");
    expect(arabic).toHaveTextContent(ar.settingsPage.emailBody);
    expect(ar.settingsPage.emailTitle).not.toBe(en.settingsPage.emailTitle);
  });

  it("leaves the other sections' copy as plain text", async () => {
    expect.hasAssertions();
    render(await SettingsPage());
    const payments = screen.getByRole("link", { name: new RegExp(en.settingsPage.paymentsTitle) });
    expect(payments.querySelector("bdi")).toBeNull();
  });
});
