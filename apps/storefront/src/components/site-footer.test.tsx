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
          footer: { note: { ar: "توصيل لكل مصر" }, showSocial: true },
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
          footer: { note: {}, showSocial: false },
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
});
