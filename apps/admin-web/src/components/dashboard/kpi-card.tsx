import {
  CircleDollarSignIcon,
  ShoppingBagIcon,
  TagIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge, Card, CardContent, cn } from "@platform/ui";
import { Sparkline } from "./sparkline";
import type { DashboardKpi, KpiId } from "@/data/dashboard";
import { formatCurrency, formatDelta, formatNumber, formatPercent } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const ICONS: Readonly<Record<KpiId, LucideIcon>> = {
  revenue: CircleDollarSignIcon,
  orders: ShoppingBagIcon,
  averageOrderValue: TagIcon,
  conversionRate: UsersIcon,
};

/** A distinct pastel accent per KPI, plus a soft colour-matched glow — purely visual
 *  grouping, no change in meaning. */
const ACCENT: Readonly<Record<KpiId, string>> = {
  revenue: "bg-info-subtle text-info-foreground shadow-[0_0_20px_-2px_var(--info-subtle)]",
  orders:
    "bg-primary-subtle text-primary-subtle-foreground shadow-[0_0_20px_-2px_var(--primary-subtle)]",
  averageOrderValue:
    "bg-success-subtle text-success-foreground shadow-[0_0_20px_-2px_var(--success-subtle)]",
  conversionRate:
    "bg-warning-subtle text-warning-foreground shadow-[0_0_20px_-2px_var(--warning-subtle)]",
};

function titleFor(id: KpiId, t: Dictionary): string {
  switch (id) {
    case "revenue":
      return t.kpi.totalRevenue;
    case "orders":
      return t.kpi.orders;
    case "averageOrderValue":
      return t.kpi.averageOrderValue;
    case "conversionRate":
      return t.kpi.conversionRate;
  }
}

function valueFor(kpi: DashboardKpi, locale: Locale): string {
  switch (kpi.kind) {
    case "money":
      return formatCurrency(locale, kpi.value.amountMinor, kpi.value.currency);
    case "count":
      return formatNumber(locale, kpi.value);
    case "rate":
      return formatPercent(locale, kpi.value);
  }
}

/**
 * A single KPI: icon, title, value, period-over-period comparison, and a trend spark.
 *
 * The delta's direction is carried by an icon and a word-equivalent sign, not by colour
 * alone — colour is reinforcement (WCAG 1.4.1).
 *
 * `kpi.provenance` is per-KPI, not per-page (`data/dashboard.ts`'s module doc explains why):
 * Revenue can be live while Orders/AOV/Conversion Rate stay demo, so each card carries its own
 * small "Live"/"Demo" tag next to its title rather than relying on one page-wide signal that
 * could never be accurate for all four at once.
 */
export function KpiCard({
  kpi,
  t,
  locale,
  comparisonLabel,
}: {
  readonly kpi: DashboardKpi;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly comparisonLabel: string;
}) {
  const Icon = ICONS[kpi.id];
  const up = kpi.delta >= 0;
  const TrendIcon = up ? TrendingUpIcon : TrendingDownIcon;
  const title = titleFor(kpi.id, t);

  return (
    <Card variant="kpi">
      <CardContent className="flex flex-col gap-4 pt-4 sm:pt-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              ACCENT[kpi.id],
            )}
            aria-hidden="true"
          >
            <Icon className="size-5" />
          </span>
          <h3 className="text-muted-foreground text-base font-medium">{title}</h3>
          {kpi.provenance === "live" ? (
            <Badge variant="success">{t.data.liveTag}</Badge>
          ) : (
            <Badge variant="warning">{t.data.demoTag}</Badge>
          )}
        </div>

        <div className="flex items-end justify-between gap-3">
          <p className="text-3xl font-semibold tabular-nums tracking-tight">
            {valueFor(kpi, locale)}
          </p>
          <Sparkline points={kpi.trend} />
        </div>

        <p className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium tabular-nums",
              up
                ? "bg-success-subtle text-success-foreground"
                : "bg-destructive-subtle text-destructive-subtle-foreground",
            )}
          >
            <TrendIcon className="size-3.5" aria-hidden="true" />
            {formatDelta(locale, kpi.delta)}
          </span>
          <span className="text-muted-foreground">
            {t.kpi.comparedTo.replace("{range}", comparisonLabel)}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
