import Link from "next/link";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";
import { Badge, Card, CardContent, cn } from "@platform/ui";
import type { Change } from "@/lib/dashboard/change";
import { formatDelta } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { Sparkline } from "./sparkline";

/** A distinct pastel accent per card, purely visual grouping. */
export type KpiAccent = "info" | "primary" | "success" | "warning";

const ACCENT: Readonly<Record<KpiAccent, string>> = {
  info: "bg-info-subtle text-info-foreground shadow-[0_0_20px_-2px_var(--info-subtle)]",
  primary:
    "bg-primary-subtle text-primary-subtle-foreground shadow-[0_0_20px_-2px_var(--primary-subtle)]",
  success: "bg-success-subtle text-success-foreground shadow-[0_0_20px_-2px_var(--success-subtle)]",
  warning: "bg-warning-subtle text-warning-foreground shadow-[0_0_20px_-2px_var(--warning-subtle)]",
};

/** The badge: up or down by a fraction, "New" when the period before had nothing, a dash when neither did. */
function ChangeBadge({
  change,
  locale,
  t,
}: {
  readonly change: Change;
  readonly locale: Locale;
  readonly t: Dictionary;
}) {
  if (change.kind === "new") return <Badge variant="info">{t.kpi.changeNew}</Badge>;
  if (change.kind === "none") {
    return (
      <span
        className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
        title={t.kpi.nothingToCompare}
      >
        <MinusIcon className="size-3.5" aria-hidden="true" />
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t.kpi.nothingToCompare}</span>
      </span>
    );
  }
  const up = change.fraction >= 0;
  const TrendIcon = up ? TrendingUpIcon : TrendingDownIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium tabular-nums",
        up
          ? "bg-success-subtle text-success-foreground"
          : "bg-destructive-subtle text-destructive-subtle-foreground",
      )}
    >
      <TrendIcon className="size-3.5" aria-hidden="true" />
      {formatDelta(locale, change.fraction)}
    </span>
  );
}

/**
 * One KPI card on Home: icon, title, value, and (when it is a period figure) how it moved against the
 * period before plus a spark of its days. The direction of the change is carried by an icon and a sign,
 * not by colour alone (WCAG 1.4.1). A card with no `change` (orders to fulfill: an all-time count)
 * shows the value alone, and `href` makes its value a link.
 */
export function KpiCard({
  id,
  icon: Icon,
  accent,
  title,
  value,
  hint,
  change,
  comparisonLabel,
  trend,
  href,
  hrefLabel,
  t,
  locale,
}: {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly accent: KpiAccent;
  readonly title: string;
  readonly value: string;
  readonly hint?: string;
  readonly change?: Change;
  readonly comparisonLabel?: string;
  readonly trend?: readonly number[];
  readonly href?: string;
  readonly hrefLabel?: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Card variant="kpi" data-kpi={id}>
      <CardContent className="flex flex-col gap-4 pt-4 sm:pt-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              ACCENT[accent],
            )}
            aria-hidden="true"
          >
            <Icon className="size-5" />
          </span>
          <h3 className="text-muted-foreground text-base font-medium">{title}</h3>
        </div>

        <div className="flex items-end justify-between gap-3">
          {href === undefined ? (
            <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
          ) : (
            <Link
              href={href}
              aria-label={hrefLabel}
              className="hover:text-primary focus-visible:ring-ring rounded-md text-3xl font-semibold tabular-nums tracking-tight focus-visible:outline-none focus-visible:ring-2"
            >
              {value}
            </Link>
          )}
          {trend !== undefined && <Sparkline points={trend} />}
        </div>

        {change !== undefined && comparisonLabel !== undefined ? (
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <ChangeBadge change={change} locale={locale} t={t} />
            <span className="text-muted-foreground">
              {t.kpi.comparedTo.replace("{range}", comparisonLabel)}
            </span>
          </p>
        ) : (
          hint !== undefined && <p className="text-muted-foreground text-xs">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
