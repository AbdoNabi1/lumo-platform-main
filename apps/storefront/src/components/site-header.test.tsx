import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type * as PlatformUi from "@platform/ui";
import { FALLBACK_SHELL } from "@/lib/online-store";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";

vi.mock("@/components/locale-switch", () => ({ LocaleSwitch: () => <span>lang</span> }));
vi.mock("@platform/ui", async (original) => ({
  ...(await original<typeof PlatformUi>()),
  ThemeToggle: () => <span>theme-toggle</span>,
}));
const { SiteHeader } = await import("./site-header");

const logo = { url: "https://cdn.test/logo.png", alt: "ignored", width: 800, height: 100 };

describe("SiteHeader (spec 1.12)", () => {
  it("shows the logo with the store name as alt, sized from widthPx, never mirrored", () => {
    render(
      <SiteHeader
        t={ar}
        locale="ar"
        previewToken={null}
        shell={{
          ...FALLBACK_SHELL,
          branded: true,
          storeName: "النور",
          brand: { ...FALLBACK_SHELL.brand, logo: { image: logo, widthPx: 200 } },
        }}
      />,
    );
    const img = screen.getByRole("img", { name: "النور" });
    expect(img).toHaveAttribute("width", "200");
    expect(img).toHaveAttribute("height", "25");
    expect(img.className).not.toMatch(/scale-x|rotate|mirror/);
    expect(img.className).toMatch(/max-h-10/);
    expect(screen.queryByText("theme-toggle")).toBeNull(); // branded ⇒ light only
  });

  it("shows the store name as text without a logo, and the platform brand without a name", () => {
    const { rerender } = render(
      <SiteHeader
        t={en}
        locale="en"
        previewToken={null}
        shell={{ ...FALLBACK_SHELL, storeName: "Nour" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Nour" })).toHaveAttribute("href", "/");
    expect(screen.getByText("theme-toggle")).toBeInTheDocument(); // unbranded keeps the toggle
    rerender(<SiteHeader t={ar} locale="ar" previewToken={null} shell={FALLBACK_SHELL} />);
    expect(screen.getByRole("link", { name: "مربح" })).toBeInTheDocument();
  });

  it("keeps preview on every shell link and in the search form", () => {
    render(<SiteHeader t={en} locale="en" previewToken="tok" shell={FALLBACK_SHELL} />);
    expect(screen.getByRole("link", { name: en.nav.cart })).toHaveAttribute(
      "href",
      "/cart?preview=tok",
    );
    expect(document.querySelector('input[name="preview"]')).toHaveValue("tok");
  });

  it("fits a 375 px screen: wraps below sm with the search on its own row, logo capped (I-1)", () => {
    render(
      <SiteHeader
        t={en}
        locale="en"
        previewToken={null}
        shell={{
          ...FALLBACK_SHELL,
          storeName: "Nour",
          brand: { ...FALLBACK_SHELL.brand, logo: { image: logo, widthPx: 320 } },
        }}
      />,
    );
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("flex-wrap", "sm:flex-nowrap");
    const search = screen.getByRole("search");
    expect(search).toHaveClass("order-last", "w-full", "sm:order-none", "sm:w-auto", "sm:flex-1");
    const home = screen.getByRole("link", { name: "Nour" });
    expect(home).toHaveClass("max-w-[45vw]", "min-w-0", "shrink");
    expect(home).not.toHaveClass("shrink-0");
    // The inline width is only a preference: max-w-full scales it down inside the capped link.
    expect(screen.getByRole("img", { name: "Nour" })).toHaveClass("max-w-full");
  });

  it("labels a logo with no store name as the shop's home, not the platform brand (M-7)", () => {
    render(
      <SiteHeader
        t={en}
        locale="en"
        previewToken={null}
        shell={{
          ...FALLBACK_SHELL,
          brand: { ...FALLBACK_SHELL.brand, logo: { image: logo, widthPx: 140 } },
        }}
      />,
    );
    expect(screen.getByRole("img", { name: en.nav.home })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.nav.home })).toHaveAttribute("href", "/");
    expect(screen.queryByText(en.brand)).toBeNull();
  });

  it("renders a hostile store name as inert, bidi-isolated text (M-3)", () => {
    const rlo = String.fromCodePoint(0x202e);
    const hostile = `</style><script>alert(1)</script>${rlo}evil`;
    render(
      <SiteHeader
        t={en}
        locale="en"
        previewToken={null}
        shell={{ ...FALLBACK_SHELL, storeName: hostile }}
      />,
    );
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("style")).toBeNull();
    const name = screen.getByRole("link", { name: hostile.trim() });
    const isolate = name.querySelector("bdi");
    expect(isolate).toHaveAttribute("dir", "auto");
    expect(isolate?.textContent).toBe(hostile);
  });
});

