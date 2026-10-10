import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { OrderHistoryEntryDto } from "@/lib/api/orders";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { paymentMethodLabel } from "@/lib/payment-method-label";
import type { Dictionary } from "@/messages/en";

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

/** The order's full append-only lifecycle history in words, newest first — real data straight from `order_events`. */
export function OrderTimeline({
  history,
  totalMinor,
  currency,
  paymentProvider,
  t,
  locale,
}: {
  readonly history: readonly OrderHistoryEntryDto[];
  readonly totalMinor: number;
  readonly currency: string;
  readonly paymentProvider: string | null;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const context = { total: formatCurrency(locale, totalMinor, currency), paymentProvider };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.timeline}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-4">
          {[...history].reverse().map((entry, index) => (
            <li key={`${entry.type}-${entry.occurredAt}`} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={
                  index === 0
                    ? "bg-primary mt-1.5 size-2.5 shrink-0 rounded-full"
                    : "bg-border mt-1.5 size-2.5 shrink-0 rounded-full"
                }
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{eventLabel(entry.type, context, t)}</p>
                <p className="text-muted-foreground text-xs">
                  {formatDateTime(locale, entry.occurredAt)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
