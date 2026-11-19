import { beforeEach, expect, it, vi } from "vitest";
import { MerchantCarrierSettings } from "../domain/merchant-carrier-settings";
import { InMemoryMerchantCarrierSettingsRepository } from "../infrastructure/in-memory-merchant-carrier-settings-repository";
import { InMemoryCarrierCredentialVault } from "../infrastructure/envelope-carrier-credential-vault";
import { TenantCarrierResolver } from "../infrastructure/tenant-carrier-resolver";
import { CarrierRegistry } from "./carrier-registry";
import type { FakeCarrierScript } from "../testing/carrier-doubles";
import { UniqueEntityId } from "@platform/domain";
import { Shipment } from "../domain/shipment";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";
import { Carrier, CarrierService } from "../domain/value-objects/carrier";
import { ShippingLabel } from "../domain/value-objects/shipping-label";
import { TrackingNumber } from "../domain/value-objects/tracking-number";
import { fakeRegistration, fixedClock, sequentialIds } from "../testing/carrier-doubles";
import { PostgresLikeShipmentRepository, TrackingUnitOfWork } from "../testing/shipping-doubles";
import { CancelCarrierShipment, PrintCarrierAwbs, GetShipment } from "./carrier-shipment.use-cases";
import { AdvanceShipment, CreateLabel, VoidLabel } from "./shipment-lifecycle.use-cases";

beforeEach(() => {
  expect.hasAssertions();
});
async function carrierHarness(script: FakeCarrierScript = {}, enabled = true) {
  const shipments = new PostgresLikeShipmentRepository();
  const unitOfWork = new TrackingUnitOfWork();
  const clock = fixedClock();
  const fake = fakeRegistration({ script, openCount: () => unitOfWork.openCount });
  const vault = new InMemoryCarrierCredentialVault();
  const settings = new InMemoryMerchantCarrierSettingsRepository();
  let config = MerchantCarrierSettings.empty().withCarrier("bosta", {
    config: {},
    sealedCredentials: await vault.seal("t", "bosta", { apiKey: "test" }),
    webhook: { sealedSecret: await vault.seal("t", "bosta:webhook", { secret: "test" }) },
  });
  if (enabled) config = config.withEnabled("bosta", true);
  await settings.save(config, "t");
  const carriers = new TenantCarrierResolver({
    settings,
    vault,
    registry: CarrierRegistry.from([fake.registration]),
  });
  const deps = {
    shipments,
    unitOfWork,
    clock,
    idGenerator: sequentialIds(),
    carriers,
    isCarrierManaged: (key: string) => key === "bosta",
  };
  const add = async (id = "s", key = "bosta", trackingNumber = "5108002") => {
    const pkg = ShipmentPackage.create(`p-${id}`, ["item"], 1);
    const carrier = Carrier.create(key);
    const service = CarrierService.create("standard");
    const label = ShippingLabel.create(`del-${id}`, trackingNumber, `del-${id}`);
    const tracking = TrackingNumber.create(trackingNumber);
    if (!pkg.ok || !carrier.ok || !service.ok || !label.ok || !tracking.ok)
      throw new Error("fixture");
    const shipment = Shipment.create(UniqueEntityId.from(id), `f-${id}`, [pkg.value]);
    shipment.beginLabelAttempt("1001-1", clock.now());
    shipment.createLabel(
      label.value,
      carrier.value,
      service.value,
      tracking.value,
      "event",
      clock.now(),
      "1001-1",
    );
    await shipments.save(shipment, "t");
  };
  await add();
  return {
    ...deps,
    fake,
    add,
    cancel: new CancelCarrierShipment(deps),
    print: new PrintCarrierAwbs(deps),
    advance: new AdvanceShipment(deps),
  };
}

it.each(["cancel", "print"] as const)(
  "%s returns 422 for an unregistered carrier",
  async (operation) => {
    const h = await carrierHarness();
    await h.add("unknown", "aramex", "unknown-tn");
    const result =
      operation === "cancel"
        ? await h.cancel.execute({ tenantId: "t", shipmentId: "unknown" })
        : await h.print.execute({ tenantId: "t", shipmentIds: ["unknown"] });
    expect(!result.ok && result.error).toMatchObject({ code: "CARRIER_UNKNOWN", httpStatus: 422 });
  },
);

