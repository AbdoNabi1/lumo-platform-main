import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { Shipment } from "../domain/shipment";
import { Carrier, CarrierService } from "../domain/value-objects/carrier";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";
import { ShippingLabel } from "../domain/value-objects/shipping-label";
import { TrackingNumber } from "../domain/value-objects/tracking-number";
import { PostgresLikeShipmentRepository, TrackingUnitOfWork } from "./shipping-doubles";

function unwrap<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function newShipment(id: string, fulfillmentRef = "fulfillment-1"): Shipment {
  const pkg = unwrap(ShipmentPackage.create("pkg-1", ["item-1"], 1));
  return Shipment.create(UniqueEntityId.from(id), fulfillmentRef, [pkg]);
}

function labelled(id: string): Shipment {
  const s = newShipment(id);
  s.createLabel(
    unwrap(ShippingLabel.create("del-1", "5108002", "del-1")),
    unwrap(Carrier.create("bosta")),
    unwrap(CarrierService.create("standard")),
    unwrap(TrackingNumber.create("5108002")),
    "evt-1",
    new Date(0),
  );
  return s;
}

beforeEach(() => {
  expect.hasAssertions();
});

describe("PostgresLikeShipmentRepository", () => {
  it("buckets rows by tenant: another tenant's id, ref and tracking number are not found", async () => {
    const repo = new PostgresLikeShipmentRepository();
    await repo.save(labelled("ship-1"), "t-1");

    expect(await repo.findById("ship-1", "t-1")).not.toBeNull();
    expect(await repo.findById("ship-1", "t-2")).toBeNull();
    expect(await repo.findByFulfillmentRef("fulfillment-1", "t-2")).toBeNull();
    expect(await repo.findByTrackingNumber("bosta", "5108002", "t-1")).not.toBeNull();
    expect(await repo.findByTrackingNumber("bosta", "5108002", "t-2")).toBeNull();
    expect(await repo.findByTrackingNumber("aramex", "5108002", "t-1")).toBeNull();
    expect(await repo.findByIdempotencyKey()).toBeNull();
  });

  it("keeps the same id in two tenants apart", async () => {
    const repo = new PostgresLikeShipmentRepository();
    await repo.save(newShipment("ship-1"), "t-1");
    await repo.save(newShipment("ship-1"), "t-2");
    expect(repo.size()).toBe(2);
    expect(repo.size("t-1")).toBe(1);
  });

  it("findByFulfillmentRef returns a fresh copy of the newest shipment (F4)", async () => {
    const repo = new PostgresLikeShipmentRepository();
    const old = newShipment("ship-old");
    await repo.save(old, "t-1");
    await repo.save(newShipment("ship-new"), "t-1");
    const reread = await repo.findById("ship-old", "t-1");
    if (reread === null) throw new Error("seed failed");
    reread.cancel("evt-1", new Date(0));
    await repo.save(reread, "t-1");

    const found = await repo.findByFulfillmentRef("fulfillment-1", "t-1");
    expect(found?.id.toString()).toBe("ship-new");
    expect(found?.version).toBe(1);
    expect(found).not.toBe(await repo.findByFulfillmentRef("fulfillment-1", "t-1"));
  });

  it("refuses a stale version with ConcurrencyError", async () => {
    const repo = new PostgresLikeShipmentRepository();
    await repo.save(newShipment("ship-1"), "t-1");
    const a = await repo.findById("ship-1", "t-1");
    const b = await repo.findById("ship-1", "t-1");
    if (a === null || b === null) throw new Error("seed failed");
    a.cancel("evt-1", new Date(0));
    await repo.save(a, "t-1");
    b.cancel("evt-2", new Date(0));
    await expect(repo.save(b, "t-1")).rejects.toBeInstanceOf(ConcurrencyError);
  });
});

describe("TrackingUnitOfWork", () => {
  it("counts open transactions while work runs and after it fails", async () => {
    const uow = new TrackingUnitOfWork();
    const inside = await uow.run(() => Promise.resolve(uow.openCount));
    expect(inside).toBe(1);
    await expect(uow.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(uow.openCount).toBe(0);
  });
});
