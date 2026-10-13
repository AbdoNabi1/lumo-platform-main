import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import {
  OrderFulfillmentStatusBadge,
  OrderPaymentStatusBadge,
} from "@/components/orders/order-status-badge";
import type { OrderListItemDto } from "@/lib/api/orders";
import { formatCurrency, formatRelativeMinutes } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
}

/**
 * The latest orders, in the same shape as the orders list (Plan 3B): the number, who it is for, when,
 * the payment and fulfillment statuses and the total. Whatever the date range chosen above, these are
 * the latest five. An order whose customer Identity does not know says "No customer" rather than a
 * made-up name. `now` is injectable so the relative time is testable.
 */
export function RecentOrders({
  orders,
  t,
  locale,
  now,
  className,
}: {
  readonly orders: readonly OrderListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly now?: Date;
  readonly className?: string;
}) {
  const reference = now ?? new Date();
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle as="h2">{t.recentOrders.title}</CardTitle>
        <Button variant="outline" size="sm" asChild>
          <Link href="/orders">
            {t.recentOrders.viewAll}
            <ArrowRightIcon aria-hidden="true" className="rtl:-scale-x-100" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="px-0 sm:px-0">
        <ul className="flex flex-col">
          {orders.map((order) => (
            <li
              key={order.id}
              className="border-border/60 hover:bg-accent/40 duration-(--duration-fast) flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3.5 transition-colors ease-out sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  <Link href={`/orders/${order.id}`} className="hover:text-primary">
                    #{order.orderNumber}
                  </Link>
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {order.customerName ?? t.ordersPage.noCustomer} ·{" "}
                  {formatRelativeMinutes(locale, minutesSince(order.createdAt, reference))}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <OrderPaymentStatusBadge status={order.paymentStatus} t={t} />
                <OrderFulfillmentStatusBadge status={order.fulfillmentStatus} t={t} />
              </div>

              <span className="w-24 text-end font-medium tabular-nums">
                {formatCurrency(locale, order.totalMinor, order.currency)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
