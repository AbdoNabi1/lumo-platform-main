import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { WhatsAppConnectionDto, WhatsAppTemplateRowDto } from "@/lib/api/outreach";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  locale: "en" as string | undefined,
  fetchConnection: vi.fn(),
  fetchRows: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (mocks.locale === undefined ? undefined : { value: mocks.locale }),
    }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    "aria-current": ariaCurrent,
  }: {
    children: ReactNode;
    href: string;
    "aria-current"?: "page";
  }) => (
    <a href={href} aria-current={ariaCurrent}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, locale }: { children: ReactNode; locale: string }) => (
    <main data-testid="shell" dir={locale === "ar" ? "rtl" : "ltr"}>
      {children}
    </main>
  ),
}));
vi.mock("@/lib/api/outreach", () => ({
  fetchWhatsAppConnection: mocks.fetchConnection,
  fetchWhatsAppTemplateRows: mocks.fetchRows,
}));
vi.mock("@/app/settings/whatsapp/templates/actions", () => ({
  syncTemplatesAction: vi.fn(),
  deleteTemplateAction: vi.fn(),
}));
vi.mock("@/app/settings/whatsapp/actions", () => ({}));
const { default: TemplatesPage } = await import("./page");

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
const rows: WhatsAppTemplateRowDto[] = [
  {
    name: "order_update",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    rejectedReason: null,
    variableCount: 0,
    supported: true,
    sendShape: { bodyVariableCount: 0, headerHasVariable: false, buttons: [] },
  },
];

/** Every text node that names a brand without being the content of a `<bdi dir="auto">` (A6). */
function bareBrandText(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const bare: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!/\b(WhatsApp|Meta)\b/.test(text)) continue;
    const parent = node.parentElement;
    if (!(parent?.tagName === "BDI" && parent.getAttribute("dir") === "auto")) bare.push(text);
  }
  return bare;
}

/**
 * The page's own layout wrapper (the element holding the header and the content). It sits inside the settings frame,
 * which is the shell's first child since the pages render within `SettingsFrame`.
 */
function pageLayout(): HTMLElement {
  return screen.getByRole("heading", { level: 1 }).closest("header")!.parentElement!;
}

beforeEach(() => {
  cleanup();
  mocks.locale = "en";
  mocks.fetchConnection.mockReset().mockResolvedValue({ outcome: "ok", data: connected });
  mocks.fetchRows.mockReset().mockResolvedValue({ outcome: "ok", data: rows });
});

describe("Settings → WhatsApp → Templates page", () => {
  it("renders the table inside the settings layout, with a way back", async () => {
    expect.hasAssertions();
    render(await TemplatesPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Message templates");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("order_update")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: new RegExp(en.whatsappTemplates.back) }),
    ).toHaveAttribute("href", "/settings/whatsapp");
    expect(screen.getByRole("link", { name: /New template/ })).toHaveAttribute(
      "href",
      "/settings/whatsapp/templates/new",
    );
  });

  it("checks the connection, then reads the templates of the active account", async () => {
    expect.hasAssertions();
    render(await TemplatesPage());
    expect(mocks.fetchConnection).toHaveBeenCalledTimes(1);
    expect(mocks.fetchRows).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not_connected", { ...connected, status: "not_connected" }],
    ["disconnected", { ...connected, status: "disconnected" }],
    ["onboarding", { ...connected, status: "onboarding" }],
    ["unavailable", { ...connected, available: false }],
  ])("when %s: explains, links to the connection and reads no templates", async (_name, data) => {
    expect.hasAssertions();
    mocks.fetchConnection.mockResolvedValue({ outcome: "ok", data });
    render(await TemplatesPage());
    expect(
      screen.getByRole("heading", { level: 2, name: en.whatsappTemplates.notConnectedTitle }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("link", { name: en.whatsappTemplates.goToConnection })).toHaveAttribute(
      "href",
      "/settings/whatsapp",
    );
    expect(mocks.fetchRows).not.toHaveBeenCalled();
  });

  it("shows the sign-in note when unauthorized and a retry note when the API failed", async () => {
    expect.hasAssertions();
    mocks.fetchConnection.mockResolvedValue({ outcome: "unauthorized" });
    render(await TemplatesPage());
    expect(screen.getByRole("note")).toHaveTextContent(en.whatsappTemplates.unauthorized);
    cleanup();
    mocks.fetchConnection.mockResolvedValue({ outcome: "ok", data: connected });
    mocks.fetchRows.mockResolvedValue({ outcome: "error", message: "boom" });
    render(await TemplatesPage());
    expect(screen.getByRole("note")).toHaveTextContent(en.whatsappTemplates.loadError);
    expect(document.body).not.toHaveTextContent("boom");
  });

  it("renders Arabic in an RTL shell", async () => {
    expect.hasAssertions();
    mocks.locale = "ar";
    render(await TemplatesPage());
    expect(screen.getByTestId("shell")).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(ar.whatsappTemplates.title);
    expect(document.body).not.toHaveTextContent(en.whatsappTemplates.title);
  });

  it("non-disclosure: no business-account or phone-number id reaches document.body", async () => {
    expect.hasAssertions();
    mocks.fetchRows.mockResolvedValue({
      outcome: "ok",
      data: [{ ...rows[0], wabaId: "987654321", phoneNumberId: "123456789" }],
    });
    render(await TemplatesPage());
    expect(document.body).not.toHaveTextContent("987654321");
    expect(document.body).not.toHaveTextContent("123456789");
  });

  it("brand names are isolated in the title, the subtitle and the not-connected explanation (A6)", async () => {
    expect.hasAssertions();
    render(await TemplatesPage());
    expect(document.body.textContent).toContain("WhatsApp");
    expect(bareBrandText()).toEqual([]);
    cleanup();
    mocks.fetchConnection.mockResolvedValue({
      outcome: "ok",
      data: { ...connected, status: "disconnected" },
    });
    render(await TemplatesPage());
    expect(document.body.textContent).toContain("WhatsApp");
    expect(bareBrandText()).toEqual([]);
  });
});

describe("TemplatesPage inside the settings frame", () => {
  it("renders within the settings navigation with its entry current, and the page after the navigation", async () => {
    expect.hasAssertions();
    render(await TemplatesPage());
    const nav = screen.getByRole("navigation", { name: en.settingsNav.label });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual(["/settings/whatsapp"]);
    expect(current.map((link) => link.textContent)).toEqual([en.settingsNav.whatsapp]);
    expect(
      nav.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(pageLayout()).toHaveAttribute("dir", "ltr");
  });

  it("renders the Arabic navigation beside the RTL page, with the entry current", async () => {
    expect.hasAssertions();
    mocks.locale = "ar";
    render(await TemplatesPage());
    const nav = screen.getByRole("navigation", { name: ar.settingsNav.label });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual([ar.settingsNav.whatsapp]);
    expect(pageLayout()).toHaveAttribute("dir", "rtl");
  });
});
