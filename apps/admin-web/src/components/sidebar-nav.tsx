import type { ReactNode } from "react";
import Link from "next/link";
import { EyeIcon } from "lucide-react";
import { cn, focusRingInset } from "@platform/ui";
import {
  ONLINE_STORE_NAV,
  PLATFORM_TOOLS_NAV,
  PRIMARY_NAV,
  SETTINGS_NAV,
  isInSection,
  storefrontHref,
  type NavItem,
} from "./navigation";
import type { Dictionary } from "@/messages/en";
import type { Locale } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";

interface NavLinkProps {
  readonly item: NavItem;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly activeId: string;
  /** Tablet rail: labels collapse to icons, so the accessible name moves to `title`/`aria-label`. */
  readonly collapsible: boolean;
  /** Rendered at the end of the row, beside the link (Online Store's "View your store"). */
  readonly trailing?: ReactNode;
}

const rowBase = cn(
  "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm",
  "duration-(--duration-fast) transition-[background-color,color] ease-out",
  focusRingInset,
);

/**
 * One top-level item and, while its section is open, its sub-pages underneath — Shopify's nested
 * navigation. The section's own page is highlighted; on a sub-page the sub-page is highlighted and
 * the section's label stays bold so the merchant still sees where they are.
 */
function NavLink({ item, t, locale, activeId, collapsible, trailing }: NavLinkProps) {
  const label = item.label(t);
  const { Icon } = item;
  const active = item.id === activeId || (item.sectionIds ?? []).includes(activeId);
  const open = isInSection(item, activeId);
  const children = item.children ?? [];

  return (
    <li>
      <div className="flex items-center gap-1">
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            rowBase,
            "flex-1 font-medium",
            active
              ? "bg-card text-foreground font-semibold shadow-sm"
              : open
                ? "text-foreground hover:bg-card/60 font-semibold"
                : "text-secondary-foreground hover:bg-card/60 hover:text-foreground",
            collapsible && "max-lg:justify-center max-lg:px-2 lg:justify-start",
          )}
        >
          <Icon className="size-[18px] shrink-0" aria-hidden="true" />
          <span className={cn("flex-1 truncate", collapsible && "max-lg:sr-only")}>{label}</span>

          {item.badge !== undefined && (
            <span
              className={cn(
                "bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                collapsible && "max-lg:sr-only",
              )}
            >
              {formatNumber(locale, item.badge)}
            </span>
          )}
        </Link>
        {trailing}
      </div>

      {open && children.length > 0 && (
        <ul className={cn("mt-0.5 flex flex-col gap-0.5", collapsible && "max-lg:hidden")}>
          {children.map((child) => {
            const childActive = child.id === activeId;
            return (
              <li key={child.id}>
                <Link
                  href={child.href}
                  aria-current={childActive ? "page" : undefined}
                  className={cn(
                    rowBase,
                    "ps-[38px]",
                    childActive
                      ? "bg-card text-foreground font-semibold shadow-sm"
                      : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                  )}
                >
                  <span className="flex-1 truncate">{child.label(t)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function GroupHeading({
  label,
  collapsible,
}: {
  readonly label: string;
  readonly collapsible: boolean;
}) {
  return (
    <p
      className={cn(
        "text-muted-foreground px-2.5 pb-1 text-xs font-semibold",
        collapsible && "max-lg:sr-only",
      )}
      aria-hidden="true"
    >
      {label}
    </p>
  );
}

interface SidebarNavProps {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly activeId: string;
  /** True in the tablet rail, false in the mobile drawer (which always shows labels). */
  readonly collapsible?: boolean;
  /** The runtime `STOREFRONT_URL`; `null` hides the "View your store" link. */
  readonly storefrontUrl?: string | null;
  /** The runtime `ADMIN_PLATFORM_TOOLS` switch; lists the platform's engineering screens. */
  readonly showPlatformTools?: boolean;
}

/**
 * The navigation shared by the desktop sidebar, the tablet icon rail, and the mobile drawer, in
 * Shopify's order: the store's sections, the Online Store sales channel, and Settings pinned at the
 * bottom. Each group is a real `<nav>` landmark (a group label is navigation structure, and an
 * `<h2>` here would precede the page's `<h1>`), with `aria-current="page"` on the active item.
 */
export function SidebarNav({
  t,
  locale,
  activeId,
  collapsible = false,
  storefrontUrl = null,
  showPlatformTools = false,
}: SidebarNavProps) {
  const viewStore = storefrontHref(storefrontUrl);
  const renderItem = (item: NavItem, trailing?: ReactNode) => (
    <NavLink
      key={item.id}
      item={item}
      t={t}
      locale={locale}
      activeId={activeId}
      collapsible={collapsible}
      trailing={trailing}
    />
  );

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-3">
      <nav aria-label={t.nav.primary}>
        <ul className="flex flex-col gap-0.5">{PRIMARY_NAV.map((item) => renderItem(item))}</ul>
      </nav>

      <nav aria-label={t.nav.salesChannels} className="flex flex-col">
        <GroupHeading label={t.nav.salesChannels} collapsible={collapsible} />
        <ul className="flex flex-col gap-0.5">
          {renderItem(
            ONLINE_STORE_NAV,
            viewStore === null ? undefined : (
              <a
                href={viewStore}
                target="_blank"
                rel="noreferrer"
                title={t.nav.viewStore}
                className={cn(
                  "text-muted-foreground hover:bg-card/60 hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg",
                  collapsible && "max-lg:hidden",
                  focusRingInset,
                )}
              >
                <EyeIcon className="size-4" aria-hidden="true" />
                <span className="sr-only">
                  {t.nav.viewStore} ({t.nav.opensInNewTab})
                </span>
              </a>
            ),
          )}
        </ul>
      </nav>

      {showPlatformTools && (
        <nav aria-label={t.nav.platformTools} className="flex flex-col">
          <GroupHeading label={t.nav.platformTools} collapsible={collapsible} />
          <ul className="flex flex-col gap-0.5">
            {PLATFORM_TOOLS_NAV.map((item) => renderItem(item))}
          </ul>
        </nav>
      )}

      <nav aria-label={t.nav.settings} className="mt-auto pb-1">
        <ul className="flex flex-col gap-0.5">{renderItem(SETTINGS_NAV)}</ul>
      </nav>
    </div>
  );
}
