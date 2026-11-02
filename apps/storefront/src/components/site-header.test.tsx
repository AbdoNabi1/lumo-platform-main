import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