it("legacy void on a managed carrier shipment is refused", async () => {
  const shipments = new PostgresLikeShipmentRepository();
  const uow = new TrackingUnitOfWork();
  const pkg = ShipmentPackage.create("p", ["i"], 1);
  const carrier = Carrier.create("bosta");
  const service = CarrierService.create("standard");
  const label = ShippingLabel.create("del-1", "5108002", "del-1");
  const tracking = TrackingNumber.create("5108002");
  if (!pkg.ok || !carrier.ok || !service.ok || !label.ok || !tracking.ok)
    throw new Error("fixture");
  const shipment = Shipment.create(UniqueEntityId.from("s"), "f", [pkg.value]);
  shipment.createLabel(label.value, carrier.value, service.value, tracking.value, "e", new Date());
  await shipments.save(shipment, "t");
  let calls = 0;
  const useCase = new VoidLabel({
    shipments,
    unitOfWork: uow,
    clock: fixedClock(),
    idGenerator: sequentialIds(),
    isCarrierManaged: (key) => key === "bosta",
    carrierProvider: {
      createLabel: () => Promise.reject(new Error("unexpected")),
      voidLabel: () => {
        calls++;
        return Promise.resolve();
      },
    },
  });
  const result = await useCase.execute({ tenantId: "t", shipmentId: "s" });
  expect(!result.ok && result.error.code).toBe("CARRIER_USE_CANCEL");
  expect(calls).toBe(0);
  expect((await shipments.findById("s", "t"))?.status.value).toBe("label_created");
  const advance = new AdvanceShipment({
    shipments,
    unitOfWork: uow,
    clock: fixedClock(),
    idGenerator: sequentialIds(),
    isCarrierManaged: (key) => key === "bosta",
  });
  const advanced = await advance.execute({
    tenantId: "t",
    shipmentId: "s",
    toStatus: "carrier_accepted",
  });
  expect(!advanced.ok && advanced.error.code).toBe("CARRIER_USE_CANCEL");
});
it.each(["cancelled", "not_found"] as const)("terminate %s settles voided", async (answer) => {
  const h = await carrierHarness({ cancel: [answer] });
  const result = await h.cancel.execute({ tenantId: "t", shipmentId: "s" });
  expect(result.ok && result.value).toMatchObject({ status: "voided", fulfillmentRef: "f-s" });
  expect(h.fake.record.cancelCalls).toEqual(["5108002"]);
  expect(h.fake.record.cancelOpenCounts).toEqual([0]);
});
it.each([
  ["rejected", "CARRIER_CANCEL_REFUSED", 409],
  ["unavailable", "CARRIER_UNAVAILABLE", 503],
] as const)("cancel %s leaves the shipment unchanged", async (fail, code, httpStatus) => {
  const h = await carrierHarness({ cancel: [{ fail }] });
  const result = await h.cancel.execute({ tenantId: "t", shipmentId: "s" });
  expect(!result.ok && result.error).toMatchObject({ code, httpStatus });
  expect((await h.shipments.findById("s", "t"))?.status.value).toBe("label_created");
  expect(h.fake.record.cancelOpenCounts).toEqual([0]);
});
it("in transit cannot cancel and never calls the carrier", async () => {
  const h = await carrierHarness();
  const shipment = (await h.shipments.findById("s", "t"))!;
  shipment.acceptByCarrier("accept", h.clock.now());
  shipment.markInTransit("transit", h.clock.now());
  await h.shipments.save(shipment, "t");
  const result = await h.cancel.execute({ tenantId: "t", shipmentId: "s" });
  expect(!result.ok && result.error).toMatchObject({
    code: "CARRIER_CANCEL_NOT_ALLOWED",
    httpStatus: 409,
  });
  expect(h.fake.record.cancelCalls).toEqual([]);
});
it("already voided cancellation is idempotent without a call", async () => {
  const h = await carrierHarness();
  const shipment = (await h.shipments.findById("s", "t"))!;
  shipment.voidLabel("void", h.clock.now());
  await h.shipments.save(shipment, "t");
  const result = await h.cancel.execute({ tenantId: "t", shipmentId: "s" });
  expect(result.ok && result.value.status).toBe("voided");
  expect(h.fake.record.cancelCalls).toEqual([]);
});
it("disabled but configured carrier cancels an existing shipment", async () => {
  const h = await carrierHarness({}, false);
  const result = await h.cancel.execute({ tenantId: "t", shipmentId: "s" });
  expect(result.ok && result.value.status).toBe("voided");
  expect(h.fake.record.cancelCalls).toEqual(["5108002"]);
});
it("print enforces limits and deduplicates, passing explicit or default options", async () => {
  const h = await carrierHarness();
  for (const shipmentIds of [[], Array.from({ length: 51 }, (_, i) => String(i))]) {
    const result = await h.print.execute({ tenantId: "t", shipmentIds });
    expect(!result.ok && result.error.code).toBe("VALIDATION");
  }
  expect((await h.print.execute({ tenantId: "t", shipmentIds: ["s", "s"] })).ok).toBe(true);
  expect(h.fake.record.printCalls).toEqual([[["5108002"], {}]]);
  expect((await h.print.execute({ tenantId: "t", shipmentIds: ["s"], format: "A4" })).ok).toBe(
    true,
  );
  expect(h.fake.record.printCalls[1]).toEqual([["5108002"], { format: "A4" }]);
  expect(h.fake.record.printOpenCounts).toEqual([0, 0]);
});
it("print refuses voided, foreign tenant, and mixed carrier selections", async () => {
  const h = await carrierHarness();
  await h.add("other", "othercarrier", "5108003");
  const mixed = await h.print.execute({ tenantId: "t", shipmentIds: ["s", "other"] });
  expect(!mixed.ok && mixed.error).toMatchObject({ code: "AWB_MIXED_CARRIERS", httpStatus: 422 });
  const foreign = await h.print.execute({ tenantId: "foreign", shipmentIds: ["s"] });
  expect(!foreign.ok && foreign.error.code).toBe("NOT_FOUND");
  expect((await h.cancel.execute({ tenantId: "t", shipmentId: "s" })).ok).toBe(true);
  const voided = await h.print.execute({ tenantId: "t", shipmentIds: ["s"] });
  expect(!voided.ok && voided.error).toMatchObject({ code: "AWB_NOT_AVAILABLE", httpStatus: 409 });
  expect(h.fake.record.printCalls).toEqual([]);
});
it("carrier cancellation allows voided to created but legacy label stays refused", async () => {
  const h = await carrierHarness();
  const forbidden = await h.advance.execute({
    tenantId: "t",
    shipmentId: "s",
    toStatus: "in_transit",
  });
  expect(!forbidden.ok && forbidden.error.code).toBe("CARRIER_USE_CANCEL");
  expect((await h.cancel.execute({ tenantId: "t", shipmentId: "s" })).ok).toBe(true);
  expect(
    (await h.advance.execute({ tenantId: "t", shipmentId: "s", toStatus: "created" })).ok,
  ).toBe(true);
  let legacyCalls = 0;
  const legacy = new CreateLabel({
    ...h,
    carrierProvider: {
      createLabel: () => {
        legacyCalls++;
        return Promise.reject(new Error("unexpected"));
      },
      voidLabel: () => Promise.resolve(),
    },
  });
  const result = await legacy.execute({ tenantId: "t", shipmentId: "s" });
  expect(!result.ok && result.error.code).toBe("CARRIER_USE_CANCEL");
  expect(legacyCalls).toBe(0);
  expect((await h.shipments.findById("s", "t"))?.status.value).toBe("created");
});
it("carrier history blocks legacy labelling even when the carrier is no longer registered", async () => {
  const h = await carrierHarness();
  expect((await h.cancel.execute({ tenantId: "t", shipmentId: "s" })).ok).toBe(true);
  expect(
    (await h.advance.execute({ tenantId: "t", shipmentId: "s", toStatus: "created" })).ok,
  ).toBe(true);
  let calls = 0;
  const legacy = new CreateLabel({
    ...h,
    isCarrierManaged: () => false,
    carrierProvider: {
      createLabel: () => {
        calls++;
        return Promise.reject(new Error("unexpected"));
      },
      voidLabel: () => Promise.resolve(),
    },
  });
  const result = await legacy.execute({ tenantId: "t", shipmentId: "s" });
  expect(!result.ok && result.error.code).toBe("CARRIER_USE_CANCEL");
  expect(calls).toBe(0);
});
it("legacy void remains available for unregistered carriers", async () => {
  const h = await carrierHarness();
  await h.add("unmanaged", "legacy", "legacy-tn");
  let calls = 0;
  const legacy = new VoidLabel({
    ...h,
    carrierProvider: {
      createLabel: () => Promise.reject(new Error("unexpected")),
      voidLabel: () => {
        calls++;
        return Promise.resolve();
      },
    },
  });
  const result = await legacy.execute({ tenantId: "t", shipmentId: "unmanaged" });
  expect(result.ok && result.value.status).toBe("voided");
  expect(calls).toBe(1);
});

