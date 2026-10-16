/**
 * The date ranges Home offers (Plan 3D). The server resolves each against "today" in the SHOP's own
 * time zone (`GET /analytics/sales?range=`), so the browser's clock and zone never decide which day
 * is today. The chosen range lives in the URL (`/?range=30d`) so a reload keeps it.
 */
export const DASHBOARD_RANGES = ["today", "yesterday", "7d", "30d", "month"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DEFAULT_RANGE: DashboardRange = "7d";

/** The range a `?range=` value names; anything unknown or repeated is the default, never an error page. */
export function parseRange(raw: string | readonly string[] | undefined): DashboardRange {
  if (typeof raw !== "string") return DEFAULT_RANGE;
  return (DASHBOARD_RANGES as readonly string[]).includes(raw)
    ? (raw as DashboardRange)
    : DEFAULT_RANGE;
}

/** The URL of `path` (Home is `/`, Analytics `/analytics`) showing `range`. */
export function rangeHref(range: DashboardRange, path = "/"): string {
  return `${path}?range=${range}`;
}
