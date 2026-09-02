import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@platform/ui";
import type { OrderStatus, RecentOrder } from "@/data/dashboard";
import { formatCurrency, formatRelativeMinutes } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * Order status → badge variant. This mapping is the platform's semantic contract: the
 * same status must look the same in orders, payments, checkout, and analytics, so it is
 * expressed once here rather than chosen per screen.
 */
const STATUS_VARIANT: Readonly<Record<OrderStatus, "success" | "info" | "destructive">> = {
  paid: "success",
  processing: "info",
  refunded: "destructive",
};

function statusLabel(status: OrderStatus, t: Dictionary): string {
  switch (status) {
    case "paid":
      return t.recentOrders.paid;
    case "processing":
      return t.recentOrders.processing;
    case "refunded":
      return t.recentOrders.refunded;
  }
}

export function RecentOrders({
  orders,
  t,
  locale,
  className,
  live = false,
}: {
  readonly orders: readonly RecentOrder[];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly className?: string;
  /** Set once the data behind this widget is the real `GET /orders` endpoint rather than demo data. */
  readonly live?: boolean;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{t.recentOrders.title}</CardTitle>
          {live && <Badge variant="success">{t.recentOrders.liveBadge}</Badge>}
        </div>
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
              className="border-border/60 hover:bg-accent/40 duration-(--duration-fast) flex items-center gap-3 border-t px-4 py-3.5 transition-colors ease-out sm:px-5"
            >
              <Avatar>
                <AvatarFallback>{order.customerInitials}</AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  <Link href={`/orders/${order.id}`} className="hover:text-primary">
                    {order.reference}
                  </Link>
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {order.customerName} · {formatRelativeMinutes(locale, order.minutesAgo)}
                </p>
              </div>

              <Badge variant={STATUS_VARIANT[order.status]}>{statusLabel(order.status, t)}</Badge>

              <span className="w-20 text-end font-medium tabular-nums">
                {formatCurrency(locale, order.total.amountMinor, order.total.currency)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
