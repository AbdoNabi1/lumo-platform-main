import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { PRIMARY_NAV, isInSection, platformToolsEnabled, storefrontHref } from "./navigation";
import { SidebarNav } from "./sidebar-nav";

function renderNav(
  activeId: string,
  options: { storefrontUrl?: string | null; showPlatformTools?: boolean } = {},
) {
  return render(
    <SidebarNav
      t={en}
      locale="en"
      activeId={activeId}
      storefrontUrl={options.storefrontUrl ?? null}
      showPlatformTools={options.showPlatformTools ?? false}
    />,
  );
}

describe("storefrontHref (Plan 3C)", () => {
  it("is null when the address is unset or blank — never a localhost guess", () => {
    expect(storefrontHref(null)).toBeNull();
    expect(storefrontHref(undefined)).toBeNull();
    expect(storefrontHref("   ")).toBeNull();
  });

  it("is the configured address, trimmed", () => {
    expect(storefrontHref(" https://shop.example.com ")).toBe("https://shop.example.com");
  });
});

describe("platformToolsEnabled", () => {
  it("is on only for 1 or true", () => {
    expect(platformToolsEnabled("1")).toBe(true);
    expect(platformToolsEnabled("TRUE")).toBe(true);
    expect(platformToolsEnabled(undefined)).toBe(false);
    expect(platformToolsEnabled("0")).toBe(false);
    expect(platformToolsEnabled("")).toBe(false);
  });
});

describe("isInSection", () => {
  const products = PRIMARY_NAV.find((item) => item.id === "products")!;

  it("covers the section, its sub-pages and its other pages", () => {
    expect(isInSection(products, "products")).toBe(true);
    expect(isInSection(products, "inventory")).toBe(true);
    expect(isInSection(products, "pricing")).toBe(true);
    expect(isInSection(products, "orders")).toBe(false);
  });
});

describe("SidebarNav (Shopify layout)", () => {
  it("lists the merchant's sections in Shopify's order", () => {
    renderNav("dashboard");

    const primary = screen.getByRole("navigation", { name: en.nav.primary });
    const labels = within(primary)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual([
      en.nav.dashboard,
      en.nav.orders,
      en.nav.products,
      en.nav.customers,
      en.nav.marketing,
      en.nav.discounts,
      en.nav.content,
      en.nav.finance,
      en.nav.analytics,
    ]);
  });

  it("opens a section's sub-pages only while one of its pages is current", () => {
    renderNav("dashboard");
    expect(screen.queryByRole("link", { name: en.nav.inventory })).toBeNull();
  });

  it("marks the current sub-page and keeps its section's label in view", () => {
    renderNav("inventory");

    expect(screen.getByRole("link", { name: en.nav.inventory })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: en.nav.products })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: en.nav.categories })).toBeInTheDocument();
  });

  it("puts Theme, Pages and SEO under the Online Store sales channel", () => {
    renderNav("pages");

    const channels = screen.getByRole("navigation", { name: en.nav.salesChannels });
    expect(within(channels).getByRole("link", { name: en.nav.onlineStore })).toBeInTheDocument();
    expect(within(channels).getByRole("link", { name: en.nav.pages })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("highlights Settings for the languages screen", () => {
    renderNav("locales");

    const settings = screen.getByRole("navigation", { name: en.nav.settings });
    expect(within(settings).getByRole("link", { name: en.nav.settings })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows View your store when an address is configured, and nothing otherwise", () => {
    renderNav("dashboard", { storefrontUrl: "https://shop.example.com" });
    expect(screen.getByRole("link", { name: new RegExp(en.nav.viewStore) })).toHaveAttribute(
      "href",
      "https://shop.example.com",
    );
  });

  it("has no View your store link without an address", () => {
    renderNav("dashboard");
    expect(screen.queryByRole("link", { name: new RegExp(en.nav.viewStore) })).toBeNull();
  });

  it("keeps the platform's engineering screens out of the menu unless turned on", () => {
    renderNav("dashboard");
    expect(screen.queryByRole("navigation", { name: en.nav.platformTools })).toBeNull();
    expect(screen.queryByRole("link", { name: en.nav.featureFlags })).toBeNull();
  });

  it("lists the engineering screens under Platform tools when turned on", () => {
    renderNav("dashboard", { showPlatformTools: true });

    const tools = screen.getByRole("navigation", { name: en.nav.platformTools });
    expect(within(tools).getByRole("link", { name: en.nav.featureFlags })).toBeInTheDocument();
    expect(within(tools).getByRole("link", { name: en.nav.security })).toBeInTheDocument();
  });
});
