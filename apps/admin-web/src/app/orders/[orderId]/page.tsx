import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { OrderAddressesCard } from "@/components/orders/order-addresses-card";
import {
  OrderCustomerCard,
  OrderCustomerCardSkeleton,
} from "@/components/orders/order-customer-card";
import {
  OrderFulfillmentCard,
  OrderFulfillmentCardSkeleton,
} from "@/components/orders/order-fulfillment-card";
import { OrderItemsCard } from "@/components/orders/order-items-card";
import { OrderLifecycleActions } from "@/components/orders/order-lifecycle-actions";
import { OrderPaymentCard, OrderPaymentCardSkeleton } from "@/components/orders/order-payment-card";
import { OrderReturnsCard, OrderReturnsCardSkeleton } from "@/components/orders/order-returns-card";
import {
  OrderShippingCard,
  OrderShippingCardSkeleton,
} from "@/components/orders/order-shipping-card";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { fetchOrder } from "@/lib/api/orders";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface OrderDetailPageProps {
  readonly params: Promise<{ readonly orderId: string }>;
}

/**
 * The Order Detail screen (Phase 2 admin-web productization). Resolves the real
 * `GET /orders/:orderId` endpoint. Customer and payment lookups (separate bounded contexts,
 * Identity and Payments) each get their own `<Suspense>` boundary so a slow/failed cross-context
 * read never blocks the order itself from rendering — same streaming discipline as the Dashboard.
 */
export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { orderId } = await params;

  const result = await fetchOrder(orderId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.orderDetail.unauthorized}
          backLabel={t.orderDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.orderDetail.notFound}
          backLabel={t.orderDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.orderDetail.error}
          backLabel={t.orderDetail.back}
        />
      </AppShell>
    );
  }

  const order = result.order;

  return (
    <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/orders">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.orderDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">#{order.orderNumber}</h1>
            <OrderStatusBadge status={order.status} t={t} />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.orderDetail.placedOn.replace("{date}", formatDateTime(locale, order.createdAt))}
          </p>
        </div>

        <Card>
          <CardContent>
            <OrderLifecycleActions orderId={order.id} status={order.status} t={t} />
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
          <div className="flex flex-col gap-6 xl:col-span-2">
            <OrderItemsCard
              items={order.items}
              totals={order.totals}
              fallbackTotalMinor={order.totalMinor}
              currency={order.currency}
              t={t}
              locale={locale}
            />
            <OrderTimeline history={order.history} t={t} locale={locale} />
          </div>

          <div className="flex flex-col gap-6">
            <Suspense fallback={<OrderCustomerCardSkeleton t={t} />}>
              <OrderCustomerCard customerRef={order.customerRef} t={t} />
            </Suspense>

            <OrderAddressesCard
              shippingAddress={order.shippingAddress}
              billingAddress={order.billingAddress}
              t={t}
            />

            <Suspense fallback={<OrderPaymentCardSkeleton t={t} />}>
              <OrderPaymentCard paymentRef={order.paymentRef} t={t} locale={locale} />
            </Suspense>

            <Suspense fallback={<OrderFulfillmentCardSkeleton t={t} />}>
              <OrderFulfillmentCard orderId={order.id} t={t} locale={locale} />
            </Suspense>

            <Suspense fallback={<OrderShippingCardSkeleton t={t} />}>
              <OrderShippingCard orderId={order.id} t={t} locale={locale} />
            </Suspense>

            <Suspense fallback={<OrderReturnsCardSkeleton t={t} />}>
              <OrderReturnsCard orderId={order.id} t={t} locale={locale} />
            </Suspense>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatePanel({
  icon,
  message,
  backLabel,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly backLabel: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
          {icon}
          <p role="note">{message}</p>
          <Button variant="outline" asChild>
            <Link href="/orders">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
