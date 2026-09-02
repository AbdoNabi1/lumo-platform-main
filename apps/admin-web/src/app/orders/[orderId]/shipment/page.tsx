import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ShipmentSummary } from "@/components/orders/order-shipping-card";
import { ShipmentCreateForm } from "@/components/orders/shipment-create-form";
import { ShipmentLifecycleActions } from "@/components/orders/shipment-lifecycle-actions";
import { fetchOrder } from "@/lib/api/orders";
import { fetchFulfillmentByOrder } from "@/lib/api/fulfillment";
import { fetchShipmentByFulfillment } from "@/lib/api/shipping";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface OrderShipmentPageProps {
  readonly params: Promise<{ readonly orderId: string }>;
}

/**
 * The Shipment detail screen (T5.4), keyed by `orderId` — the ruling's chosen key even though
 * Shipping itself keys on the fulfillment order, not the order (same reasoning
 * `OrderShippingCard` already uses: `Shipment.fulfillmentRef` has no direct order reference, so
 * this resolves in the same two-hop chain — `GET /orders/:orderId/fulfillment` then `GET
 * /fulfillments/:fulfillmentOrderId/shipment` — before the write screen can render anything).
 * `docs/plans/BLOCKERS.md`'s T5.4 ruling: no `GET /shipments` list route and no `GET
 * /shipments/:shipmentId` by-id route exist, so a `/shipments` list screen or a by-shipment-id
 * detail screen would both require fabricating data or inventing a backend endpoint.
 *
 * Renders one of four states: the order-level fetch failing (`unauthorized`/`not_found`/`error` —
 * shared `StatePanel`, same as every other order-scoped screen); no fulfillment yet (explicit
 * "not fulfilled yet" message, no create-shipment form offered at all — "if there is no
 * fulfillment yet, there cannot be a shipment either", per the ruling); a fulfillment exists and a
 * shipment already exists (`ok` — summary + gated write actions); a fulfillment exists but no
 * shipment yet (`not_found` — `ShipmentCreateForm`).
 */
export default async function OrderShipmentPage({ params }: OrderShipmentPageProps) {
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
  const header = (
    <div>
      <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
        <Link href={`/orders/${orderId}`}>
          <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
          {t.shipmentScreen.back}
        </Link>
      </Button>
      <h1 className="text-4xl font-semibold tracking-tight">{t.shipmentScreen.title}</h1>
      <p className="text-muted-foreground mt-1 text-sm">#{order.orderNumber}</p>
    </div>
  );

  const fulfillmentResult = await fetchFulfillmentByOrder(orderId);

  if (fulfillmentResult.outcome !== "ok") {
    return (
      <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {header}
          <Card>
            <CardContent className="text-muted-foreground py-8 text-center text-sm">
              {fulfillmentResult.outcome === "not_found"
                ? t.orderDetail.shippingNotYetFulfilled
                : t.orderDetail.shippingUnavailable}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const shipmentResult = await fetchShipmentByFulfillment(fulfillmentResult.fulfillment.id);

  return (
    <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {header}

        {shipmentResult.outcome === "ok" ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{t.orderDetail.shippingPanel}</CardTitle>
              </CardHeader>
              <CardContent>
                <ShipmentSummary shipment={shipmentResult.shipment} t={t} locale={locale} />
              </CardContent>
            </Card>
            <ShipmentLifecycleActions
              orderId={orderId}
              shipmentId={shipmentResult.shipment.id}
              status={shipmentResult.shipment.status}
              t={t}
            />
          </>
        ) : shipmentResult.outcome === "not_found" ? (
          <ShipmentCreateForm
            orderId={orderId}
            fulfillmentOrderId={fulfillmentResult.fulfillment.id}
            t={t}
          />
        ) : (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-center text-sm">
              {t.orderDetail.shippingUnavailable}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

/** Same shell as `app/orders/[orderId]/page.tsx`'s own `StatePanel` — used only for the order-level fetch failing. */
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
