import type { ReactNode } from "react";
import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@platform/ui";
import type { FulfillmentDetailDto } from "@/lib/api/fulfillment";
import { fetchFulfillmentByOrder } from "@/lib/api/fulfillment";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { FulfillmentStatusBadge } from "./order-status-badge";

/**
 * The read-only fulfillment summary — factored out of `OrderFulfillmentCard` (T5.4, same technique
 * `order-returns-card.tsx`'s `ReturnSummary` used for T5.3) so both this card (Order Detail's
 * Fulfillment panel) and `app/orders/[orderId]/fulfillment/page.tsx` (the write screen) render the
 * exact same fields from the exact same `GET /orders/:orderId/fulfillment` DTO, with no duplicated
 * display logic to drift. Adds the `packages` list the original card never rendered — real DTO
 * data that was simply unused before this task.
 */
export function FulfillmentSummary({
  fulfillment,
  t,
  locale,
}: {
  readonly fulfillment: FulfillmentDetailDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      <Row label={t.orderDetail.fulfillmentStatus}>
        <FulfillmentStatusBadge status={fulfillment.status} t={t} />
      </Row>
      <Row label={t.orderDetail.fulfillmentItems}>
        <span className="tabular-nums">{fulfillment.items.length}</span>
      </Row>
      {fulfillment.carrier !== null && (
        <Row label={t.orderDetail.fulfillmentCarrier}>
          <span>{fulfillment.carrier}</span>
        </Row>
      )}
      {fulfillment.carrierShipmentId !== null && (
        <Row label={t.orderDetail.fulfillmentCarrierShipmentId}>
          <span className="font-mono text-xs">{fulfillment.carrierShipmentId}</span>
        </Row>
      )}
      {fulfillment.trackingNumber !== null && (
        <Row label={t.orderDetail.fulfillmentTracking}>
          <span className="font-mono text-xs">{fulfillment.trackingNumber}</span>
        </Row>
      )}
      {fulfillment.deliveredAt !== null && (
        <p className="text-muted-foreground text-xs">
          {t.orderDetail.fulfillmentDelivered.replace(
            "{date}",
            formatDateTime(locale, fulfillment.deliveredAt),
          )}
        </p>
      )}
      {fulfillment.packages.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.fulfillmentScreen.packages}
          </p>
          <ul className="flex flex-col gap-1">
            {fulfillment.packages.map((pkg) => (
              <li key={pkg.reference} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground truncate">{pkg.reference}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {pkg.itemRefs.length} × {pkg.weightGrams}g
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </dl>
  );
}

/**
 * Resolves the order's fulfillment via `GET /orders/:orderId/fulfillment` (Phase A.30 —
 * Fulfillment previously had no read API keyed by order reference; `FulfillmentOrderRepository.
 * findByOrderRef` closed that gap). An async Server Component in its own `<Suspense>` boundary so
 * a slow/failed Fulfillment lookup never blocks the rest of the order from rendering.
 *
 * T5.4: adds the "Manage fulfillment" / "Open a fulfillment" link to the new write screen
 * (`/orders/[orderId]/fulfillment`) in the two outcomes where the link is meaningful — `ok` (a
 * fulfillment already exists to manage) and `not_found` (none exists yet, but one can be opened
 * there). The card's own read-only body (now `FulfillmentSummary`) is otherwise unchanged.
 */
export async function OrderFulfillmentCard({
  orderId,
  t,
  locale,
}: {
  readonly orderId: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const result = await fetchFulfillmentByOrder(orderId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.fulfillment}</CardTitle>
      </CardHeader>
      <CardContent>
        {result.outcome === "ok" ? (
          <div className="flex flex-col gap-3">
            <FulfillmentSummary fulfillment={result.fulfillment} t={t} locale={locale} />
            <Button variant="outline" size="sm" asChild className="self-start">
              <Link href={`/orders/${orderId}/fulfillment`}>{t.orderDetail.manageFulfillment}</Link>
            </Button>
          </div>
        ) : result.outcome === "not_found" ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground text-sm">{t.orderDetail.fulfillmentNotRequested}</p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/orders/${orderId}/fulfillment`}>{t.orderDetail.openFulfillment}</Link>
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t.orderDetail.fulfillmentUnavailable}</p>
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

export function OrderFulfillmentCardSkeleton({ t }: { readonly t: Dictionary }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>{t.orderDetail.fulfillment}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}
