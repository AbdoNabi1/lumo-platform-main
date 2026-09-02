import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { Shipment } from "../domain/shipment";
import {
  ShippingAttempt,
  type ShippingAttemptKind,
  type ShippingAttemptOutcome,
} from "../domain/shipping-attempt";
import { TrackingEvent } from "../domain/tracking-event";
import { DeliveryEstimate } from "../domain/value-objects/delivery-estimate";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";
import { Carrier, CarrierService } from "../domain/value-objects/carrier";
import { ShippingLabel } from "../domain/value-objects/shipping-label";
import { TrackingNumber } from "../domain/value-objects/tracking-number";
import { ShipmentStatus, type ShipmentStatusValue } from "../domain/value-objects/shipment-status";

export interface ShipmentPackageJson {
  readonly reference: string;
  readonly itemRefs: readonly string[];
  readonly weightGrams: number;
}
export interface ShippingLabelJson {
  readonly labelId: string;
  readonly trackingNumber: string;
}
export interface DeliveryEstimateJson {
  readonly windowStart: string;
  readonly windowEnd: string;
}
export interface TrackingEventJson {
  readonly id: string;
  readonly description: string;
  readonly location: string | null;
  readonly occurredAt: string;
}

export interface ShipmentRow {
  readonly id: string;
  readonly fulfillmentRef: string;
  readonly packages: readonly ShipmentPackageJson[];
  readonly status: string;
  readonly carrier: string | null;
  readonly carrierService: string | null;
  readonly label: ShippingLabelJson | Record<string, never>;
  readonly trackingNumber: string | null;
  readonly trackingEvents: readonly TrackingEventJson[];
  readonly deliveryEstimate: DeliveryEstimateJson | Record<string, never>;
  readonly deliveredAt: Date | null;
  readonly version: number;
}
export interface AttemptRow {
  readonly id: string;
  readonly kind: string;
  readonly outcome: string;
  readonly reference: string | null;
  readonly occurredAt: Date;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt shipment row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

function isSet<T extends object>(value: T | Record<string, never>): value is T {
  return Object.keys(value).length > 0;
}

/** Persistence ↔ aggregate mapping for {@link Shipment}. Mapping only — no I/O. */
export class ShipmentMapper {
  static toDomain(row: ShipmentRow, attempts: readonly AttemptRow[] = []): Shipment {
    return Shipment.reconstitute(
      UniqueEntityId.from(row.id),
      row.fulfillmentRef,
      row.packages.map((pkg) =>
        must(
          ShipmentPackage.create(pkg.reference, pkg.itemRefs, pkg.weightGrams),
          "shipment package",
        ),
      ),
      ShipmentStatus.from(row.status as ShipmentStatusValue),
      row.version,
      {
        attempts: attempts.map((a) =>
          ShippingAttempt.create(
            UniqueEntityId.from(a.id),
            a.kind as ShippingAttemptKind,
            a.outcome as ShippingAttemptOutcome,
            a.occurredAt,
            a.reference ?? undefined,
          ),
        ),
        trackingEvents: row.trackingEvents.map((t) =>
          TrackingEvent.create(
            UniqueEntityId.from(t.id),
            t.description,
            new Date(t.occurredAt),
            t.location ?? undefined,
          ),
        ),
        carrier: row.carrier === null ? undefined : must(Carrier.create(row.carrier), "carrier"),
        carrierService:
          row.carrierService === null
            ? undefined
            : must(CarrierService.create(row.carrierService), "carrier service"),
        label: isSet(row.label)
          ? must(
              ShippingLabel.create(row.label.labelId, row.label.trackingNumber),
              "shipping label",
            )
          : undefined,
        trackingNumber:
          row.trackingNumber === null
            ? undefined
            : must(TrackingNumber.create(row.trackingNumber), "tracking number"),
        deliveryEstimate: isSet(row.deliveryEstimate)
          ? must(
              DeliveryEstimate.create(
                new Date(row.deliveryEstimate.windowStart),
                new Date(row.deliveryEstimate.windowEnd),
              ),
              "delivery estimate",
            )
          : undefined,
        deliveredAt: row.deliveredAt ?? undefined,
      },
    );
  }

  static toRow(shipment: Shipment, tenantId: string) {
    return {
      id: shipment.id.toString(),
      tenantId,
      fulfillmentRef: shipment.fulfillmentRef,
      packages: shipment.packages.map((pkg) => ({
        reference: pkg.reference,
        itemRefs: [...pkg.itemRefs],
        weightGrams: pkg.weightGrams,
      })),
      status: shipment.status.value,
      carrier: shipment.carrier?.value ?? null,
      carrierService: shipment.carrierService?.value ?? null,
      label:
        shipment.label === undefined
          ? {}
          : { labelId: shipment.label.labelId, trackingNumber: shipment.label.trackingNumber },
      trackingNumber: shipment.trackingNumber?.value ?? null,
      trackingEvents: shipment.trackingEvents.map((t) => ({
        id: t.id.toString(),
        description: t.description,
        location: t.location ?? null,
        occurredAt: t.occurredAt.toISOString(),
      })),
      deliveryEstimate:
        shipment.deliveryEstimate === undefined
          ? {}
          : {
              windowStart: shipment.deliveryEstimate.windowStart.toISOString(),
              windowEnd: shipment.deliveryEstimate.windowEnd.toISOString(),
            },
      deliveredAt: shipment.deliveredAt ?? null,
      version: 1,
    };
  }

  /** Full append-only attempt log; insertion uses `skipDuplicates` (PK = entity id). */
  static toAttemptRows(shipment: Shipment, tenantId: string) {
    return shipment.attempts.map((a) => ({
      id: a.id.toString(),
      tenantId,
      shipmentId: shipment.id.toString(),
      kind: a.kind,
      outcome: a.outcome,
      reference: a.reference ?? null,
      occurredAt: a.occurredAt,
    }));
  }
}
