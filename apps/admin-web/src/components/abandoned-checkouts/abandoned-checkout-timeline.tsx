import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { AbandonedCheckoutDetailDto } from "@/lib/api/abandoned-checkouts";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { abandonedTimeline, type AbandonedTimelineEvent } from "@/lib/orders/abandoned-checkouts";
import type { Dictionary } from "@/messages/en";

function label(event: AbandonedTimelineEvent, t: Dictionary, locale: Locale): string {
  const l = t.abandonedCheckouts.timeline;
  switch (event.kind) {
    case "started":
      return l.started;
    case "last_activity":
      return l.lastActivity;
    case "link_issued":
      return l.linkIssued;
    case "link_opened":
      return l.linkOpened.replace("{count}", () => formatNumber(locale, event.count ?? 0));
    case "recovered":
      return l.recovered.replace("{order}", () =>
        event.orderNumber === null || event.orderNumber === undefined
          ? ""
          : `#${event.orderNumber}`,
      );
  }
}

/** The abandoned checkout's small timeline (spec §3.7): recovered on top, then newest first. */
export function AbandonedCheckoutTimeline({
  detail,
  t,
  locale,
}: {
  readonly detail: Pick<
    AbandonedCheckoutDetailDto,
    "createdAt" | "lastActivityAt" | "links" | "recoveredOrder"
  >;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.abandonedCheckouts.timeline.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="border-border flex flex-col gap-4 border-s ps-4">
          {abandonedTimeline(detail).map((event) => (
            <li key={event.key} className="flex flex-col gap-0.5">
              {event.kind === "recovered" && event.orderId !== undefined ? (
                <Link
                  href={`/orders/${encodeURIComponent(event.orderId)}`}
                  className="font-medium hover:underline"
                >
                  {label(event, t, locale)}
                </Link>
              ) : (
                <span className="text-sm">{label(event, t, locale)}</span>
              )}
              {event.at !== null && (
                <time dateTime={event.at} className="text-muted-foreground text-xs">
                  {formatDateTime(locale, event.at)}
                </time>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
