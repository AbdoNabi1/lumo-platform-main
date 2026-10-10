import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { OrderAdvancedSection } from "@/components/orders/order-advanced-section";
import {
  OrderBillingAddressCard,
  OrderShippingAddressCard,
} from "@/components/orders/order-addresses-card";
import {
  OrderCustomerCard,
  OrderCustomerCardSkeleton,
} from "@/components/orders/order-customer-card";
import { OrderHeader } from "@/components/orders/order-header";
import { OrderItemsCard } from "@/components/orders/order-items-card";
import { OrderPaymentCard, OrderPaymentCardSkeleton } from "@/components/orders/order-payment-card";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { fetchOrder } from "@/lib/api/orders";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface OrderDetailPageProps {
  readonly params: Promise<{ readonly orderId: string }>;
}

/**
 * The Order Detail screen, laid out like Shopify's (Plan 3B). Resolves the real
 * `GET /orders/:orderId` endpoint, which already carries the derived payment and fulfillment
 * statuses, so the header and the fulfillment card render with the order itself. Customer and payment
 * lookups (separate bounded contexts, Identity and Payments) each get their own `<Suspense>`
 * boundary so a slow/failed cross-context read never blocks the order — same streaming discipline as
 * the Dashboard.
 *
 * Main column: the fulfillment card, the payment card, the timeline, and — collapsed — the Advanced
 * section with the lifecycle controls this page used to lead with. Sidebar: the customer, the
 * shipping address (copy + map) and the billing address.
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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <OrderHeader order={order} t={t} locale={locale} />

        <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
          <div className="flex flex-col gap-6 xl:col-span-2">
            <OrderItemsCard order={order} t={t} locale={locale} />

            <Suspense fallback={<OrderPaymentCardSkeleton t={t} />}>
              <OrderPaymentCard order={order} t={t} locale={locale} />
            </Suspense>

            <OrderTimeline
              history={order.history}
              totalMinor={order.totalMinor}
              currency={order.currency}
              paymentProvider={order.paymentProvider}
              t={t}
              locale={locale}
            />

            <OrderAdvancedSection order={order} t={t} locale={locale} />
          </div>

          <div className="flex flex-col gap-6">
            <Suspense fallback={<OrderCustomerCardSkeleton t={t} />}>
              <OrderCustomerCard order={order} t={t} />
            </Suspense>

            <OrderShippingAddressCard address={order.shippingAddress} t={t} locale={locale} />

            <OrderBillingAddressCard
              shippingAddress={order.shippingAddress}
              billingAddress={order.billingAddress}
              t={t}
              locale={locale}
            />
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
