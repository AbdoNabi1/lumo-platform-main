import { Badge, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { ChannelId, ChannelShare, DataProvenance, MoneyAmount } from "@/data/dashboard";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** Series colour per channel, drawn from the chart token ramp — never a literal. */
const SERIES: Readonly<Record<ChannelId, string>> = {
  onlineStore: "var(--chart-1)",
  mobileApp: "var(--chart-3)",
  marketplace: "var(--chart-4)",
  retailStore: "var(--chart-5)",
  other: "var(--chart-2)",
};

function channelLabel(id: ChannelId, t: Dictionary): string {
  switch (id) {
    case "onlineStore":
      return t.channels.onlineStore;
    case "mobileApp":
      return t.channels.mobileApp;
    case "marketplace":
      return t.channels.marketplace;
    case "retailStore":
      return t.channels.retailStore;
    case "other":
      return t.channels.other;
  }
}

const RADIUS = 60;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Revenue split by sales channel — an SVG donut plus a legend that repeats every value in
 * text. The donut is decorative (`aria-hidden`); the legend is the accessible content, so
 * no reading of this card depends on telling five colours apart.
 */
export function SalesByChannel({
  channels,
  total,
  provenance,
  t,
  locale,
  className,
}: {
  readonly channels: readonly ChannelShare[];
  readonly total: MoneyAmount;
  readonly provenance: DataProvenance;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly className?: string;
}) {
  let offset = 0;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t.channels.title}</CardTitle>
          {provenance === "demo" && <Badge variant="warning">{t.data.demoTag}</Badge>}
        </div>
        {provenance === "demo" && (
          <p role="note" className="text-muted-foreground text-xs">
            {t.channels.demoExplanation}
          </p>
        )}
      </CardHeader>

      {/*
        A container query, not a viewport one: this card is a grid column, so what decides
        whether the donut and its legend fit side by side is the card's own width — at
        1280px the viewport says "wide" while this column is barely 300px. `@sm` (384px)
        is the width at which a 160px donut plus a readable legend stop colliding.
      */}
      <CardContent className="@container @sm:flex-row @sm:items-center flex flex-col items-center gap-6">
        <div className="relative shrink-0">
          <svg viewBox="0 0 160 160" className="size-40" aria-hidden="true" focusable="false">
            <g transform="rotate(-90 80 80)">
              {channels.map((channel) => {
                const length = channel.share * CIRCUMFERENCE;
                const dash = `${length} ${CIRCUMFERENCE - length}`;
                const element = (
                  <circle
                    key={channel.id}
                    cx={80}
                    cy={80}
                    r={RADIUS}
                    fill="none"
                    stroke={SERIES[channel.id]}
                    strokeWidth={24}
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                  />
                );
                offset += length;
                return element;
              })}
            </g>
          </svg>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-semibold tabular-nums">
              {formatCurrency(locale, total.amountMinor, total.currency)}
            </span>
            <span className="text-muted-foreground text-xs">{t.channels.total}</span>
          </div>
        </div>

        <ul className="flex w-full min-w-0 flex-1 flex-col gap-2.5">
          {channels.map((channel) => (
            <li key={channel.id} className="flex items-center gap-3 text-base">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: SERIES[channel.id] }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{channelLabel(channel.id, t)}</span>
              <span className="shrink-0 tabular-nums">
                {formatCurrency(locale, channel.revenue.amountMinor, channel.revenue.currency)}
              </span>
              <span className="text-muted-foreground w-14 shrink-0 text-end tabular-nums">
                {formatPercent(locale, channel.share, 1)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
