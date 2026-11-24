import { describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import {
  ONLINE_STORE_NAV,
  PRIMARY_NAV,
  isInSection,
  platformToolsEnabled,
  storefrontHref,
} from "./navigation";
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

describe("Collections in the sidebar (Shopify parity Wave 1a)", () => {
  it("lists Collections first under Products, before Categories and Inventory", () => {
    expect.hasAssertions();
    const products = PRIMARY_NAV.find((item) => item.id === "products")!;
    expect((products.children ?? []).map((child) => child.id).slice(0, 3)).toEqual([
      "collections",
      "categories",
      "inventory",
    ]);
    expect(isInSection(products, "collections")).toBe(true);
    const collections = products.children?.find((child) => child.id === "collections");
    expect(collections?.href).toBe("/collections");
    expect(collections?.label(en)).toBe(en.nav.collections);
  });

  it("shows the Collections link, current, while a collections page is open", () => {
    expect.hasAssertions();
    renderNav("collections");
    expect(screen.getByRole("link", { name: en.nav.collections })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: en.nav.collections })).toHaveAttribute(
      "href",
      "/collections",
    );
    expect(screen.getByRole("link", { name: en.nav.products })).not.toHaveAttribute("aria-current");
  });
});

describe("Segments in the sidebar (Shopify parity Wave 1c)", () => {
  it("gives Customers one child, Segments, at /customers/segments", () => {
    expect.hasAssertions();
    const customers = PRIMARY_NAV.find((item) => item.id === "customers")!;
    expect(customers.href).toBe("/customers");
    expect((customers.children ?? []).map((child) => child.id)).toEqual(["customers-segments"]);
    const segments = customers.children?.[0];
    expect(segments?.href).toBe("/customers/segments");
    expect(segments?.label(en)).toBe("Segments");
    expect(segments?.label(ar)).toBe(ar.nav.segments);
    expect(isInSection(customers, "customers-segments")).toBe(true);
  });

  it("keeps Segments closed until a Customers page is current, then marks it current on its own page", () => {
    expect.hasAssertions();
    renderNav("dashboard");
    expect(screen.queryByRole("link", { name: en.nav.segments })).toBeNull();
    cleanup();

    renderNav("customers-segments");
    const primary = screen.getByRole("navigation", { name: en.nav.primary });
    const segments = within(primary).getByRole("link", { name: en.nav.segments });
    expect(segments).toHaveAttribute("href", "/customers/segments");
    expect(segments).toHaveAttribute("aria-current", "page");
    expect(within(primary).getByRole("link", { name: en.nav.customers })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("opens the section on the customers list, with Customers current", () => {
    expect.hasAssertions();
    renderNav("customers");
    const primary = screen.getByRole("navigation", { name: en.nav.primary });
    expect(within(primary).getByRole("link", { name: en.nav.customers })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(primary).getByRole("link", { name: en.nav.segments })).toBeInTheDocument();
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
      en.nav.growth,
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

  it("puts Themes, Pages, Preferences and SEO under Online Store, in Shopify's order", () => {
    renderNav("online-store-preferences");
    const channels = screen.getByRole("navigation", { name: en.nav.salesChannels });
    expect(within(channels).getByRole("link", { name: en.nav.onlineStore })).toHaveAttribute(
      "href",
      "/online-store/themes",
    );
    const labels = within(channels)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual(
      expect.arrayContaining([en.nav.themes, en.nav.pages, en.nav.preferences, en.nav.seo]),
    );
    expect(within(channels).getByRole("link", { name: en.nav.preferences })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("lists Menus under Content, current on a menu page, and not under Online Store (Shopify parity Wave 1a)", () => {
    expect.hasAssertions();
    renderNav("online-store-navigation");
    const primary = screen.getByRole("navigation", { name: en.nav.primary });
    expect(within(primary).getByRole("link", { name: en.nav.content })).toBeInTheDocument();
    const menus = within(primary).getByRole("link", { name: en.nav.menus });
    expect(menus).toHaveAttribute("href", "/online-store/navigation");
    expect(menus).toHaveAttribute("aria-current", "page");
    const channels = screen.getByRole("navigation", { name: en.nav.salesChannels });
    const hrefs = within(channels)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain("/online-store/navigation");
    expect(within(channels).queryByRole("link", { name: en.nav.menus })).toBeNull();
  });

  it("keeps Menus closed until a Content page is current", () => {
    expect.hasAssertions();
    renderNav("dashboard");
    expect(screen.queryByRole("link", { name: en.nav.menus })).toBeNull();
  });

  it("gives Content the Menus child and takes it out of Online Store's children", () => {
    expect.hasAssertions();
    const content = PRIMARY_NAV.find((item) => item.id === "content")!;
    expect((content.children ?? []).map((child) => child.id)).toEqual([
      "content-files",
      "online-store-navigation",
    ]);
    expect(isInSection(content, "online-store-navigation")).toBe(true);
    expect((ONLINE_STORE_NAV.children ?? []).map((child) => child.id)).not.toContain(
      "online-store-navigation",
    );
    expect((ONLINE_STORE_NAV.children ?? []).map((child) => child.id)).toEqual([
      "online-store-themes",
      "pages",
      "online-store-preferences",
      "seo",
    ]);
  });

  it("labels the marketing item Growth in English and النمو in Arabic, keeping its id and href", () => {
    expect.hasAssertions();
    const marketing = PRIMARY_NAV.find((item) => item.id === "marketing")!;
    expect(marketing.href).toBe("/marketing");
    expect(marketing.label(en)).toBe("Growth");
    expect(marketing.label(ar)).toBe("النمو");
    expect((marketing.children ?? []).map((child) => child.id)).toEqual(["automations"]);
    render(
      <SidebarNav
        t={ar}
        locale="ar"
        activeId="dashboard"
        storefrontUrl={null}
        showPlatformTools={false}
      />,
    );
    const primary = screen.getByRole("navigation", { name: ar.nav.primary });
    expect(within(primary).getByRole("link", { name: "النمو" })).toHaveAttribute(
      "href",
      "/marketing",
    );
  });

  it("names the Menus child القوائم in Arabic and the Files child الملفات", () => {
    expect.hasAssertions();
    const content = PRIMARY_NAV.find((item) => item.id === "content")!;
    const menus = content.children?.find((child) => child.id === "online-store-navigation");
    expect(menus?.label(ar)).toBe("القوائم");
    expect(menus?.label(en)).toBe("Menus");
    const files = content.children?.find((child) => child.id === "content-files");
    expect(files?.href).toBe("/content/files");
    expect(files?.label(ar)).toBe(ar.nav.files);
    expect(files?.label(en)).toBe(en.nav.files);
    expect(ar.nav.files).toBe("الملفات");
    expect(en.nav.files).toBe("Files");
  });

  it("puts Files first under Content and marks it current on its own page", () => {
    expect.hasAssertions();
    const content = PRIMARY_NAV.find((item) => item.id === "content")!;
    expect(content.children?.[0]?.id).toBe("content-files");
    expect(isInSection(content, "content-files")).toBe(true);
    renderNav("content-files");
    const primary = screen.getByRole("navigation", { name: en.nav.primary });
    const files = within(primary).getByRole("link", { name: en.nav.files });
    expect(files).toHaveAttribute("href", "/content/files");
    expect(files).toHaveAttribute("aria-current", "page");
  });

  it("lists the raw theme tokens under Platform tools", () => {
    renderNav("dashboard", { showPlatformTools: true });
    const tools = screen.getByRole("navigation", { name: en.nav.platformTools });
    expect(within(tools).getByRole("link", { name: en.nav.themeTokens })).toHaveAttribute(
      "href",
      "/theme",
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

  it("keeps Promotions out of Discounts and lists it under Platform tools", () => {
    renderNav("discounts");
    expect(screen.queryByRole("link", { name: en.nav.promotions })).toBeNull();

    renderNav("dashboard", { showPlatformTools: true });
    const tools = screen.getByRole("navigation", { name: en.nav.platformTools });
    expect(within(tools).getByRole("link", { name: en.nav.promotions })).toHaveAttribute(
      "href",
      "/promotions",
    );
  });

  it("lists Abandoned checkouts under Orders while an Orders page is current (order operations Part 3)", () => {
    renderNav("orders");
    expect(screen.getByRole("link", { name: en.nav.abandonedCheckouts })).toHaveAttribute(
      "href",
      "/abandoned-checkouts",
    );
  });

  it("marks Abandoned checkouts current on its own pages and keeps Orders in view", () => {
    renderNav("abandoned-checkouts");
    expect(screen.getByRole("link", { name: en.nav.abandonedCheckouts })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: en.nav.orders })).not.toHaveAttribute("aria-current");
  });

  it("marks Drafts current on its own pages and keeps Orders in view (order operations Part 4)", () => {
    renderNav("draft-orders");
    expect(screen.getByRole("link", { name: en.nav.drafts })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: en.nav.drafts })).toHaveAttribute(
      "href",
      "/draft-orders",
    );
    expect(screen.getByRole("link", { name: en.nav.orders })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: en.nav.abandonedCheckouts })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("Orders' sub-pages are Drafts, then Part 3's Abandoned checkouts", () => {
    expect(PRIMARY_NAV.find((item) => item.id === "orders")?.children?.map((c) => c.id)).toEqual([
      "draft-orders",
      "abandoned-checkouts",
    ]);
  });
});

describe("Orders children (Shopify order)", () => {
  it("lists Drafts, then Abandoned checkouts", () => {
    const orders = PRIMARY_NAV.find((item) => item.id === "orders");
    expect(orders?.children?.map((child) => child.href)).toEqual([
      "/draft-orders",
      "/abandoned-checkouts",
    ]);
  });
});
