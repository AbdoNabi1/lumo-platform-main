import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { WhatsAppConnectionDto } from "@/lib/api/outreach";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({ locale: "en" as string | undefined, fetchConnection: vi.fn() }));
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main data-testid="shell">{children}</main>,
}));
vi.mock("@/lib/api/outreach", () => ({ fetchWhatsAppConnection: mocks.fetchConnection }));
vi.mock("@/app/settings/whatsapp/templates/actions", () => ({ createTemplateAction: vi.fn() }));
const { default: NewTemplatePage } = await import("./page");

const connected: WhatsAppConnectionDto = {
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
};

beforeEach(() => {
  cleanup();
  mocks.locale = "en";
  mocks.fetchConnection.mockReset().mockResolvedValue({ outcome: "ok", data: connected });
});

describe("Settings → WhatsApp → Templates → New page", () => {
  it("renders the form and the preview with a way back to the list", async () => {
    expect.hasAssertions();
    render(await NewTemplatePage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      en.whatsappTemplates.form.title,
    );
    expect(screen.getByLabelText(en.whatsappTemplates.form.body)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: en.whatsappTemplates.preview.title }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: en.whatsappTemplates.form.back })[0],
    ).toHaveAttribute("href", "/settings/whatsapp/templates");
  });

  it("without an active connection it explains and offers no form", async () => {
    expect.hasAssertions();
    mocks.fetchConnection.mockResolvedValue({
      outcome: "ok",
      data: { ...connected, status: "disconnected" },
    });
    render(await NewTemplatePage());
    expect(
      screen.getByRole("heading", { level: 2, name: en.whatsappTemplates.notConnectedTitle }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(en.whatsappTemplates.form.body)).toBeNull();
  });

  it("shows the sign-in note when unauthorized", async () => {
    expect.hasAssertions();
    mocks.fetchConnection.mockResolvedValue({ outcome: "unauthorized" });
    render(await NewTemplatePage());
    expect(screen.getByRole("note")).toHaveTextContent(en.whatsappTemplates.unauthorized);
  });

  it("renders Arabic copy and an Arabic default language", async () => {
    expect.hasAssertions();
    mocks.locale = "ar";
    render(await NewTemplatePage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      ar.whatsappTemplates.form.title,
    );
    expect(screen.getByLabelText(ar.whatsappTemplates.form.language)).toHaveValue("ar");
  });
});
