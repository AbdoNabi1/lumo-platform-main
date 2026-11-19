import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { beforeEach, describe, expect, it } from "vitest";
import { Shipment } from "../domain/shipment";
import { Carrier, CarrierService } from "../domain/value-objects/carrier";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";
import { ShippingLabel } from "../domain/value-objects/shipping-label";
import { TrackingNumber } from "../domain/value-objects/tracking-number";
import { type AttemptRow, ShipmentMapper, type ShipmentRow } from "./shipment.mapper";

const AT = new Date("2026-11-12T10:00:00.000Z");

function unwrap<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function shipment(): Shipment {
  const pkg = unwrap(ShipmentPackage.create("pkg-1", ["item-1"], 1));
  return Shipment.create(
    UniqueEntityId.from("019a0000-0000-7000-8000-000000000001"),
    "fulfillment-1",
    [pkg],
  );
}

/** What the Prisma adapter hands back: the written row (JSON columns as stored) plus its attempts. */
function roundTrip(s: Shipment): Shipment {
  const row = ShipmentMapper.toRow(s, "t-1");
  const attempts: AttemptRow[] = ShipmentMapper.toAttemptRows(s, "t-1");
  return ShipmentMapper.toDomain(
    JSON.parse(JSON.stringify({ ...row, deliveredAt: null })) as ShipmentRow,
    attempts,
  );
}

beforeEach(() => {
  expect.hasAssertions();
});

describe("ShipmentMapper (local carriers)", () => {
  it("round-trips label.carrierDeliveryId", () => {
    const s = shipment();
    s.beginLabelAttempt("1001-1", AT);
    s.createLabel(
      unwrap(ShippingLabel.create("del-1", "5108002", "del-1")),
      unwrap(Carrier.create("bosta")),
      unwrap(CarrierService.create("standard")),
      unwrap(TrackingNumber.create("5108002")),
      "evt-1",
      AT,
      "1001-1",
    );

    expect(ShipmentMapper.toRow(s, "t-1").label).toEqual({
      labelId: "del-1",
      trackingNumber: "5108002",
      carrierDeliveryId: "del-1",
    });
    const back = roundTrip(s);
    expect(back.label?.carrierDeliveryId).toBe("del-1");
    expect(back.label?.trackingNumber).toBe("5108002");
  });

  it("writes no carrierDeliveryId key for a legacy label and reads an older row as undefined", () => {
    const s = shipment();
    s.createLabel(
      unwrap(ShippingLabel.create("label-1", "track-1")),
      unwrap(Carrier.create("ups")),
      unwrap(CarrierService.create("ground")),
      unwrap(TrackingNumber.create("track-1")),
      "evt-1",
      AT,
    );
    expect(ShipmentMapper.toRow(s, "t-1").label).toEqual({
      labelId: "label-1",
      trackingNumber: "track-1",
    });

    const olderRow: ShipmentRow = {
      id: "019a0000-0000-7000-8000-000000000001",
      fulfillmentRef: "fulfillment-1",
      packages: [{ reference: "pkg-1", itemRefs: ["item-1"], weightGrams: 1 }],
      status: "label_created",
      carrier: "ups",
      carrierService: "ground",
      label: { labelId: "label-1", trackingNumber: "track-1" },
      trackingNumber: "track-1",
      trackingEvents: [],
      deliveryEstimate: {},
      deliveredAt: null,
      version: 3,
    };
    const read = ShipmentMapper.toDomain(olderRow);
    expect(read.label?.labelId).toBe("label-1");
    expect(read.label?.carrierDeliveryId).toBeUndefined();
  });

  it("keeps a pending attempt open through toAttemptRows → toDomain", () => {
    const s = shipment();
    s.beginLabelAttempt("1001-1", AT);

    const rows = ShipmentMapper.toAttemptRows(s, "t-1");
    expect(rows).toEqual([
      expect.objectContaining({ kind: "label", outcome: "pending", reference: "1001-1" }),
    ]);
    expect(rows[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const back = roundTrip(s);
    expect(back.pendingLabelAttempt()?.reference).toBe("1001-1");
    expect(back.pendingLabelAttempt()?.outcome).toBe("pending");
    expect(back.nextLabelReference("1001")).toBe("1001-2");
  });
});
