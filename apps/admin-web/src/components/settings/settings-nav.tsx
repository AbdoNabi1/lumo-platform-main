import Link from "next/link";
import { Badge, cn, focusRingInset } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

export interface SettingsNavItem {
  /** Matches the `activeId` a settings page passes to `SettingsFrame`. */
  readonly id: string;
  readonly label: (t: Dictionary) => string;
  readonly href: string;
  /** False for sections Morbeh does not have yet: they still link, to a coming-soon page. */
  readonly available: boolean;
}

/** Shopify's 19 settings entries, in Shopify's order (Plan and Billing share Morbeh's one page). */
export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "general",
    label: (t) => t.settingsNav.general,
    href: "/settings/general",
    available: true,
  },
  { id: "plan", label: (t) => t.settingsNav.plan, href: "/settings/billing", available: true },
  {
    id: "billing",
    label: (t) => t.settingsNav.billing,
    href: "/settings/billing",
    available: true,
  },
  { id: "users", label: (t) => t.settingsNav.users, href: "/settings/users", available: true },
  {
    id: "payments",
    label: (t) => t.settingsNav.payments,
    href: "/settings/payments",
    available: true,
  },
  {
    id: "checkout",
    label: (t) => t.settingsNav.checkout,
    href: "/settings/checkout",
    available: true,
  },
  {
    id: "customer-accounts",
    label: (t) => t.settingsNav.customerAccounts,
    href: "/settings/customer-accounts",
    available: true,
  },
  {
    id: "shipping",
    label: (t) => t.settingsNav.shipping,
    href: "/settings/shipping",
    available: true,
  },
  { id: "taxes", label: (t) => t.settingsNav.taxes, href: "/settings/taxes", available: true },
  { id: "locations", label: (t) => t.settingsNav.locations, href: "/inventory", available: true },
  {
    id: "markets",
    label: (t) => t.settingsNav.markets,
    href: "/settings/markets",
    available: false,
  },
  { id: "apps", label: (t) => t.settingsNav.apps, href: "/settings/apps", available: false },
  {
    id: "domains",
    label: (t) => t.settingsNav.domains,
    href: "/settings/domains",
    available: true,
  },
  {
    id: "customer-events",
    label: (t) => t.settingsNav.customerEvents,
    href: "/settings/customer-events",
    available: false,
  },
  {
    id: "notifications",
    label: (t) => t.settingsNav.notifications,
    href: "/settings/notifications",
    available: true,
  },
  {
    id: "custom-data",
    label: (t) => t.settingsNav.customData,
    href: "/settings/custom-data",
    available: false,
  },
  { id: "languages", label: (t) => t.settingsNav.languages, href: "/locales", available: true },
  {
    id: "customer-privacy",
    label: (t) => t.settingsNav.customerPrivacy,
    href: "/settings/customer-privacy",
    available: false,
  },
  {
    id: "policies",
    label: (t) => t.settingsNav.policies,
    href: "/settings/policies",
    available: true,
  },
];

/** Plan and Billing are one Morbeh page, so both entries are current on it. */
function isActive(item: SettingsNavItem, activeId: string | undefined): boolean {
  if (activeId === undefined) return false;
  return item.id === activeId || (activeId === "billing" && item.id === "plan");
}

/**
 * The Settings sub-navigation, shown beside every settings page. Entries Morbeh lacks still link
 * (to a coming-soon page) and carry a "Soon" badge; the current page's entry has
 * `aria-current="page"`.
 */
export function SettingsNav({
  t,
  activeId,
}: {
  readonly t: Dictionary;
  readonly activeId?: string | undefined;
}) {
  return (
    <nav aria-label={t.settingsNav.label}>
      <ul className="grid grid-cols-2 gap-0.5 sm:grid-cols-3 lg:flex lg:flex-col">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const active = isActive(item, activeId);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm",
                  "duration-(--duration-fast) transition-[background-color,color] ease-out",
                  focusRingInset,
                  active
                    ? "bg-card text-foreground font-semibold shadow-sm"
                    : "text-secondary-foreground hover:bg-card/60 hover:text-foreground",
                )}
              >
                <span className="flex-1 truncate">{item.label(t)}</span>
                {item.available ? null : <Badge>{t.settingsNav.soon}</Badge>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
