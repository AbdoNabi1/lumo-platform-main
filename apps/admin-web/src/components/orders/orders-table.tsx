import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { OrderListItemDto } from "@/lib/api/orders";
import { formatCurrency, formatNumber, orderDateParts } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { OrderFulfillmentStatusBadge, OrderPaymentStatusBadge } from "./order-status-badge";

/** Columns that only fit from the medium breakpoint up. On a phone: Order, Customer, Total, Payment status. */
const FROM_MD = "hidden md:table-cell";

/** "Today at 8:27 pm" / "Yesterday at …" / "Oct 7 at …", in the page locale. */
function dateLabel(parts: ReturnType<typeof orderDateParts>, t: Dictionary): string {
  const template =
    parts.when === "today"
      ? t.ordersPage.dateToday
      : parts.when === "yesterday"
        ? t.ordersPage.dateYesterday
        : t.ordersPage.dateOther;
  return template.replace("{date}", parts.date).replace("{time}", parts.time);
}

/** "1 item" / "3 items" / "منتجين" — the plural form comes from the locale's own rules. */
function itemCountLabel(count: number, locale: Locale, t: Dictionary): string {
  const category = new Intl.PluralRules(locale).select(count);
  return t.ordersPage.itemCount[category].replace("{count}", formatNumber(locale, count));
}

/** The shop's own label for a shipping method; a method it has no label for shows as it was recorded. */
function deliveryLabel(method: string | null, t: Dictionary): string {
  if (method === null) return "—";
  return (t.shippingMethodLabel as Record<string, string>)[method] ?? method;
}

/**
 * The orders list, like Shopify's (Plan 3B): the short number, a relative date, the customer's name,
 * the total, and the two statuses. The whole row is a link target (the Order link is stretched over
 * it) so it is clickable with a mouse and reachable by keyboard through that one link. `now` is
 * injectable so the relative date is testable.
 */
export function OrdersTable({
  orders,
  t,
  locale,
  now,
}: {
  readonly orders: readonly OrderListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly now?: Date;
}) {
  const reference = now ?? new Date();
  return (
    <Table aria-label={t.ordersPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.ordersPage.columns.order}</TableHead>
          <TableHead className={FROM_MD}>{t.ordersPage.columns.date}</TableHead>
          <TableHead>{t.ordersPage.columns.customer}</TableHead>
          <TableHead className="text-end">{t.ordersPage.columns.total}</TableHead>
          <TableHead>{t.ordersPage.columns.paymentStatus}</TableHead>
          <TableHead className={FROM_MD}>{t.ordersPage.columns.fulfillmentStatus}</TableHead>
          <TableHead className={FROM_MD}>{t.ordersPage.columns.items}</TableHead>
          <TableHead className={FROM_MD}>{t.ordersPage.columns.deliveryMethod}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => {
          const date = orderDateParts(locale, order.createdAt, reference);
          return (
            <TableRow key={order.id} className="hover:bg-muted/50 relative">
              <TableCell className="font-semibold">
                <Link
                  href={`/orders/${order.id}`}
                  className="hover:text-primary focus-visible:after:ring-ring after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
                  aria-label={t.ordersPage.viewOrder.replace("{orderNumber}", order.orderNumber)}
                >
                  #{order.orderNumber}
                </Link>
              </TableCell>
              <TableCell
                className={`text-muted-foreground whitespace-nowrap ${FROM_MD}`}
                title={date.full}
              >
                {dateLabel(date, t)}
              </TableCell>
              <TableCell>
                {order.customerName === null ? (
                  <span className="text-muted-foreground">{t.ordersPage.noCustomer}</span>
                ) : (
                  <span className="truncate">{order.customerName}</span>
                )}
              </TableCell>
              <TableCell className="text-end font-medium tabular-nums">
                {formatCurrency(locale, order.totalMinor, order.currency)}
              </TableCell>
              <TableCell>
                <OrderPaymentStatusBadge status={order.paymentStatus} t={t} />
              </TableCell>
              <TableCell className={FROM_MD}>
                <OrderFulfillmentStatusBadge status={order.fulfillmentStatus} t={t} />
              </TableCell>
              <TableCell className={`text-muted-foreground whitespace-nowrap ${FROM_MD}`}>
                {itemCountLabel(order.itemCount, locale, t)}
              </TableCell>
              <TableCell className={`text-muted-foreground ${FROM_MD}`}>
                {deliveryLabel(order.shippingMethod, t)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
