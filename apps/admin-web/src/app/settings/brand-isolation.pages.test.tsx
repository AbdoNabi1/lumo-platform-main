import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { WhatsAppConnectionDto, WhatsAppTemplateRowDto } from "@/lib/api/outreach";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

/**
 * A6 sweep over the PAGES (I2): every text node on the Templates, New template and Email pages that names a brand
 * (`WhatsApp`, `Meta`, `Morbeh`) sits in its own `<bdi dir="auto">` — in the unauthorized and load-error states as well
 * as the ready ones, and in BOTH dictionaries. The shell is a passthrough that sets no `dir`, so the page's own
 * direction wrapper is what the test sees.
 */
const mocks = vi.hoisted(() => ({
  locale: "en" as string | undefined,
  fetchConnection: vi.fn(),
  fetchRows: vi.fn(),
  fetchEmail: vi.fn(),
  readSession: vi.fn(),
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/auth/session", () => ({ readSession: mocks.readSession }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main data-testid="shell">{children}</main>,
}));
vi.mock("@/lib/api/outreach", () => ({
  fetchWhatsAppConnection: mocks.fetchConnection,
  fetchWhatsAppTemplateRows: mocks.fetchRows,
  fetchEmailSettings: mocks.fetchEmail,
}));
vi.mock("@/app/settings/whatsapp/templates/actions", () => ({
  syncTemplatesAction: vi.fn(),
  deleteTemplateAction: vi.fn(),
  createTemplateAction: vi.fn(),
}));
vi.mock("@/app/settings/whatsapp/actions", () => ({}));
vi.mock("@/app/settings/email/actions", () => ({ sendTestEmailAction: vi.fn() }));

const { default: TemplatesPage } = await import("./whatsapp/templates/page");
const { default: NewTemplatePage } = await import("./whatsapp/templates/new/page");
const { default: EmailPage } = await import("./email/page");

const BRAND = /\b(WhatsApp|Meta|Morbeh)\b/;

/** The text of every text node that names a brand without being the content of a `<bdi dir="auto">`. */
function bareBrandText(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const bare: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!BRAND.test(text)) continue;
    const parent = node.parentElement;
    const isolated = parent?.tagName === "BDI" && parent.getAttribute("dir") === "auto";
    if (!isolated) bare.push(text);
  }
  return bare;
}

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
const emailAvailable = {
  available: true,
  from: "Nour Store <noreply@mail.example.com>",
  replyTo: "hello@nour.example",
};

const LOCALES = [
  ["en", en],
  ["ar", ar],
] as const;

beforeEach(() => {
  cleanup();
  mocks.locale = "en";
  mocks.fetchConnection.mockReset().mockResolvedValue({ outcome: "ok", data: connected });
  mocks.fetchRows.mockReset().mockResolvedValue({ outcome: "ok", data: rows });
  mocks.fetchEmail.mockReset().mockResolvedValue({ outcome: "ok", data: emailAvailable });
  mocks.readSession.mockReset().mockResolvedValue({ email: "owner@nour.example" });
});

describe.each(LOCALES)("Templates page in %s", (locale, t) => {
  it.each([
    [
      "unauthorized connection",
      { outcome: "unauthorized" },
      null,
      t.whatsappTemplates.unauthorized,
    ],
    ["failed connection", { outcome: "error", message: "x" }, null, t.whatsappTemplates.loadError],
    [
      "unauthorized template list",
      { outcome: "ok", data: connected },
      { outcome: "unauthorized" },
      t.whatsappTemplates.unauthorized,
    ],
    [
      "failed template list",
      { outcome: "ok", data: connected },
      { outcome: "error", message: "x" },
      t.whatsappTemplates.loadError,
    ],
  ] as const)(
    "%s: brand isolated, direction on the page wrapper",
    async (_n, connection, list, note) => {
      expect.hasAssertions();
      mocks.locale = locale;
      mocks.fetchConnection.mockResolvedValue(connection);
      if (list !== null) mocks.fetchRows.mockResolvedValue(list);
      render(await TemplatesPage());
      expect(screen.getByRole("note").textContent).toBe(note);
      if (note === t.whatsappTemplates.unauthorized) {
        expect(document.body.textContent).toContain("WhatsApp");
      }
      expect(bareBrandText()).toEqual([]);
      expect(screen.getByTestId("shell").firstElementChild).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr",
      );
    },
  );

  it("the ready list", async () => {
    expect.hasAssertions();
    mocks.locale = locale;
    render(await TemplatesPage());
    expect(document.body.textContent).toContain("Meta");
    expect(bareBrandText()).toEqual([]);
  });
});

describe.each(LOCALES)("New template page in %s", (locale, t) => {
  it.each([
    ["unauthorized", { outcome: "unauthorized" }, t.whatsappTemplates.unauthorized],
    ["failed", { outcome: "error", message: "x" }, t.whatsappTemplates.loadError],
  ] as const)("%s: brand isolated, direction on the page wrapper", async (_n, connection, note) => {
    expect.hasAssertions();
    mocks.locale = locale;
    mocks.fetchConnection.mockResolvedValue(connection);
    render(await NewTemplatePage());
    expect(screen.getByRole("note").textContent).toBe(note);
    if (note === t.whatsappTemplates.unauthorized) {
      expect(document.body.textContent).toContain("WhatsApp");
    }
    expect(bareBrandText()).toEqual([]);
    expect(screen.getByTestId("shell").firstElementChild).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
  });

  it("the ready form", async () => {
    expect.hasAssertions();
    mocks.locale = locale;
    render(await NewTemplatePage());
    expect(bareBrandText()).toEqual([]);
  });
});

describe.each(LOCALES)("Email page in %s", (locale, t) => {
  it.each([
    ["unauthorized", { outcome: "unauthorized" }, t.emailSettings.unauthorized],
    ["failed", { outcome: "error", message: "x" }, t.emailSettings.loadError],
  ] as const)(
    "%s: the Morbeh subtitle is isolated, direction on the page wrapper",
    async (_n, result, note) => {
      expect.hasAssertions();
      mocks.locale = locale;
      mocks.fetchEmail.mockResolvedValue(result);
      render(await EmailPage());
      expect(screen.getByRole("note").textContent).toBe(note);
      expect(document.body.textContent).toContain("Morbeh");
      expect(bareBrandText()).toEqual([]);
      expect(screen.getByTestId("shell").firstElementChild).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr",
      );
    },
  );

  it("available: subtitle, the 'via Morbeh' sender suffix and the test form", async () => {
    expect.hasAssertions();
    mocks.locale = locale;
    render(await EmailPage());
    expect(document.body.textContent).toContain("Morbeh");
    expect(bareBrandText()).toEqual([]);
  });

  it("unavailable: the explanation that names Morbeh", async () => {
    expect.hasAssertions();
    mocks.locale = locale;
    mocks.fetchEmail.mockResolvedValue({
      outcome: "ok",
      data: { available: false, from: null, replyTo: null },
    });
    render(await EmailPage());
    expect(document.body.textContent).toContain(t.emailSettings.unavailableBody);
    expect(bareBrandText()).toEqual([]);
  });
});
