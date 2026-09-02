"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CommandSearch, CommandSearchTrigger, type CommandGroup } from "@platform/ui";
import { PRIMARY_NAV, SALES_CHANNEL_NAV } from "./navigation";
import type { Dictionary } from "@/messages/en";

/**
 * The admin's global search. Opens on Ctrl/⌘+K as well as by click, and indexes the
 * navigation surface today — the `groups` shape is what a real search backend would fill
 * in (orders, products, customers) without touching this component's behaviour.
 */
export function GlobalSearch({
  t,
  className,
}: {
  readonly t: Dictionary;
  readonly className?: string;
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

  const groups: readonly CommandGroup[] = React.useMemo(
    () => [
      {
        id: "primary",
        heading: t.nav.primary,
        items: PRIMARY_NAV.map((item) => ({
          id: item.id,
          label: item.label(t),
          Icon: item.Icon,
          onSelect: () => {
            router.push(item.href);
          },
        })),
      },
      {
        id: "channels",
        heading: t.nav.salesChannels,
        items: SALES_CHANNEL_NAV.map((item) => ({
          id: item.id,
          label: item.label(t),
          Icon: item.Icon,
          onSelect: () => {
            window.open(item.href, "_blank", "noreferrer");
          },
        })),
      },
    ],
    [t, router],
  );

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
