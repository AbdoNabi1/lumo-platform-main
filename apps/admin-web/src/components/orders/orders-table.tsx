import Link from "next/link";
import {
  Avatar,
  AvatarFallback,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { OrderListItemDto } from "@/lib/api/orders";
import { formatCurrency, formatShortDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { OrderStatusBadge } from "./order-status-badge";

/** Short, honest label derived from the bare `customerRef` — same technique as the Dashboard widget (`src/data/recent-orders.ts`); Orders has no customer name of its own. */
function customerDisplay(customerRef: string): {
  readonly label: string;
  readonly initials: string;
} {
  const short = customerRef.slice(-6).toUpperCase();
  return { label: `Customer ${short}`, initials: short.slice(0, 2) };
}

export function OrdersTable({
  orders,
  t,
  locale,
}: {
  readonly orders: readonly OrderListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Table aria-label={t.ordersPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.ordersPage.columns.order}</TableHead>
          <TableHead>{t.ordersPage.columns.customer}</TableHead>
          <TableHead>{t.ordersPage.columns.date}</TableHead>
          <TableHead>{t.ordersPage.columns.status}</TableHead>
          <TableHead className="text-end">{t.ordersPage.columns.total}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => {
          const customer = customerDisplay(order.customerRef);
          return (
            <TableRow key={order.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/orders/${order.id}`}
                  className="hover:text-primary"
                  aria-label={t.ordersPage.viewOrder.replace("{orderNumber}", order.orderNumber)}
                >
                  #{order.orderNumber}
                </Link>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar className="size-7">
                    <AvatarFallback className="text-xs">{customer.initials}</AvatarFallback>
                  </Avatar>
                  <span className="text-muted-foreground truncate">{customer.label}</span>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">
                {formatShortDate(locale, order.createdAt)}
              </TableCell>
              <TableCell>
                <OrderStatusBadge status={order.status} t={t} />
              </TableCell>
              <TableCell className="text-end font-medium tabular-nums">
                {formatCurrency(locale, order.totalMinor, order.currency)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
