import Link from "next/link";
import { cn } from "@platform/ui";
import { DASHBOARD_RANGES, rangeHref, type DashboardRange } from "@/lib/dashboard/ranges";
import type { Dictionary } from "@/messages/en";

function labelOf(range: DashboardRange, t: Dictionary): string {
  switch (range) {
    case "today":
      return t.header.ranges.today;
    case "yesterday":
      return t.header.ranges.yesterday;
    case "7d":
      return t.header.ranges.last7;
    case "30d":
      return t.header.ranges.last30;
    case "month":
      return t.header.ranges.thisMonth;
  }
}

/**
 * The date range of Home and Analytics: a row of links, one per preset, each pointing at
 * `<page>?range=…`. The choice lives in the URL, so a reload, the back button and a shared link all
 * keep it, and it works before any script has loaded.
 */
export function RangePicker({
  t,
  range,
  path,
}: {
  readonly t: Dictionary;
  readonly range: DashboardRange;
  /** The page the links point at: `/` for Home, `/analytics` for Analytics. */
  readonly path: string;
}) {
  return (
    <nav aria-label={t.header.dateRange} className="flex shrink-0 flex-wrap items-center gap-2">
      {DASHBOARD_RANGES.map((candidate) => {
        const active = candidate === range;
        return (
          <Link
            key={candidate}
            href={rangeHref(candidate, path)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "border-border duration-(--duration-fast) focus-visible:ring-ring inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-foreground hover:bg-accent",
            )}
          >
            {labelOf(candidate, t)}
          </Link>
        );
      })}
    </nav>
  );
}
