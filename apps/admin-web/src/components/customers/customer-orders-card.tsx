import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@platform/ui";
import { fetchOrdersPage } from "@/lib/api/orders";
import { formatCurrency, formatShortDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { OrderStatusBadge } from "../orders/order-status-badge";

const RELATED_ORDERS_LIMIT = 5;

/**
 * Related orders for this customer. Orders has no `findByCustomerRef` query of its own — it
 * reuses `GET /orders?search=`, which already matches `customerRef` by substring
 * (`services/orders/src/infrastructure/prisma-order-repository.ts`'s `fetchOrders`), so passing
 * the customer's own id as `search` resolves to exactly their orders without a new backend
 * capability. An async Server Component in its own `<Suspense>` boundary so a slow/failed Orders
 * read never blocks the rest of the customer profile from rendering.
 */
export async function CustomerOrdersCard({
  customerId,
  t,
  locale,
}: {
  readonly customerId: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const result = await fetchOrdersPage({ first: RELATED_ORDERS_LIMIT, search: customerId });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.customerDetail.orders}</CardTitle>
      </CardHeader>
      <CardContent>
        {result.outcome === "ok" && result.items.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {result.items.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3">
                <Link
                  href={`/orders/${order.id}`}
                  className="hover:text-primary min-w-0 truncate font-medium"
                  aria-label={t.customerDetail.viewOrder.replace(
                    "{orderNumber}",
                    order.orderNumber,
                  )}
                >
                  #{order.orderNumber}
                </Link>
                <span className="text-muted-foreground shrink-0 text-sm">
                  {formatShortDate(locale, order.createdAt)}
                </span>
                <OrderStatusBadge status={order.status} t={t} />
                <span className="shrink-0 font-medium tabular-nums">
                  {formatCurrency(locale, order.totalMinor, order.currency)}
                </span>
              </li>
            ))}
          </ul>
        ) : result.outcome === "ok" ? (
          <p className="text-muted-foreground text-sm">{t.customerDetail.ordersEmpty}</p>
        ) : (
          <p className="text-muted-foreground text-sm">{t.customerDetail.ordersUnavailable}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function CustomerOrdersCardSkeleton({ t }: { readonly t: Dictionary }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>{t.customerDetail.orders}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-5 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
