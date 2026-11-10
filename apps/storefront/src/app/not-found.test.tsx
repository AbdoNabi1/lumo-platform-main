import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type * as PlatformUi from "@platform/ui";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";
import { en } from "@/messages/en";

const request = vi.hoisted(() => ({
  shell: null as StorefrontShell | null,
  token: null as string | null,
  lockedView: false,
}));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => request.shell,
  getRequestLocale: async () => "en",
  getPreviewToken: async () => request.token,
  getLockedView: async () => request.lockedView,
}));
vi.mock("@/components/locale-switch", () => ({ LocaleSwitch: () => <span>lang</span> }));
vi.mock("@/components/preview-link-keeper", () => ({ PreviewLinkKeeper: () => null }));
vi.mock("@platform/ui", async (original) => ({
  ...(await original<typeof PlatformUi>()),
  ThemeToggle: () => <span>theme-toggle</span>,
}));
const { default: NotFound } = await import("./not-found");

beforeEach(() => {
  request.lockedView = false;
  request.token = null;
});

const item = (label: string, href: string) => ({
  label: { en: label },
  href,
  external: false,
  children: [],
});

/** A locked shop whose shell names a product and a collection in its menus. */
const lockedShell = (over: Partial<StorefrontShell> = {}): StorefrontShell => ({
  ...FALLBACK_SHELL,
  storeName: "Nour",
  locked: true,
  header: { sticky: false, menu: [item("Secret lamp", "/products/secret-lamp")] },
  footer: {
    ...FALLBACK_SHELL.footer,
    menu: [item("Hidden sale", "/collections/hidden")],
    policies: ["refund"],
  },
  ...over,
});

/** No header menu, search, cart, footer, menus or product names: only the frame. */
function expectNoChrome() {
  expect(screen.queryByRole("contentinfo")).toBeNull();
  expect(screen.queryByRole("search")).toBeNull();
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.queryByText("Secret lamp")).toBeNull();
  expect(screen.queryByText("Hidden sale")).toBeNull();
  expect(screen.queryByText("lang")).toBeNull();
  expect(screen.queryByText("theme-toggle")).toBeNull();
  expect(screen.queryByRole("link", { name: en.nav.cart })).toBeNull();
  expect(screen.getByRole("link", { name: en.locked.enter })).toHaveAttribute("href", "/password");
  expect(screen.getByRole("heading", { level: 1, name: en.notFound.title })).toBeVisible();
}

describe("NotFound (Ruling 23)", () => {
  it("renders inside the shop's own header and footer", async () => {
    request.shell = { ...FALLBACK_SHELL, storeName: "Nour" };
    request.token = null;
    render(await NotFound());
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Nour" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(screen.getByRole("contentinfo")).getByText(en.footer.poweredBy)).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: en.notFound.title })).toBeVisible();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a 404 in a preview keeps ?preview= on the shell links (review M-2)", async () => {
    request.shell = { ...FALLBACK_SHELL, storeName: "Nour", mode: "preview" };
    request.token = "tok";
    render(await NotFound());
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Nour" })).toHaveAttribute(
      "href",
      "/?preview=tok",
    );
    expect(screen.getByRole("status")).toHaveTextContent(en.preview.banner);
  });

  it("a token the shell did not honour is never echoed into links", async () => {
    request.shell = { ...FALLBACK_SHELL, storeName: "Nour", mode: "live", previewExpired: true };
    request.token = "tok";
    render(await NotFound());
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Nour" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("status")).toHaveTextContent(en.preview.expired);
  });
});

describe("NotFound on a locked store (Ruling 5, preflight 7)", () => {
  it("a locked view renders LockedFrame, never StoreChrome (Review Focus 1)", async () => {
    request.lockedView = true;
    request.shell = { ...FALLBACK_SHELL, locked: true, storeName: "Nour" };
    render(await NotFound());
    expectNoChrome();
    expect(screen.getByText("Nour")).toBeVisible();
  });

  it("a locked view with a failed shell read (FALLBACK_SHELL) is still the frame", async () => {
    request.lockedView = true;
    request.shell = FALLBACK_SHELL;
    render(await NotFound());
    expectNoChrome();
    expect(screen.getByText(en.brand)).toBeVisible();
  });

  it("no locked-view header but a locked live shell (/favicon.ico, routing off): the frame", async () => {
    request.shell = lockedShell();
    render(await NotFound());
    expectNoChrome();
  });

  it("the owner's preview of a locked store keeps the chrome", async () => {
    request.shell = lockedShell({ mode: "preview" });
    request.token = "tok";
    render(await NotFound());
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getAllByText("Secret lamp").length).toBeGreaterThan(0);
  });
});
