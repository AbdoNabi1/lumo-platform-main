import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type * as PlatformUi from "@platform/ui";
import { signAccessCookie } from "@/lib/access-cookie";
import type * as OnlineStore from "@/lib/online-store";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";
import { currentShopId } from "@/lib/runtime-api";
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
/** Part 1's access read (`GET /public/online-store/access`, no-store) and the cookie jar. */
const access = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/online-store", async (original) => ({
  ...(await original<typeof OnlineStore>()),
  getPublicAccess: access.read,
}));
/** Wave 2a: the header's account icon reads the shop's checkout settings (display only). */
vi.mock("@/lib/checkout-settings", () => ({ getAccountLinkVisible: async () => true }));
const jar = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "morbeh-storefront-access" && jar.cookie !== undefined
        ? { value: jar.cookie }
        : undefined,
  }),
  // A client can send any header on a path the middleware skips: none is trusted here.
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/components/locale-switch", () => ({ LocaleSwitch: () => <span>lang</span> }));
vi.mock("@/components/preview-link-keeper", () => ({ PreviewLinkKeeper: () => null }));
vi.mock("@platform/ui", async (original) => ({
  ...(await original<typeof PlatformUi>()),
  ThemeToggle: () => <span>theme-toggle</span>,
}));
const { default: NotFound } = await import("./not-found");

const SECRET = "s".repeat(32);

beforeEach(() => {
  request.lockedView = false;
  request.token = null;
  jar.cookie = undefined;
  access.read.mockReset();
  access.read.mockResolvedValue({ locked: true, accessVersion: 3, message: {} });
  vi.stubEnv("STOREFRONT_ACCESS_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const cookieFor = async (accessVersion: number, secret = SECRET) =>
  signAccessCookie({
    secret,
    shopId: await currentShopId(),
    accessVersion,
    expUnix: Math.floor(Date.now() / 1000) + 3600,
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
  header: {
    sticky: false,
    menu: [item("Secret lamp", "/products/secret-lamp")],
    announcement: null,
  },
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

  it("a locked shell with an announcement renders no bar (Ruling 25)", async () => {
    request.shell = lockedShell({
      header: {
        sticky: false,
        menu: [],
        announcement: {
          id: "00000000-0000-4000-8000-0000000000a1",
          type: "announcement_bar",
          settings: { text: { en: "Secret sale" }, link: null, style: "dark" },
        },
      },
    });
    render(await NotFound());
    expectNoChrome();
    expect(screen.queryByText("Secret sale")).toBeNull();
    expect(screen.queryByRole("region", { name: en.sections.announcement })).toBeNull();
  });

  it("the owner's preview of a locked store keeps the chrome", async () => {
    request.shell = lockedShell({ mode: "preview" });
    request.token = "tok";
    render(await NotFound());
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getAllByText("Secret lamp").length).toBeGreaterThan(0);
  });
});

describe("NotFound for a visitor holding the unlock cookie (review minor 1)", () => {
  it("a valid cookie, checked on the server against the access version, gets the normal 404", async () => {
    request.shell = lockedShell();
    jar.cookie = await cookieFor(3);
    render(await NotFound());
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getAllByText("Secret lamp").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: en.locked.enter })).toBeNull();
    expect(access.read).toHaveBeenCalledTimes(1);
  });

  it("no cookie is the frame, without asking the Runtime", async () => {
    request.shell = lockedShell();
    render(await NotFound());
    expectNoChrome();
    expect(access.read).not.toHaveBeenCalled();
  });

  it("a forged, malformed or other-shop cookie is the frame", async () => {
    request.shell = lockedShell();
    for (const cookie of [
      await cookieFor(3, "x".repeat(32)),
      "garbage",
      await signAccessCookie({
        secret: SECRET,
        shopId: "shop-other",
        accessVersion: 3,
        expUnix: Math.floor(Date.now() / 1000) + 3600,
      }),
    ]) {
      jar.cookie = cookie;
      const { unmount } = render(await NotFound());
      expectNoChrome();
      unmount();
    }
  });

  it("a stale access version (password changed, re-locked) is the frame", async () => {
    request.shell = lockedShell();
    jar.cookie = await cookieFor(2);
    render(await NotFound());
    expectNoChrome();
  });

  it("a failed, refused or unlocked access read is the frame (fail closed)", async () => {
    request.shell = lockedShell();
    jar.cookie = await cookieFor(3);
    for (const answer of [
      () => access.read.mockRejectedValue(new Error("down")),
      () => access.read.mockResolvedValue(null),
      () => access.read.mockResolvedValue({ locked: false, accessVersion: 3, message: {} }),
    ]) {
      answer();
      const { unmount } = render(await NotFound());
      expectNoChrome();
      unmount();
    }
  });

  it("no secret configured, or no resolvable shop, is the frame", async () => {
    request.shell = lockedShell();
    jar.cookie = await cookieFor(3);
    vi.stubEnv("STOREFRONT_ACCESS_SECRET", "");
    let view = render(await NotFound());
    expectNoChrome();
    view.unmount();
    vi.stubEnv("STOREFRONT_ACCESS_SECRET", SECRET);
    vi.stubEnv("STOREFRONT_HOST_ROUTING", "on"); // no x-shop-id: currentShopId throws
    view = render(await NotFound());
    expectNoChrome();
    view.unmount();
  });

  it("the locked view stays the frame whatever the cookie says", async () => {
    request.lockedView = true;
    request.shell = lockedShell();
    jar.cookie = await cookieFor(3);
    render(await NotFound());
    expectNoChrome();
    expect(access.read).not.toHaveBeenCalled();
  });
});