describe("header navigation (spec 2.8)", () => {
  const shell = {
    ...FALLBACK_SHELL,
    header: {
      sticky: false,
      announcement: null,
      menu: [
        { label: { en: "Home", ar: "الرئيسية" }, href: "/", external: false, children: [] },
        {
          label: { en: "Shop" },
          href: "/collections/all",
          external: false,
          children: [
            { label: { en: "Sale" }, href: "/collections/sale", external: false, children: [] },
          ],
        },
        { label: { en: "WhatsApp" }, href: "https://wa.me/20100", external: true, children: [] },
      ],
    },
  };

  it("desktop: links, a details dropdown for children, and safe external links", () => {
    render(<SiteHeader t={en} locale="en" shell={shell} previewToken={null} />);
    const nav = screen.getByRole("navigation", { name: en.nav.menu });
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    // "Shop" is both the summary and the first link of its own list (the parent stays reachable).
    const summary = within(nav)
      .getAllByText("Shop")
      .map((label) => label.closest("summary"))
      .find((found) => found !== null);
    expect(summary?.parentElement?.tagName).toBe("DETAILS");
    expect(within(nav).getByRole("link", { name: "Shop" })).toHaveAttribute(
      "href",
      "/collections/all",
    );
    expect(within(nav).getByRole("link", { name: "Sale" })).toHaveAttribute(
      "href",
      "/collections/sale",
    );
    const wa = within(nav).getByRole("link", { name: "WhatsApp" });
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("internal links keep the preview token; external ones never carry it", () => {
    render(<SiteHeader t={en} locale="en" shell={shell} previewToken={"T".repeat(43)} />);
    const nav = screen.getByRole("navigation", { name: en.nav.menu });
    expect(within(nav).getByRole("link", { name: "Home" }).getAttribute("href")).toContain(
      "preview=",
    );
    expect(within(nav).getByRole("link", { name: "WhatsApp" }).getAttribute("href")).toBe(
      "https://wa.me/20100",
    );
  });

  it("Arabic labels render isolated; an empty menu renders no navigation", () => {
    render(<SiteHeader t={ar} locale="ar" shell={shell} previewToken={null} />);
    expect(screen.getAllByText("الرئيسية")[0]?.closest("bdi")).toHaveAttribute("dir", "auto");
    cleanup();
    render(<SiteHeader t={en} locale="en" shell={FALLBACK_SHELL} previewToken={null} />);
    expect(screen.queryByRole("navigation", { name: en.nav.menu })).toBeNull();
    expect(screen.queryByRole("button", { name: en.nav.openMenu })).toBeNull();
  });

  it("the mobile trigger comes first in the top row; the desktop nav is its own row", () => {
    render(<SiteHeader t={en} locale="en" shell={shell} previewToken={null} />);
    const banner = screen.getByRole("banner");
    const trigger = within(banner).getByRole("button", { name: en.nav.openMenu });
    const home = within(banner).getAllByRole("link")[0];
    expect(home).toBeDefined();
    expect(
      trigger.compareDocumentPosition(home as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: en.nav.menu });
    expect(banner.contains(nav)).toBe(false);
    expect(nav).toHaveClass("hidden", "md:block");
  });

  it("the drawer's labels come from the dictionary, in Arabic too (review I-2)", () => {
    render(<SiteHeader t={ar} locale="ar" shell={shell} previewToken={null} />);
    fireEvent.click(screen.getByRole("button", { name: ar.nav.openMenu }));
    expect(screen.getByRole("dialog", { name: ar.nav.menu })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.nav.closeMenu })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
