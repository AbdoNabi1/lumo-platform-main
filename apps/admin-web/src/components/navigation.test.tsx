import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { salesChannelNav } from "./navigation";
import { SidebarNav } from "./sidebar-nav";

describe("salesChannelNav (Plan 3C)", () => {
  it("has no storefront link when the address is unset or blank — never a localhost guess", () => {
    expect(salesChannelNav(null)).toEqual([]);
    expect(salesChannelNav(undefined)).toEqual([]);
    expect(salesChannelNav("   ")).toEqual([]);
  });

  it("links the storefront at the configured address, opening outside the admin", () => {
    const [item, ...rest] = salesChannelNav(" https://shop.example.com ");

    expect(rest).toEqual([]);
    expect(item).toMatchObject({
      id: "storefront",
      href: "https://shop.example.com",
      external: true,
    });
  });
});

describe("SidebarNav sales channels (Plan 3C)", () => {
  function renderNav(storefrontUrl: string | null) {
    return render(
      <SidebarNav t={en} locale="en" activeId="dashboard" storefrontUrl={storefrontUrl} />,
    );
  }

  it("shows the storefront link when an address is configured", () => {
    renderNav("https://shop.example.com");

    const link = screen.getByRole("link", { name: new RegExp(en.nav.storefront) });
    expect(link).toHaveAttribute("href", "https://shop.example.com");
    expect(screen.getByRole("navigation", { name: en.nav.salesChannels })).toBeInTheDocument();
  });

  it("hides the whole sales channels group when none is configured", () => {
    renderNav(null);

    expect(screen.queryByRole("link", { name: new RegExp(en.nav.storefront) })).toBeNull();
    expect(screen.queryByRole("navigation", { name: en.nav.salesChannels })).toBeNull();
  });
});