it("a pending carrier cancel that settles after a new label never voids it", async () => {
  const h = await carrierHarness();
  const resolve = h.carriers.resolve.bind(h.carriers);
  vi.spyOn(h.carriers, "resolve").mockImplementation(async (...args) => {
    const provider = await resolve(...args);
    vi.spyOn(provider, "cancelDelivery").mockImplementation(async () => {
      const shipment = (await h.shipments.findById("s", "t"))!;
      shipment.voidLabel("void", h.clock.now());
      shipment.transition("created", "reopen", h.clock.now());
      shipment.beginLabelAttempt("1001-2", h.clock.now());
      const carrier = Carrier.create("bosta");
      const service = CarrierService.create("standard");
      const label = ShippingLabel.create("new", "new-tn", "new");
      const tracking = TrackingNumber.create("new-tn");
      if (!carrier.ok || !service.ok || !label.ok || !tracking.ok) throw new Error("fixture");
      shipment.createLabel(
        label.value,
        carrier.value,
        service.value,
        tracking.value,
        "new",
        h.clock.now(),
        "1001-2",
      );
      await h.shipments.save(shipment, "t");
      return "cancelled";
    });
    return provider;
  });
  const result = await h.cancel.execute({ tenantId: "t", shipmentId: "s" });
  expect(!result.ok && result.error.code).toBe("CARRIER_CANCEL_NOT_ALLOWED");
  expect((await h.shipments.findById("s", "t"))?.trackingNumber?.value).toBe("new-tn");
  expect((await h.shipments.findById("s", "t"))?.status.value).toBe("label_created");
});
it("cancel before pickup terminates then voids", async () => {
  const shipments = new PostgresLikeShipmentRepository();
  const uow = new TrackingUnitOfWork();
  const fake = fakeRegistration({ openCount: () => uow.openCount });
  const pkg = ShipmentPackage.create("p", ["i"], 1);
  const carrier = Carrier.create("bosta");
  const service = CarrierService.create("standard");
  const label = ShippingLabel.create("del-1", "5108002", "del-1");
  const tracking = TrackingNumber.create("5108002");
  if (!pkg.ok || !carrier.ok || !service.ok || !label.ok || !tracking.ok)
    throw new Error("fixture");
  const shipment = Shipment.create(UniqueEntityId.from("s"), "f", [pkg.value]);
  shipment.createLabel(label.value, carrier.value, service.value, tracking.value, "e", new Date());
  await shipments.save(shipment, "t");
  const provider = fake.registration.create({ credentials: {}, config: {}, webhookHeaders: {} });
  const useCase = new CancelCarrierShipment({
    shipments,
    unitOfWork: uow,
    clock: fixedClock(),
    idGenerator: sequentialIds(),
    carriers: { resolve: () => Promise.resolve(provider) },
  });
  const result = await useCase.execute({ tenantId: "t", shipmentId: "s" });
  expect(result.ok && result.value).toMatchObject({ status: "voided", fulfillmentRef: "f" });
  expect(fake.record.cancelCalls).toEqual(["5108002"]);
  expect(fake.record.cancelOpenCounts).toEqual([0]);
  const print = new PrintCarrierAwbs({
    shipments,
    unitOfWork: uow,
    clock: fixedClock(),
    idGenerator: sequentialIds(),
    carriers: { resolve: () => Promise.resolve(provider) },
  });
  const unavailable = await print.execute({ tenantId: "t", shipmentIds: ["s"] });
  expect(!unavailable.ok && unavailable.error.code).toBe("AWB_NOT_AVAILABLE");
  const foreign = await print.execute({ tenantId: "other", shipmentIds: ["s"] });
  expect(!foreign.ok && foreign.error.code).toBe("NOT_FOUND");
  const get = new GetShipment({
    shipments,
    unitOfWork: uow,
    clock: fixedClock(),
    idGenerator: sequentialIds(),
  });
  expect((await get.execute({ tenantId: "t", shipmentId: "s" })).ok).toBe(true);
});
