import { Card, CardContent, CardHeader, CardTitle, cn } from "@platform/ui";
import type { DailySalesDto } from "@/lib/api/sales-analytics";
import { formatCalendarDay, formatCurrencyCompact, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const VIEW_W = 640;
const VIEW_H = 220;
const PAD = { top: 12, right: 8, bottom: 12, left: 8 };
/** More day labels than this crowd the axis on a phone. */
const MAX_X_LABELS = 7;
/** Beyond this many days a dot per day is clutter, the line alone reads better. */
const MAX_POINTS = 14;

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

/** Indexes of the days that get a label on the horizontal axis: all of a short range, else evenly spread, first and last included. */
function labelIndexes(count: number): readonly number[] {
  if (count <= MAX_X_LABELS) return Array.from({ length: count }, (_, index) => index);
  const last = count - 1;
  return Array.from({ length: MAX_X_LABELS }, (_, slot) =>
    Math.round((slot * last) / (MAX_X_LABELS - 1)),
  );
}

/**
 * Total sales over time: the current range as the line and the range before it dashed beside it, one
 * point per day of the SHOP's calendar (every day is there, a day with no sales is a point at zero).
 *
 * Inline SVG rather than a charting dependency: two series, no interaction model beyond per-day
 * readings, and full control over how it renders in both themes. The plot is not mirrored in RTL: a
 * time axis reads left to right in both locales, flipping it would reverse "later", not translate it.
 *
 * Accessibility: the graphic is `role="img"` with a summary label, and the same data is available as a
 * list of per-day readings for assistive technology.
 */
export function SalesChart({
  current,
  previous,
  currency,
  t,
  locale,
  className,
}: {
  readonly current: readonly DailySalesDto[];
  readonly previous: readonly DailySalesDto[];
  readonly currency: string;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly className?: string;
}) {
  const currentSales = current.map((day) => day.salesMinor);
  const previousSales = previous.map((day) => day.salesMinor);
  const max = Math.max(0, ...currentSales, ...previousSales);
  const count = Math.max(current.length, previous.length, 1);
  const step = (VIEW_W - PAD.left - PAD.right) / Math.max(count - 1, 1);
  const labelled = labelIndexes(current.length);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle as="h2">{t.sales.title}</CardTitle>
        <div className="flex items-center gap-4 text-xs">
          <Legend colour="var(--chart-1)" label={t.sales.thisPeriod} />
          <Legend colour="var(--chart-2)" label={t.sales.previousPeriod} dashed />
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
              <li key={fraction} data-y-label>
                {formatCurrencyCompact(locale, max * fraction, currency)}
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
              {[0.25, 0.5, 0.75, 1].map((fraction) => (
                <line
                  key={fraction}
                  x1={PAD.left}
                  x2={VIEW_W - PAD.right}
                  y1={scaleY(max * fraction, max)}
                  y2={scaleY(max * fraction, max)}
                  stroke="var(--border)"
                  strokeWidth={1}
                  opacity={0.5}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <line
                x1={PAD.left}
                x2={VIEW_W - PAD.right}
                y1={scaleY(0, max)}
                y2={scaleY(0, max)}
                stroke="var(--border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />

              <path
                data-series="previous"
                d={pathFor(previousSales, max, step)}
                fill="none"
                stroke="var(--chart-2)"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                data-series="current"
                d={pathFor(currentSales, max, step)}
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />

              {current.length <= MAX_POINTS &&
                current.map((day, index) => (
                  <circle
                    key={day.date}
                    data-point
                    cx={PAD.left + index * step}
                    cy={scaleY(day.salesMinor, max)}
                    r={4}
                    fill="var(--card)"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
            </svg>

            <ol
              className="text-muted-foreground relative mt-2 h-4 text-xs"
              aria-hidden="true"
              dir="ltr"
            >
              {labelled.map((index) => {
                const day = current[index];
                if (day === undefined) return null;
                const fraction = count <= 1 ? 0 : index / (count - 1);
                return (
                  <li
                    key={day.date}
                    data-x-label
                    className="absolute -translate-x-1/2 whitespace-nowrap"
                    style={{ left: `${(fraction * 100).toFixed(2)}%` }}
                  >
                    {formatCalendarDay(locale, day.date)}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* The chart's data, in words, for assistive technology. */}
        <ul className="sr-only">
          {current.map((day, index) => (
            <li key={day.date}>
              {t.sales.dayReading
                .replace("{date}", formatCalendarDay(locale, day.date))
                .replace("{sales}", formatCurrencyCompact(locale, day.salesMinor, currency))
                .replace("{orders}", formatNumber(locale, day.orders))
                .replace(
                  "{previousSales}",
                  formatCurrencyCompact(locale, previous[index]?.salesMinor ?? 0, currency),
                )}
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
