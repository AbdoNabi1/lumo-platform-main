import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";
import { cn, focusRingInset } from "@platform/ui";
import { PRIMARY_NAV, SALES_CHANNEL_NAV, type NavItem } from "./navigation";
import type { Dictionary } from "@/messages/en";
import type { Locale } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";

interface NavLinkProps {
  readonly item: NavItem;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly active: boolean;
  /** Tablet rail: labels collapse to icons, so the accessible name moves to `title`/`aria-label`. */
  readonly collapsible: boolean;
}

function NavLink({ item, t, locale, active, collapsible }: NavLinkProps) {
  const label = item.label(t);
  const { Icon } = item;

  // Sales channels open a surface outside the admin app, so they stay plain anchors with an
  // explicit new-tab contract; everything else is in-app and routes client-side.
  const Anchor = item.external === true ? "a" : Link;

  return (
    <li>
      <Anchor
        href={item.href}
        aria-current={active ? "page" : undefined}
        {...(item.external === true ? { target: "_blank", rel: "noreferrer" } : {})}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium",
          "duration-(--duration-fast) transition-[background-color,color] ease-out",
          active
            ? "bg-primary-subtle text-primary-subtle-foreground before:bg-primary before:absolute before:inset-y-1.5 before:start-0 before:w-1 before:rounded-full"
            : "text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
          collapsible && "max-lg:justify-center max-lg:px-2 lg:justify-start",
          focusRingInset,
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden="true" />
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

        {item.external === true && (
          <>
            <ExternalLinkIcon
              className={cn(
                "text-subtle-foreground size-4 shrink-0",
                collapsible && "max-lg:hidden",
              )}
              aria-hidden="true"
            />
            <span className="sr-only"> ({t.nav.opensInNewTab})</span>
          </>
        )}
      </Anchor>
    </li>
  );
}

interface SidebarNavProps {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly activeId: string;
  /** True in the tablet rail, false in the mobile drawer (which always shows labels). */
  readonly collapsible?: boolean;
}

/**
 * The navigation lists shared by the desktop sidebar, the tablet icon rail, and the mobile
 * drawer. Rendered as real `<nav>`/`<ul>` landmarks with `aria-current="page"` on the
 * active item.
 */
export function SidebarNav({ t, locale, activeId, collapsible = false }: SidebarNavProps) {
  const renderItem = (item: NavItem) => (
    <NavLink
      key={item.id}
      item={item}
      t={t}
      locale={locale}
      active={item.id === activeId}
      collapsible={collapsible}
    />
  );

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-3">
      <nav aria-label={t.nav.primary}>
        <ul className="flex flex-col gap-0.5">{PRIMARY_NAV.map(renderItem)}</ul>
      </nav>

      {/*
       * A second landmark rather than a heading inside the first: the group label is
       * navigation structure, and promoting it to an <h2> would put a level-2 heading
       * ahead of the page's <h1> in the document order.
       */}
      <nav aria-label={t.nav.salesChannels} className="flex flex-col gap-0.5">
        <p
          className={cn(
            "text-subtle-foreground px-3 pb-1 text-xs font-medium uppercase tracking-wide",
            collapsible && "max-lg:sr-only",
          )}
          aria-hidden="true"
        >
          {t.nav.salesChannels}
        </p>
        <ul className="flex flex-col gap-0.5">{SALES_CHANNEL_NAV.map(renderItem)}</ul>
      </nav>
    </div>
  );
}
