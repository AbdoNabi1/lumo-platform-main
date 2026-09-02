import { ProductRef, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import {
  FulfillmentAttempt,
  type FulfillmentAttemptKind,
  type FulfillmentAttemptOutcome,
} from "../domain/fulfillment-attempt";
import { FulfillmentOrder } from "../domain/fulfillment-order";
import { FulfillmentItem } from "../domain/value-objects/fulfillment-item";
import { CarrierReference, TrackingNumber } from "../domain/value-objects/fulfillment-refs";
import {
  FulfillmentStatus,
  type FulfillmentStatusValue,
} from "../domain/value-objects/fulfillment-status";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";

export interface FulfillmentItemJson {
  readonly productRef: string;
  readonly quantity: number;
}
export interface CarrierReferenceJson {
  readonly carrier: string;
  readonly carrierShipmentId: string;
}
export interface ShipmentPackageJson {
  readonly reference: string;
  readonly itemRefs: readonly string[];
  readonly weightGrams: number;
}

export interface FulfillmentOrderRow {
  readonly id: string;
  readonly orderRef: string;
  readonly items: readonly FulfillmentItemJson[];
  readonly status: string;
  readonly carrierReference: CarrierReferenceJson | Record<string, never>;
  readonly trackingNumber: string | null;
  readonly packages: readonly ShipmentPackageJson[];
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
    throw new UnexpectedError(`Corrupt fulfillment row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

function isSet<T extends object>(value: T | Record<string, never>): value is T {
  return Object.keys(value).length > 0;
}

/** Persistence ↔ aggregate mapping for {@link FulfillmentOrder}. Mapping only — no I/O. */
export class FulfillmentOrderMapper {
  static toDomain(
    row: FulfillmentOrderRow,
    attempts: readonly AttemptRow[] = [],
  ): FulfillmentOrder {
    return FulfillmentOrder.reconstitute(
      UniqueEntityId.from(row.id),
      row.orderRef,
      row.items.map((itemJson) =>
        must(
          FulfillmentItem.create(
            must(ProductRef.create(itemJson.productRef), "item productRef"),
            itemJson.quantity,
          ),
          "fulfillment item",
        ),
      ),
      FulfillmentStatus.from(row.status as FulfillmentStatusValue),
      row.version,
      {
        attempts: attempts.map((a) =>
          FulfillmentAttempt.create(
            UniqueEntityId.from(a.id),
            a.kind as FulfillmentAttemptKind,
            a.outcome as FulfillmentAttemptOutcome,
            a.occurredAt,
            a.reference ?? undefined,
          ),
        ),
        packages: row.packages.map((pkg) =>
          must(
            ShipmentPackage.create(pkg.reference, pkg.itemRefs, pkg.weightGrams),
            "shipment package",
          ),
        ),
        carrierReference: isSet(row.carrierReference)
          ? must(
              CarrierReference.create(
                row.carrierReference.carrier,
                row.carrierReference.carrierShipmentId,
              ),
              "carrier reference",
            )
          : undefined,
        trackingNumber:
          row.trackingNumber === null
            ? undefined
            : must(TrackingNumber.create(row.trackingNumber), "tracking number"),
        deliveredAt: row.deliveredAt ?? undefined,
      },
    );
  }

  static toRow(fulfillmentOrder: FulfillmentOrder, tenantId: string) {
    return {
      id: fulfillmentOrder.id.toString(),
      tenantId,
      orderRef: fulfillmentOrder.orderRef,
      items: fulfillmentOrder.items.map((item) => ({
        productRef: item.productRef.value,
        quantity: item.quantity,
      })),
      status: fulfillmentOrder.status.value,
      carrierReference:
        fulfillmentOrder.carrierReference === undefined
          ? {}
          : {
              carrier: fulfillmentOrder.carrierReference.carrier,
              carrierShipmentId: fulfillmentOrder.carrierReference.carrierShipmentId,
            },
      trackingNumber: fulfillmentOrder.trackingNumber?.value ?? null,
      packages: fulfillmentOrder.packages.map((pkg) => ({
        reference: pkg.reference,
        itemRefs: [...pkg.itemRefs],
        weightGrams: pkg.weightGrams,
      })),
      deliveredAt: fulfillmentOrder.deliveredAt ?? null,
      version: 1,
    };
  }

  /** Full append-only attempt log; insertion uses `skipDuplicates` (PK = entity id). */
  static toAttemptRows(fulfillmentOrder: FulfillmentOrder, tenantId: string) {
    return fulfillmentOrder.attempts.map((a) => ({
      id: a.id.toString(),
      tenantId,
      fulfillmentOrderId: fulfillmentOrder.id.toString(),
      kind: a.kind,
      outcome: a.outcome,
      reference: a.reference ?? null,
      occurredAt: a.occurredAt,
    }));
  }
}
