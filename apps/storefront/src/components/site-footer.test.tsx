import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FALLBACK_SHELL } from "@/lib/online-store";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import { SiteFooter } from "./site-footer";

describe("SiteFooter (spec 1.12)", () => {
  it("renders name, note (dir=auto), only the set social links, copyright and Powered by", () => {
    render(
      <SiteFooter
        t={en}
        locale="en"
        shell={{
          ...FALLBACK_SHELL,
          storeName: "Nour",
          footer: { note: { ar: "توصيل لكل مصر" }, showSocial: true, menu: [], policies: [] },
          brand: { ...FALLBACK_SHELL.brand, social: { instagram: "https://instagram.com/nour" } },
        }}
      />,
    );
    expect(screen.getByText("توصيل لكل مصر").closest("[dir='auto']")).not.toBeNull();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://instagram.com/nour");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[0]).toHaveAccessibleName("Instagram");
    expect(screen.getByText(/©/)).toHaveTextContent(
      new RegExp(`© ${new Date().getFullYear()} Nour`),
    );
    expect(screen.getByText("Powered by Morbeh")).toBeInTheDocument();
  });

  it("formats the year for Arabic and hides social links when turned off", () => {
    render(
      <SiteFooter
        t={ar}
        locale="ar"
        shell={{
          ...FALLBACK_SHELL,
          footer: { note: {}, showSocial: false, menu: [], policies: [] },
          brand: { ...FALLBACK_SHELL.brand, social: { x: "https://x.com/n" } },
        }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    const arabicYear = new Intl.NumberFormat("ar", { useGrouping: false }).format(
      new Date().getFullYear(),
    );
    expect(screen.getByText(/©/)).toHaveTextContent(arabicYear);
    expect(screen.getByText("بدعم من مربح")).toBeInTheDocument();
  });

  it("renders a hostile store name and note as inert, bidi-isolated text (M-3)", () => {
    const rlo = String.fromCodePoint(0x202e);
    const hostile = `</style><script>alert(1)</script>${rlo}evil`;
    render(
      <SiteFooter
        t={en}
        locale="en"
        shell={{
          ...FALLBACK_SHELL,
          storeName: hostile,
          footer: { note: { en: hostile }, showSocial: true, menu: [], policies: [] },
        }}
      />,
    );
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("style")).toBeNull();
    const isolated = [...document.querySelectorAll("bdi")].filter((b) => b.textContent === hostile);
    expect(isolated).toHaveLength(3); // name, note, ©
  });

  it("renders the menu as columns, then the policy links not already in the menu (spec 2.8)", () => {
    render(
      <SiteFooter
        t={en}
        locale="en"
        shell={{
          ...FALLBACK_SHELL,
          footer: {
            note: {},
            showSocial: false,
            menu: [
              { label: { en: "Search" }, href: "/search", external: false, children: [] },
              {
                label: { en: "Returns" },
                href: "/policies/refund-policy",
                external: false,
                children: [],
              },
            ],
            policies: ["refund", "privacy"],
          },
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Links" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
    expect(screen.getAllByRole("link", { name: /Return|Refund/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/policies/privacy-policy",
    );
    expect(screen.getByRole("navigation", { name: en.footer.policies })).toBeInTheDocument();
  });

  it("a parent item is a column titled by it; footer links keep the preview token", () => {
    render(
      <SiteFooter
        t={ar}
        locale="ar"
        previewToken="tok"
        shell={{
          ...FALLBACK_SHELL,
          footer: {
            note: {},
            showSocial: false,
            menu: [
              {
                label: { ar: "المتجر" },
                href: "/collections/all",
                external: false,
                children: [
                  {
                    label: { ar: "تخفيضات" },
                    href: "/collections/sale",
                    external: false,
                    children: [],
                  },
                ],
              },
            ],
            policies: ["terms"],
          },
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "المتجر" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: ar.footer.links })).toBeNull();
    expect(screen.getByRole("link", { name: "تخفيضات" })).toHaveAttribute(
      "href",
      "/collections/sale?preview=tok",
    );
    expect(screen.getByRole("link", { name: "شروط الخدمة" })).toHaveAttribute(
      "href",
      "/policies/terms-of-service?preview=tok",
    );
  });

  it("no menu and no policies: no columns and no policy row", () => {
    render(<SiteFooter t={en} locale="en" shell={FALLBACK_SHELL} />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
