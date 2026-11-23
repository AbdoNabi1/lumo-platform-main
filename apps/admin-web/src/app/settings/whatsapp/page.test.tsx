import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { WhatsAppConnectionDto, WhatsAppTemplateDto } from "@/lib/api/outreach";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  locale: "en" as string | undefined,
  fetchConnection: vi.fn(),
  fetchTemplates: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (mocks.locale === undefined ? undefined : { value: mocks.locale }),
    }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main data-testid="shell">{children}</main>,
}));
vi.mock("@/lib/api/outreach", () => ({
  fetchWhatsAppConnection: mocks.fetchConnection,
  fetchWhatsAppTemplates: mocks.fetchTemplates,
}));
vi.mock("@/app/settings/whatsapp/actions", () => ({
  abandonOnboardingAction: vi.fn(),
  disconnectWhatsAppAction: vi.fn(),
  refreshWhatsAppAction: vi.fn(),
  connectWhatsAppAction: vi.fn(),
  testSendAction: vi.fn(),
}));
const { default: WhatsAppSettingsPage } = await import("./page");

const signup = { appId: "1", configId: "2", graphApiVersion: "v24.0" };
const connection: WhatsAppConnectionDto = {
  available: true,
  status: "connected",
  displayPhoneNumber: "+20 100 123 4567",
  verifiedName: "Nour Store",
  qualityRating: "GREEN",
  messagingLimitTier: "TIER_250",
  connectedAt: "2026-11-20T10:00:00.000Z",
  lastError: null,
  onboardingFailure: null,
  onboardingStage: null,
  version: 3,
  signup,
};
const template: WhatsAppTemplateDto = {
  name: "order_update",
  language: "en",
  category: "UTILITY",
  status: "APPROVED",
  variableCount: 0,
  supported: true,
  sendShape: { bodyVariableCount: 0, headerHasVariable: false, buttons: [] },
};

beforeEach(() => {
  cleanup();
  mocks.locale = "en";
  mocks.fetchConnection.mockReset().mockResolvedValue({ outcome: "ok", data: connection });
  mocks.fetchTemplates.mockReset().mockResolvedValue({ outcome: "ok", data: [template] });
});

describe("Settings → WhatsApp page", () => {
  it("renders the connected card inside the settings layout, with a way back", async () => {
    expect.hasAssertions();
    render(await WhatsAppSettingsPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("WhatsApp messaging");
    expect(screen.getByRole("link", { name: en.whatsappSettings.back })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByText("+20 100 123 4567")).toBeInTheDocument();
    const layout = screen.getByTestId("shell").firstElementChild!;
    expect(layout).toHaveClass("max-w-3xl", "mx-auto");
    expect(mocks.fetchTemplates).toHaveBeenCalledTimes(1);
  });

  it("links to the message templates when WhatsApp is available, and not when it is not set up", async () => {
    expect.hasAssertions();
    render(await WhatsAppSettingsPage());
    expect(screen.getByRole("link", { name: en.whatsappSettings.templatesLink })).toHaveAttribute(
      "href",
      "/settings/whatsapp/templates",
    );
    cleanup();
    mocks.fetchConnection.mockResolvedValue({
      outcome: "ok",
      data: { ...connection, available: false, status: "not_connected" },
    });
    render(await WhatsAppSettingsPage());
    expect(screen.queryByRole("link", { name: en.whatsappSettings.templatesLink })).toBeNull();
  });

  it("brands are isolated in the page title", async () => {
    expect.hasAssertions();
    render(await WhatsAppSettingsPage());
    const brand = screen.getByRole("heading", { level: 1 }).querySelector("bdi");
    expect(brand).toHaveAttribute("dir", "auto");
    expect(brand).toHaveTextContent("WhatsApp");
  });

  it("Arabic: the layout is dir=rtl, the phone number stays LTR and copy is Arabic", async () => {
    expect.hasAssertions();
    mocks.locale = "ar";
    render(await WhatsAppSettingsPage());
    const layout = screen.getByTestId("shell").firstElementChild!;
    expect(layout).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("link", { name: ar.whatsappSettings.back })).toBeInTheDocument();
    const phone = screen.getByText("+20 100 123 4567");
    expect(phone.tagName).toBe("BDI");
    expect(phone).toHaveAttribute("dir", "ltr");
  });

  it("English: the layout is dir=ltr", async () => {
    expect.hasAssertions();
    render(await WhatsAppSettingsPage());
    expect(screen.getByTestId("shell").firstElementChild).toHaveAttribute("dir", "ltr");
  });

  it("falls back to the default locale when the cookie holds something else", async () => {
    expect.hasAssertions();
    mocks.locale = "fr";
    render(await WhatsAppSettingsPage());
    expect(screen.getByTestId("shell").firstElementChild).toHaveAttribute("dir", "ltr");
  });

  it.each(["not_connected", "disconnected", "onboarding"] as const)(
    "does not read the templates for a %s shop",
    async (status) => {
      expect.hasAssertions();
      mocks.fetchConnection.mockResolvedValue({ outcome: "ok", data: { ...connection, status } });
      render(await WhatsAppSettingsPage());
      expect(mocks.fetchTemplates).not.toHaveBeenCalled();
    },
  );

  it("does not read the templates when WhatsApp is unavailable", async () => {
    expect.hasAssertions();
    const { signup: _signup, ...rest } = connection;
    mocks.fetchConnection.mockResolvedValue({
      outcome: "ok",
      data: { ...rest, available: false, status: "not_connected" },
    });
    render(await WhatsAppSettingsPage());
    expect(mocks.fetchTemplates).not.toHaveBeenCalled();
    expect(screen.getByRole("note")).toHaveTextContent(en.whatsappSettings.unavailableBody);
  });

  it("an error-state connection still reads the templates", async () => {
    expect.hasAssertions();
    mocks.fetchConnection.mockResolvedValue({
      outcome: "ok",
      data: { ...connection, status: "error", lastError: "AUTHORIZATION_EXPIRED" },
    });
    render(await WhatsAppSettingsPage());
    expect(mocks.fetchTemplates).toHaveBeenCalledTimes(1);
  });

  it("a failed templates read still renders the card", async () => {
    expect.hasAssertions();
    mocks.fetchTemplates.mockResolvedValue({ outcome: "error", message: "boom" });
    render(await WhatsAppSettingsPage());
    expect(screen.getByText("+20 100 123 4567")).toBeInTheDocument();
  });

  it("answers unauthorized with a sign-in note and a load failure with a retry note", async () => {
    expect.hasAssertions();
    mocks.fetchConnection.mockResolvedValue({ outcome: "unauthorized" });
    render(await WhatsAppSettingsPage());
    expect(screen.getByRole("note")).toHaveTextContent(en.whatsappSettings.unauthorized);
    cleanup();
    mocks.fetchConnection.mockResolvedValue({ outcome: "error", message: "provider text" });
    render(await WhatsAppSettingsPage());
    expect(screen.getByRole("note")).toHaveTextContent(en.whatsappSettings.loadError);
    expect(document.body).not.toHaveTextContent("provider text");
  });
});
