import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { SETTINGS_NAV_ITEMS, SettingsNav } from "./settings-nav";

afterEach(cleanup);

const EXPECTED = [
  ["general", "General", "/settings/general"],
  ["plan", "Plan", "/settings/billing"],
  ["billing", "Billing", "/settings/billing"],
  ["users", "Users and permissions", "/settings/users"],
  ["payments", "Payments", "/settings/payments"],
  ["checkout", "Checkout", "/settings/checkout"],
  ["customer-accounts", "Customer accounts", "/settings/customer-accounts"],
  ["shipping", "Shipping and delivery", "/settings/shipping"],
  ["taxes", "Taxes and duties", "/settings/taxes"],
  ["locations", "Locations", "/inventory"],
  ["markets", "Markets", "/settings/markets"],
  ["apps", "Apps and sales channels", "/settings/apps"],
  ["domains", "Domains", "/settings/domains"],
  ["customer-events", "Customer events", "/settings/customer-events"],
  ["notifications", "Notifications", "/settings/notifications"],
  ["custom-data", "Metafields and metaobjects", "/settings/custom-data"],
  ["languages", "Languages", "/locales"],
  ["customer-privacy", "Customer privacy", "/settings/customer-privacy"],
  ["policies", "Policies", "/settings/policies"],
] as const;

const UNAVAILABLE = [
  "checkout",
  "customer-accounts",
  "markets",
  "apps",
  "customer-events",
  "notifications",
  "custom-data",
  "customer-privacy",
];

function labelOf(link: HTMLElement): string | null | undefined {
  return link.querySelector("span")?.textContent;
}

describe("SettingsNav", () => {
  it("defines Shopify's 19 entries with the exact ids, labels and hrefs, in order", () => {
    expect.hasAssertions();
    expect(SETTINGS_NAV_ITEMS.map((item) => [item.id, item.label(en), item.href] as const)).toEqual(
      EXPECTED,
    );
    expect(SETTINGS_NAV_ITEMS.filter((item) => !item.available).map((item) => item.id)).toEqual(
      UNAVAILABLE,
    );
  });

  it("renders 19 links in the table order", () => {
    expect.hasAssertions();
    render(<SettingsNav t={en} />);
    const nav = screen.getByRole("navigation", { name: en.settingsNav.label });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(19);
    expect(links.map(labelOf)).toEqual(EXPECTED.map(([, label]) => label));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      EXPECTED.map(([, , href]) => href),
    );
  });

  it("marks both Plan and Billing current when activeId is billing", () => {
    expect.hasAssertions();
    render(<SettingsNav t={en} activeId="billing" />);
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map(labelOf);
    expect(current).toEqual(["Plan", "Billing"]);
  });

  it("marks only General current when activeId is general", () => {
    expect.hasAssertions();
    render(<SettingsNav t={en} activeId="general" />);
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current"))
      .map(labelOf);
    expect(current).toEqual(["General"]);
  });

  it("marks nothing current without an activeId", () => {
    expect.hasAssertions();
    render(<SettingsNav t={en} />);
    expect(screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"))).toEqual(
      [],
    );
  });

  it("marks Languages current for the /locales screen", () => {
    expect.hasAssertions();
    render(<SettingsNav t={en} activeId="languages" />);
    expect(screen.getByRole("link", { name: "Languages" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the Soon badge on unavailable entries only", () => {
    expect.hasAssertions();
    render(<SettingsNav t={en} />);
    const withBadge = screen
      .getAllByRole("link")
      .filter((link) => within(link).queryByText(en.settingsNav.soon) !== null);
    expect(withBadge).toHaveLength(UNAVAILABLE.length);
    expect(withBadge.map((link) => link.getAttribute("href"))).toEqual(
      UNAVAILABLE.map((id) => `/settings/${id}`),
    );
    expect(screen.getByRole("link", { name: "General" })).not.toHaveTextContent(
      en.settingsNav.soon,
    );
  });

  it("takes its labels from ar.settingsNav and uses no physical-side classes", () => {
    expect.hasAssertions();
    const { container } = render(<SettingsNav t={ar} activeId="billing" />);
    const nav = screen.getByRole("navigation", { name: ar.settingsNav.label });
    expect(within(nav).getAllByRole("link").map(labelOf)).toEqual([
      ar.settingsNav.general,
      ar.settingsNav.plan,
      ar.settingsNav.billing,
      ar.settingsNav.users,
      ar.settingsNav.payments,
      ar.settingsNav.checkout,
      ar.settingsNav.customerAccounts,
      ar.settingsNav.shipping,
      ar.settingsNav.taxes,
      ar.settingsNav.locations,
      ar.settingsNav.markets,
      ar.settingsNav.apps,
      ar.settingsNav.domains,
      ar.settingsNav.customerEvents,
      ar.settingsNav.notifications,
      ar.settingsNav.customData,
      ar.settingsNav.languages,
      ar.settingsNav.customerPrivacy,
      ar.settingsNav.policies,
    ]);
    expect(within(nav).getAllByText(ar.settingsNav.soon)).toHaveLength(UNAVAILABLE.length);
    const classes = Array.from(container.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ")
      .split(/\s+/);
    expect(classes.filter((cls) => /(^|:)(ml|mr|pl|pr|left|right)-/.test(cls))).toEqual([]);
  });
});
