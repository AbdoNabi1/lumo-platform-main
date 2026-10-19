import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { OrderHistoryEntryDto, TimelineEntryDto } from "@/lib/api/orders";
import { formatCalendarDay, formatCurrency, formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { activityLabel, mergeTimeline } from "@/lib/orders/order-timeline";
import { paymentMethodLabel } from "@/lib/payment-method-label";
import type { Dictionary } from "@/messages/en";
import { OrderCommentComposer } from "./order-comment-composer";
import { OrderCommentItem } from "./order-comment-item";

/**
 * One timeline line in words: "Order placed", "Payment of $19.99 pending (Cash on delivery)",
 * "Payment of $19.99 received". `{total}` is the order total and `{method}` how the customer pays; a
 * pending payment with no known method drops the parenthesis. A lifecycle event this build has no
 * words for is shown as its raw name rather than hidden.
 */
function eventLabel(
  type: string,
  context: { readonly total: string; readonly paymentProvider: string | null },
  t: Dictionary,
): string {
  const labels = t.orderPage.timeline as Record<string, string>;
  const key =
    type === "payment_requested" && context.paymentProvider === null
      ? "payment_requestedNoMethod"
      : type;
  const template = labels[key];
  if (template === undefined) return type;
  return template
    .replace("{total}", context.total)
    .replace("{method}", paymentMethodLabel(context.paymentProvider, t));
}

function Line({
  label,
  at,
  newest,
  locale,
}: {
  readonly label: string;
  readonly at: string;
  readonly newest: boolean;
  readonly locale: Locale;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={
          newest
            ? "bg-primary mt-1.5 size-2.5 shrink-0 rounded-full"
            : "bg-border mt-1.5 size-2.5 shrink-0 rounded-full"
        }
      />
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{formatDateTime(locale, at)}</p>
      </div>
    </li>
  );
}

/**
 * Shopify's order timeline (spec §2.4): the comment composer on top (staff who may comment), then ONE
 * list merging the lifecycle `history` and the staff `entries`, newest first, grouped by the shop's
 * calendar day. Comments show author, time and text with Edit/Delete as the API allows; activity reads
 * "Ahmed archived this order".
 */
export function OrderTimeline({
  history,
  totalMinor,
  currency,
  paymentProvider,
  t,
  locale,
  entries = [],
  timeZone = "UTC",
  orderId,
  canComment = false,
}: {
  readonly history: readonly OrderHistoryEntryDto[];
  readonly totalMinor: number;
  readonly currency: string;
  readonly paymentProvider: string | null;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly entries?: readonly TimelineEntryDto[];
  /** The shop's time zone — the day groups follow its calendar. */
  readonly timeZone?: string;
  readonly orderId?: string;
  /** `orders:comment`, decided on the server. */
  readonly canComment?: boolean;
}) {
  const context = { total: formatCurrency(locale, totalMinor, currency), paymentProvider };
  const days = mergeTimeline(history, entries, timeZone);
  const newest = days[0]?.items[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.timeline}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {canComment && orderId !== undefined && <OrderCommentComposer orderId={orderId} t={t} />}
        {days.map((group) => {
          const dayLabel = formatCalendarDay(locale, group.day);
          return (
            <section key={group.day} aria-label={dayLabel} className="flex flex-col gap-3">
              <h4 className="text-muted-foreground text-xs font-medium">{dayLabel}</h4>
              <ol className="flex flex-col gap-4">
                {group.items.map((item) => {
                  if (item.kind === "event") {
                    return (
                      <Line
                        key={`${item.event.type}-${item.event.occurredAt}`}
                        label={eventLabel(item.event.type, context, t)}
                        at={item.at}
                        newest={item === newest}
                        locale={locale}
                      />
                    );
                  }
                  const entry = item.entry;
                  if (entry.kind === "comment" && !entry.deleted && orderId !== undefined) {
                    return (
                      <OrderCommentItem
                        key={entry.id}
                        orderId={orderId}
                        entry={entry}
                        t={t}
                        locale={locale}
                      />
                    );
                  }
                  return (
                    <Line
                      key={entry.id}
                      label={activityLabel(entry, t)}
                      at={item.at}
                      newest={item === newest}
                      locale={locale}
                    />
                  );
                })}
              </ol>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
