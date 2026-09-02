import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from "@platform/ui";
import type { DataProvenance, SalesPoint } from "@/data/dashboard";
import { formatCurrencyCompact, formatNumber, formatShortDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const VIEW_W = 640;
const VIEW_H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 8 };

function scaleY(value: number, max: number): number {
  const usable = VIEW_H - PAD.top - PAD.bottom;
  return VIEW_H - PAD.bottom - (max === 0 ? 0 : (value / max) * usable);
}

function pathFor(values: readonly number[], max: number, step: number): string {
  return values
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"}${(PAD.left + index * step).toFixed(2)} ${scaleY(value, max).toFixed(2)}`,
    )
    .join(" ");
}

/**
 * Sales overview — revenue and orders per day.
 *
 * Inline SVG rather than a charting dependency: two series, no interaction model beyond
 * per-point readings, and full control over how it renders in both themes. Series colour
 * comes from `--chart-1` (brand) and `--chart-2` (neutral), both held at ≥3:1 against the
 * card in light and dark by the token contrast suite.
 *
 * The plot itself is not mirrored in RTL. A time axis reads left-to-right in both
 * locales — flipping it would reverse the meaning of "later", not translate it. The card,
 * legend, and axis labels around it do follow the reading direction.
 *
 * Accessibility: the graphic is `role="img"` with a summary label, and the same data is
 * available as a table to assistive technology via the visually-hidden list below it.
 */
export function SalesOverview({
  points,
  provenance,
  t,
  locale,
  currency,
  className,
}: {
  readonly points: readonly SalesPoint[];
  readonly provenance: DataProvenance;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly currency: string;
  readonly className?: string;
}) {
  const revenues = points.map((point) => point.revenue.amountMinor);
  const orders = points.map((point) => point.orders);
  const maxRevenue = Math.max(...revenues);
  const maxOrders = Math.max(...orders);
  const step = (VIEW_W - PAD.left - PAD.right) / Math.max(points.length - 1, 1);

  const revenuePath = pathFor(revenues, maxRevenue, step);
  const ordersPath = pathFor(orders, maxOrders, step);
  const areaPath = `${revenuePath} L${(PAD.left + (points.length - 1) * step).toFixed(2)} ${VIEW_H - PAD.bottom} L${PAD.left} ${VIEW_H - PAD.bottom} Z`;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t.sales.title}</CardTitle>
          {provenance === "demo" && <Badge variant="warning">{t.data.demoTag}</Badge>}
        </div>
        {provenance === "demo" && (
          <p role="note" className="text-muted-foreground text-xs">
            {t.sales.demoExplanation}
          </p>
        )}
        <div className="flex items-center gap-4 text-xs">
          <Legend colour="var(--chart-1)" label={t.sales.revenue} />
          <Legend colour="var(--chart-2)" label={t.sales.orders} dashed />
          <span className="text-muted-foreground">{t.sales.range}</span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex gap-3">
          <ul
            className="text-muted-foreground flex shrink-0 flex-col justify-between py-1 text-xs tabular-nums"
            style={{ height: VIEW_H * 0.62 }}
            aria-hidden="true"
          >
            {[1, 0.75, 0.5, 0.25, 0].map((fraction) => (
              <li key={fraction}>
                {formatCurrencyCompact(locale, maxRevenue * fraction, currency)}
              </li>
            ))}
          </ul>

          <div className="min-w-0 flex-1">
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              className="h-[180px] w-full sm:h-[220px]"
              role="img"
              aria-label={t.sales.chartLabel}
            >
              <defs>
                <linearGradient id="sales-overview-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>

              {[0.25, 0.5, 0.75, 1].map((fraction) => (
                <line
                  key={fraction}
                  x1={PAD.left}
                  x2={VIEW_W - PAD.right}
                  y1={scaleY(maxRevenue * fraction, maxRevenue)}
                  y2={scaleY(maxRevenue * fraction, maxRevenue)}
                  stroke="var(--border)"
                  strokeWidth={1}
                  opacity={0.5}
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              <path d={areaPath} fill="url(#sales-overview-area)" />
              <path
                d={ordersPath}
                fill="none"
                stroke="var(--chart-2)"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={revenuePath}
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />

              {points.map((point, index) => (
                <circle
                  key={point.date}
                  cx={PAD.left + index * step}
                  cy={scaleY(point.revenue.amountMinor, maxRevenue)}
                  r={4}
                  fill="var(--card)"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>

            <ol
              className="text-muted-foreground mt-2 flex justify-between text-xs"
              aria-hidden="true"
            >
              {points.map((point) => (
                <li key={point.date}>{formatShortDate(locale, point.date)}</li>
              ))}
            </ol>
          </div>
        </div>

        {/* The chart's data, in words, for assistive technology. */}
        <ul className="sr-only">
          {points.map((point) => (
            <li key={point.date}>
              {t.sales.dayReading
                .replace("{date}", formatShortDate(locale, point.date))
                .replace(
                  "{revenue}",
                  formatCurrencyCompact(locale, point.revenue.amountMinor, currency),
                )
                .replace("{orders}", formatNumber(locale, point.orders))}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Legend({
  colour,
  label,
  dashed = false,
}: {
  readonly colour: string;
  readonly label: string;
  readonly dashed?: boolean;
}) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5">
      <span
        className={cn("h-0.5 w-4 rounded-full", dashed && "opacity-70")}
        style={{
          background: dashed
            ? `repeating-linear-gradient(to right, ${colour} 0 4px, transparent 4px 7px)`
            : colour,
        }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
