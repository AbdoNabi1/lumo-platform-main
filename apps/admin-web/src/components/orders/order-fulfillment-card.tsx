import type { ReactNode } from "react";
import type { FulfillmentDetailDto } from "@/lib/api/fulfillment";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { FulfillmentStatusBadge } from "./order-status-badge";

/**
 * The read-only fulfillment summary shown on `app/orders/[orderId]/fulfillment/page.tsx` (the write
 * screen): status, items, carrier, tracking, delivery and packages, straight from the
 * `GET /orders/:orderId/fulfillment` DTO. (The order page itself no longer has a fulfillment card of
 * this kind: its fulfillment card lists the order's items and links here.)
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

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
