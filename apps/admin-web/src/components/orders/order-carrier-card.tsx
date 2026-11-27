import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { CarrierShipmentViewDto } from "@/lib/api/carrier-shipments";
import type { OrderFulfillmentStatus } from "@/lib/api/orders";
import type { Locale } from "@/lib/i18n";
import { carrierLabel } from "@/lib/shipping/carrier-label";
import type { Dictionary } from "@/messages/en";
import { CancelShipmentButton, ShipAgainButton, ShipButton } from "./carrier-shipment-actions";
import { CopyButton } from "./copy-button";
import { ShipmentTimeline } from "./shipment-timeline";

/** Ruling 39: Bosta's public tracking page, without a parameter. */
const BOSTA_TRACKING_URL = "https://bosta.co/tracking-shipments";

const SHIPPABLE_FULFILLMENT: ReadonlySet<string> = new Set(["unfulfilled", "in_progress"]);
/** Statuses where the merchant sees the label: tracking, copy, track and print. */
const LABELLED: ReadonlySet<string> = new Set([
  "label_created",
  "carrier_accepted",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "returned",
]);
/** Statuses where shipping again is possible (the backend resumes or uses the next reference). */
const REPEATABLE: ReadonlySet<string> = new Set(["created", "voided", "cancelled", "closed"]);

/**
 * The order page's carrier card (spec §8.6). What it offers follows the shipment's state: ship,
 * the label with print / cancel, or the review note with "ship again". Renders nothing when there is
 * nothing to show or do.
 */
export function OrderCarrierCard({
  orderId,
  fulfillmentStatus,
  view,
  t,
  locale,
}: {
  readonly orderId: string;
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  readonly view: CarrierShipmentViewDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const copy = t.carrierShipping;
  const shipment = view.shipment;
  const carrier = view.carriers[0];
  const canShip = carrier !== undefined && SHIPPABLE_FULFILLMENT.has(fulfillmentStatus);
  const carrierName =
    carrier === undefined ? "" : carrierLabel(carrier.key, carrier.displayName, t);

  const shipButton =
    canShip && carrier !== undefined ? (
      <ShipButton orderId={orderId} carrierKey={carrier.key} carrierName={carrierName} t={t} />
    ) : null;

  let body: ReactNode = null;
  let timeline = false;

  if (shipment === null) {
    body = shipButton;
  } else if (
    shipment.status === "exception" ||
    (shipment.needsReview && shipment.status === "created")
  ) {
    body = (
      <div className="flex flex-col gap-3">
        <p role="note" className="text-sm">
          {copy.needsReview}
        </p>
        {shipment.needsReview && carrier !== undefined && (
          <ShipAgainButton
            orderId={orderId}
            shipmentId={shipment.id}
            carrierKey={carrier.key}
            t={t}
          />
        )}
      </div>
    );
  } else if (LABELLED.has(shipment.status) && shipment.trackingNumber !== null) {
    timeline = true;
    const trackingNumber = shipment.trackingNumber;
    const shipmentCarrier = shipment.carrier ?? carrier?.key ?? "bosta";
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">{copy.trackingNumber}</span>
          <div className="flex flex-wrap items-center gap-2">
            <bdi dir="auto" className="font-mono text-sm font-medium">
              {trackingNumber}
            </bdi>
            <CopyButton
              text={trackingNumber}
              label={t.orderPage.copy}
              copiedLabel={t.orderPage.copied}
              ariaLabel={`${t.orderPage.copy} ${copy.trackingNumber}`}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {shipmentCarrier === "bosta" && (
            <a
              className="text-primary text-sm underline-offset-4 hover:underline"
              href={BOSTA_TRACKING_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.trackOnCarrier}
            </a>
          )}
          <a
            className="text-primary text-sm underline-offset-4 hover:underline"
            href={`/orders/awb?orderIds=${encodeURIComponent(orderId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.printWaybill}
          </a>
          {shipment.status === "label_created" && (
            <CancelShipmentButton orderId={orderId} shipmentId={shipment.id} t={t} />
          )}
        </div>
      </div>
    );
  } else if (REPEATABLE.has(shipment.status)) {
    body = shipment.status === "closed" && !canShip ? null : shipButton;
  }

  if (body === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.cardTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {body}
        {timeline && shipment !== null && (
          <ShipmentTimeline events={shipment.trackingEvents} t={t} locale={locale} />
        )}
      </CardContent>
    </Card>
  );
}
