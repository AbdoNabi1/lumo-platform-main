import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  locale: "en" as string | undefined,
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
vi.mock("@/lib/auth/session", () => ({ readSession: mocks.readSession }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, locale }: { children: ReactNode; locale: string }) => (
    <main data-testid="shell" dir={locale === "ar" ? "rtl" : "ltr"}>
      {children}
    </main>
  ),
}));
vi.mock("@/lib/api/outreach", () => ({ fetchEmailSettings: mocks.fetchEmail }));
vi.mock("@/app/settings/email/actions", () => ({ sendTestEmailAction: vi.fn() }));
const { default: EmailSettingsPage } = await import("./page");

const available = {
  available: true,
  from: "Nour Store <noreply@mail.example.com>",
  replyTo: "hello@nour.example",
};

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
  mocks.fetchEmail.mockReset().mockResolvedValue({ outcome: "ok", data: available });
  mocks.readSession.mockReset().mockResolvedValue({ email: "owner@nour.example" });
});

describe("Settings → Email page", () => {
  it("renders the available state: sender, reply-to, the transactional note and a test form prefilled with the user's email", async () => {
    expect.hasAssertions();
    render(await EmailSettingsPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Email");
    expect(document.body).toHaveTextContent("Nour Store via Morbeh");
    expect(document.body).toHaveTextContent("noreply@mail.example.com");
    expect(document.body).toHaveTextContent("hello@nour.example");
    expect(document.body).toHaveTextContent("Marketing email comes later");
    expect(screen.getByLabelText(en.emailSettings.test.to)).toHaveValue("owner@nour.example");
    expect(screen.getByRole("link", { name: en.emailSettings.back })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByRole("link", { name: en.emailSettings.changeReplyTo })).toHaveAttribute(
      "href",
      "/settings/general",
    );
    const layout = pageLayout();
    expect(layout).toHaveClass("max-w-3xl", "mx-auto");
  });

  it("renders the unavailable state with no test form", async () => {
    expect.hasAssertions();
    mocks.fetchEmail.mockResolvedValue({
      outcome: "ok",
      data: { available: false, from: null, replyTo: null },
    });
    render(await EmailSettingsPage());
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      en.emailSettings.unavailableTitle,
    );
    expect(screen.queryByLabelText(en.emailSettings.test.to)).toBeNull();
    expect(screen.queryByRole("button", { name: en.emailSettings.test.submit })).toBeNull();
  });

  it("leaves the address empty when the session has no email", async () => {
    expect.hasAssertions();
    mocks.readSession.mockResolvedValue(null);
    render(await EmailSettingsPage());
    expect(screen.getByLabelText(en.emailSettings.test.to)).toHaveValue("");
  });

  it("shows the sign-in note when unauthorized and a retry note when the API failed", async () => {
    expect.hasAssertions();
    mocks.fetchEmail.mockResolvedValue({ outcome: "unauthorized" });
    render(await EmailSettingsPage());
    expect(screen.getByRole("note")).toHaveTextContent(en.emailSettings.unauthorized);
    cleanup();
    mocks.fetchEmail.mockResolvedValue({ outcome: "error", message: "provider text" });
    render(await EmailSettingsPage());
    expect(screen.getByRole("note")).toHaveTextContent(en.emailSettings.loadError);
    expect(document.body).not.toHaveTextContent("provider text");
  });

  it("Arabic: the layout is dir=rtl, the copy is Arabic and addresses stay LTR", async () => {
    expect.hasAssertions();
    mocks.locale = "ar";
    render(await EmailSettingsPage());
    expect(screen.getByTestId("shell")).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(ar.emailSettings.title);
    expect(screen.getByLabelText(ar.emailSettings.test.to)).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("noreply@mail.example.com")).toHaveAttribute("dir", "ltr");
    expect(document.body).not.toHaveTextContent(en.emailSettings.transactionalNote);
  });
});

describe("EmailSettingsPage inside the settings frame", () => {
  it("renders within the settings navigation with its entry current, and the page after the navigation", async () => {
    expect.hasAssertions();
    render(await EmailSettingsPage());
    const nav = screen.getByRole("navigation", { name: en.settingsNav.label });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual(["/settings/email"]);
    expect(current.map((link) => link.textContent)).toEqual([en.settingsNav.email]);
    expect(
      nav.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(pageLayout()).toHaveAttribute("dir", "ltr");
  });

  it("renders the Arabic navigation beside the RTL page, with the entry current", async () => {
    expect.hasAssertions();
    mocks.locale = "ar";
    render(await EmailSettingsPage());
    const nav = screen.getByRole("navigation", { name: ar.settingsNav.label });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual([ar.settingsNav.email]);
    expect(pageLayout()).toHaveAttribute("dir", "rtl");
  });
});
