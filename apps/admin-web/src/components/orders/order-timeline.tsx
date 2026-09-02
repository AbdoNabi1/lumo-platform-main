import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { OrderHistoryEntryDto } from "@/lib/api/orders";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { OrderStatusBadge } from "./order-status-badge";

/** The order's full append-only lifecycle history — real data straight from `order_events`, oldest first (already sorted that way by `toOrderDetailDto`). */
export function OrderTimeline({
  history,
  t,
  locale,
}: {
  readonly history: readonly OrderHistoryEntryDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.timeline}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-4">
          {[...history].reverse().map((entry, index) => (
            <li key={`${entry.type}-${entry.occurredAt}`} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={
                  index === 0
                    ? "bg-primary size-2.5 shrink-0 rounded-full"
                    : "bg-border size-2.5 shrink-0 rounded-full"
                }
              />
              <OrderStatusBadge status={entry.type} t={t} />
              <span className="text-muted-foreground text-sm">
                {formatDateTime(locale, entry.occurredAt)}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
