import type { ReactNode } from "react";
import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@platform/ui";
import { fetchFulfillmentByOrder } from "@/lib/api/fulfillment";
import type { ShipmentDetailDto } from "@/lib/api/shipping";
import { fetchShipmentByFulfillment } from "@/lib/api/shipping";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { ShipmentStatusBadge } from "./order-status-badge";

/**
 * The read-only shipment summary — factored out of `OrderShippingCard` (T5.4, same technique
 * `order-returns-card.tsx`'s `ReturnSummary` used for T5.3) so both this card (Order Detail's
 * Shipping panel) and `app/orders/[orderId]/shipment/page.tsx` (the write screen) render the exact
 * same fields from the exact same `GET /fulfillments/:fulfillmentOrderId/shipment` DTO, with no
 * duplicated display logic to drift.
 */
export function ShipmentSummary({
  shipment,
  t,
  locale,
}: {
  readonly shipment: ShipmentDetailDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      <Row label={t.orderDetail.shippingStatus}>
        <ShipmentStatusBadge status={shipment.status} t={t} />
      </Row>
      {shipment.carrier !== null && (
        <Row label={t.orderDetail.shippingCarrier}>
          <span>{shipment.carrier}</span>
        </Row>
      )}
      {shipment.carrierService !== null && (
        <Row label={t.orderDetail.shippingService}>
          <span>{shipment.carrierService}</span>
        </Row>
      )}
      <Row label={t.orderDetail.shippingTracking}>
        {shipment.trackingNumber !== null ? (
          <span className="font-mono text-xs">{shipment.trackingNumber}</span>
        ) : (
          <span className="text-muted-foreground">
            {t.orderDetail.shippingTrackingUrlUnavailable}
          </span>
        )}
      </Row>
      {shipment.shippedAt !== null && (
        <p className="text-muted-foreground text-xs">
          {t.orderDetail.shippingShipped.replace("{date}", formatDateTime(locale, shipment.shippedAt))}
        </p>
      )}
      {shipment.deliveredAt !== null && (
        <p className="text-muted-foreground text-xs">
          {t.orderDetail.shippingDelivered.replace(
            "{date}",
            formatDateTime(locale, shipment.deliveredAt),
          )}
        </p>
      )}
    </dl>
  );
}

/**
 * Shipping is keyed off the fulfillment order, not the order itself (`Shipment.fulfillmentRef`
 * has no direct order reference — `services/shipping`'s own domain model, confirmed by
 * `PrismaShipmentRepository`). So this resolves in two hops: `GET /orders/:orderId/fulfillment`
 * to find the fulfillment order, then `GET /fulfillments/:fulfillmentOrderId/shipment` — both
 * newly added read paths (Phase A.30), neither context had one before. An async Server Component
 * in its own `<Suspense>` boundary so a slow/failed lookup never blocks the rest of the order.
 * Never fabricates a tracking URL — Shipping's `Carrier` is provider-agnostic by design and owns
 * no URL template.
 *
 * T5.4: adds the "Manage shipment" / "Open a shipment" link to the new write screen
 * (`/orders/[orderId]/shipment`, keyed by `orderId` per the ruling — the page itself re-does this
 * same fulfillment-then-shipment chain) whenever a fulfillment exists at all (`ok` from the
 * fulfillment lookup) — even before a shipment itself exists, since the write screen's own
 * `not_found` branch is exactly where a shipment gets created. No link is shown when there is no
 * fulfillment yet (`shippingNotYetFulfilled`), matching the ruling: "if there is no fulfillment
 * yet, there cannot be a shipment either."
 */
export async function OrderShippingCard({
  orderId,
  t,
  locale,
}: {
  readonly orderId: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const fulfillmentResult = await fetchFulfillmentByOrder(orderId);

  if (fulfillmentResult.outcome !== "ok") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.orderDetail.shippingPanel}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {fulfillmentResult.outcome === "not_found"
              ? t.orderDetail.shippingNotYetFulfilled
              : t.orderDetail.shippingUnavailable}
          </p>
        </CardContent>
      </Card>
    );
  }

  const result = await fetchShipmentByFulfillment(fulfillmentResult.fulfillment.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.shippingPanel}</CardTitle>
      </CardHeader>
      <CardContent>
        {result.outcome === "ok" ? (
          <div className="flex flex-col gap-3">
            <ShipmentSummary shipment={result.shipment} t={t} locale={locale} />
            <Button variant="outline" size="sm" asChild className="self-start">
              <Link href={`/orders/${orderId}/shipment`}>{t.orderDetail.manageShipment}</Link>
            </Button>
          </div>
        ) : result.outcome === "not_found" ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground text-sm">{t.orderDetail.shippingNotRequested}</p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/orders/${orderId}/shipment`}>{t.orderDetail.openShipment}</Link>
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t.orderDetail.shippingUnavailable}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function OrderShippingCardSkeleton({ t }: { readonly t: Dictionary }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>{t.orderDetail.shippingPanel}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}
