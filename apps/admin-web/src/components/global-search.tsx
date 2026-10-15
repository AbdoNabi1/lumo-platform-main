"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CommandSearch, CommandSearchTrigger, type CommandGroup } from "@platform/ui";
import {
  ONLINE_STORE_NAV,
  PLATFORM_TOOLS_NAV,
  PRIMARY_NAV,
  SETTINGS_NAV,
  storefrontHref,
  type NavItem,
} from "./navigation";
import type { Dictionary } from "@/messages/en";

/**
 * The admin's global search. Opens on Ctrl/⌘+K as well as by click, and indexes the
 * navigation surface today — the `groups` shape is what a real search backend would fill
 * in (orders, products, customers) without touching this component's behaviour.
 */
export function GlobalSearch({
  t,
  className,
  storefrontUrl = null,
  showPlatformTools = false,
}: {
  readonly t: Dictionary;
  readonly className?: string;
  /** The runtime `STOREFRONT_URL`; `null` leaves the storefront out of the results. */
  readonly storefrontUrl?: string | null;
  /** The runtime `ADMIN_PLATFORM_TOOLS` switch; leaves the engineering screens out when off. */
  readonly showPlatformTools?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const groups: readonly CommandGroup[] = React.useMemo(() => {
    // Every page the sidebar can reach, sub-pages included, so "Inventory" is one search away
    // even while the Products section is closed.
    const flatten = (items: readonly NavItem[]) =>
      items.flatMap((item) => [item, ...(item.children ?? [])]);
    const toCommand = (item: NavItem) => ({
      id: item.id,
      label: item.label(t),
      Icon: item.Icon,
      onSelect: () => {
        router.push(item.href);
      },
    });
    const viewStore = storefrontHref(storefrontUrl);

    return [
      {
        id: "primary",
        heading: t.nav.primary,
        items: flatten([...PRIMARY_NAV, SETTINGS_NAV]).map(toCommand),
      },
      {
        id: "channels",
        heading: t.nav.salesChannels,
        items: [
          ...flatten([ONLINE_STORE_NAV])
            .filter((item) => item.id !== ONLINE_STORE_NAV.id)
            .map(toCommand),
          ...(viewStore === null
            ? []
            : [
                {
                  id: "view-store",
                  label: t.nav.viewStore,
                  Icon: ONLINE_STORE_NAV.Icon,
                  onSelect: () => {
                    window.open(viewStore, "_blank", "noreferrer");
                  },
                },
              ]),
        ],
      },
      ...(showPlatformTools
        ? [
            {
              id: "platform-tools",
              heading: t.nav.platformTools,
              items: PLATFORM_TOOLS_NAV.map(toCommand),
            },
          ]
        : []),
    ];
  }, [t, router, storefrontUrl, showPlatformTools]);

  return (
    <>
      <CommandSearchTrigger
        label={t.topbar.search}
        shortcut={t.topbar.searchHint}
        onClick={() => setOpen(true)}
        className={className}
      />
      <CommandSearch
        open={open}
        onOpenChange={setOpen}
        groups={groups}
        title={t.topbar.searchTitle}
        description={t.topbar.searchDescription}
        placeholder={t.topbar.search}
        emptyLabel={t.topbar.noResults}
      />
    </>
  );
}
