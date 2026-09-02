import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { FulfillmentSummary } from "@/components/orders/order-fulfillment-card";
import { FulfillmentCreateForm } from "@/components/orders/fulfillment-create-form";
import { FulfillmentLifecycleActions } from "@/components/orders/fulfillment-lifecycle-actions";
import { fetchOrder } from "@/lib/api/orders";
import { fetchFulfillmentByOrder } from "@/lib/api/fulfillment";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface OrderFulfillmentPageProps {
  readonly params: Promise<{ readonly orderId: string }>;
}

/**
 * The Fulfillment detail screen (T5.4), keyed by `orderId` — the only key the backend supports
 * (`docs/plans/BLOCKERS.md`'s T5.4 ruling, same shape as T5.3's returns ruling: no `GET
 * /fulfillments` list route and no `GET /fulfillments/:fulfillmentOrderId` by-id route exist, so a
 * `/fulfillments` list screen or a by-id detail screen would both require fabricating data or
 * inventing a backend endpoint).
 *
 * Fetches the order first (for its header, back link, and — when no fulfillment exists yet — its
 * real line items to populate the create-fulfillment item picker via `fetchOrder`, never letting
 * the operator free-type a `productRef`). Then fetches the fulfillment itself
 * (`fetchFulfillmentByOrder`, the same read `OrderFulfillmentCard` already uses) to decide which of
 * the three states to render: the read summary + gated write actions (`ok`), the
 * create-a-fulfillment form (`not_found`), or an explicit unavailable message
 * (`unauthorized`/`error` — never fabricated).
 */
export default async function OrderFulfillmentPage({ params }: OrderFulfillmentPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { orderId } = await params;

  const orderResult = await fetchOrder(orderId);

  if (orderResult.outcome === "unauthorized") {
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
  if (orderResult.outcome === "not_found") {
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
  if (orderResult.outcome === "error") {
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

  const order = orderResult.order;
  const fulfillmentResult = await fetchFulfillmentByOrder(orderId);

  return (
    <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href={`/orders/${orderId}`}>
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.fulfillmentScreen.back}
            </Link>
          </Button>
          <h1 className="text-4xl font-semibold tracking-tight">{t.fulfillmentScreen.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">#{order.orderNumber}</p>
        </div>

        {fulfillmentResult.outcome === "ok" ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{t.orderDetail.fulfillment}</CardTitle>
              </CardHeader>
              <CardContent>
                <FulfillmentSummary fulfillment={fulfillmentResult.fulfillment} t={t} locale={locale} />
              </CardContent>
            </Card>
            <FulfillmentLifecycleActions
              orderId={orderId}
              fulfillmentOrderId={fulfillmentResult.fulfillment.id}
              status={fulfillmentResult.fulfillment.status}
              t={t}
            />
          </>
        ) : fulfillmentResult.outcome === "not_found" ? (
          <FulfillmentCreateForm orderId={orderId} items={order.items} t={t} />
        ) : (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-center text-sm">
              {t.orderDetail.fulfillmentUnavailable}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

/** Same shell as `app/orders/[orderId]/page.tsx`'s own `StatePanel` — used only for the order-level fetch failing, since without the order there is nothing on this screen to show. */
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
