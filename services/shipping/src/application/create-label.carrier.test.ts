import { beforeEach, describe, expect, it, vi } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Shipment } from "../domain/shipment";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";
import { MerchantCarrierSettings } from "../domain/merchant-carrier-settings";
import { InMemoryMerchantCarrierSettingsRepository } from "../infrastructure/in-memory-merchant-carrier-settings-repository";
import { InMemoryCarrierCredentialVault } from "../infrastructure/envelope-carrier-credential-vault";
import { TenantCarrierResolver } from "../infrastructure/tenant-carrier-resolver";
import { CarrierRegistry } from "./carrier-registry";
import {
  fakeRegistration,
  fixedClock,
  sequentialIds,
  type FakeCarrierScript,
} from "../testing/carrier-doubles";
import { PostgresLikeShipmentRepository, TrackingUnitOfWork } from "../testing/shipping-doubles";
import { CreateLabel, IN_FLIGHT_GRACE_MS, RetryShipment } from "./shipment-lifecycle.use-cases";

beforeEach(() => {
  expect.hasAssertions();
});

const details = {
  carrierKey: "bosta",
  reference: "1001",
  recipient: { name: "Sasuke", phone: "01065685435" },
  address: { line1: "Helwan street", city: "Helwan", province: "EG-C", country: "EG" },
  codAmountMinor: 5000,
  currency: "EGP",
  itemsCount: 2,
  description: "Desc.",
  packageImages: [],
};
async function harness(script: FakeCarrierScript = {}, enabled = true) {
  const shipments = new PostgresLikeShipmentRepository();
  const unitOfWork = new TrackingUnitOfWork();
  const clock = fixedClock();
  const fake = fakeRegistration({ script, openCount: () => unitOfWork.openCount });
  const vault = new InMemoryCarrierCredentialVault();
  const settings = new InMemoryMerchantCarrierSettingsRepository();
  let configured = MerchantCarrierSettings.empty().withCarrier("bosta", {
    config: {},
    sealedCredentials: await vault.seal("t", "bosta", { apiKey: "test" }),
    webhook: { sealedSecret: await vault.seal("t", "bosta:webhook", { secret: "test" }) },
  });
  if (enabled) configured = configured.withEnabled("bosta", true);
  await settings.save(configured, "t");
  const carriers = new TenantCarrierResolver({
    settings,
    registry: CarrierRegistry.from([fake.registration]),
    vault,
  });
  const pkg = ShipmentPackage.create("p", ["item"], 1);
  if (!pkg.ok) throw pkg.error;
  await shipments.save(Shipment.create(UniqueEntityId.from("s"), "f", [pkg.value]), "t");
  const deps = { shipments, unitOfWork, clock, idGenerator: sequentialIds() };
  const create = new CreateLabel({
    ...deps,
    carriers,
    carrierProvider: {
      createLabel: () => Promise.reject(new Error("legacy called")),
      voidLabel: () => Promise.resolve(),
    },
  });
  return {
    fake,
    clock,
    settings,
    configured,
    create,
    retry: new RetryShipment(deps),
    shipments,
    unitOfWork,
    carriers,
    shipment: () => shipments.findById("s", "t"),
    run: () => create.execute({ tenantId: "t", shipmentId: "s", carrier: details }),
  };
}

describe("CreateLabel carrier path", () => {
  it("a prepare problem writes no attempt (Review Focus 4)", async () => {
    const h = await harness({
      prepare: [{ code: "ADDRESS_NOT_SHIPPABLE", reason: "PROVINCE_MISSING" }],
    });
    const r = await h.run();
    expect(!r.ok && r.error).toMatchObject({
      code: "ADDRESS_NOT_SHIPPABLE",
      reason: "PROVINCE_MISSING",
      httpStatus: 422,
    });
    expect((await h.shipment())?.attempts).toHaveLength(0);
    expect(h.fake.record.createCalls).toHaveLength(0);
  });
  it("a timeout leaves the attempt pending; the retry finds the delivery by reference and creates nothing (Review Focus 2)", async () => {
    const h = await harness({
      create: [{ fail: "unavailable", timedOut: true }],
      find: [[{ deliveryId: "del-1", trackingNumber: "5108002" }]],
    });
    const first = await h.run();
    expect(!first.ok && first.error.code).toBe("CARRIER_TIMEOUT");
    expect((await h.shipment())?.pendingLabelAttempt()?.reference).toBe("1001-1");
    h.clock.advanceMs(IN_FLIGHT_GRACE_MS + 1);
    const retry = await h.run();
    expect(retry.ok && retry.value.trackingNumber).toBe("5108002");
    expect(h.fake.record.findCalls).toEqual(["1001-1"]);
    expect(h.fake.record.createCalls).toHaveLength(1);
    expect(h.fake.record.findOpenCounts).toEqual([0]);
    expect(h.fake.record.prepareCalls.map((x) => x.openCountAtCall)).toEqual([0]);
  });
  it("a retry inside 120 s is CARRIER_CREATE_IN_PROGRESS with no Bosta call (Ruling 5)", async () => {
    const h = await harness({ create: [{ fail: "unavailable", timedOut: true }] });
    await h.run();
    const retry = await h.run();
    expect(!retry.ok && retry.error.code).toBe("CARRIER_CREATE_IN_PROGRESS");
    expect(h.fake.record.createCalls).toHaveLength(1);
    expect(h.fake.record.findCalls).toHaveLength(0);
  });
  it("an ambiguous search parks the shipment; Retry ships as -2 (Ruling 2, 42)", async () => {
    const h = await harness({
      create: [
        { fail: "unavailable", timedOut: true },
        { deliveryId: "del-2", trackingNumber: "5108003" },
      ],
      find: [
        [
          { deliveryId: "a", trackingNumber: "1" },
          { deliveryId: "b", trackingNumber: "2" },
        ],
      ],
    });
    await h.run();
    h.clock.advanceMs(IN_FLIGHT_GRACE_MS + 1);
    const parked = await h.run();
    expect(!parked.ok && parked.error.code).toBe("CARRIER_RESULT_UNKNOWN");
    expect((await h.shipment())?.needsCarrierReview).toBe(true);
    const blocked = await h.run();
    expect(!blocked.ok && blocked.error.code).toBe("SHIPMENT_NEEDS_REVIEW");
    expect((await h.retry.execute({ tenantId: "t", shipmentId: "s" })).ok).toBe(true);
    const shipped = await h.run();
    expect(shipped.ok && shipped.value.trackingNumber).toBe("5108003");
    expect(h.fake.record.createCalls.map((c) => c.request.reference)).toEqual(["1001-1", "1001-2"]);
  });
  it.each(["unavailable", "credentials_rejected"] as const)(
    "search failure %s parks with no extra create",
    async (fail) => {
      const h = await harness({
        create: [{ fail: "unavailable", timedOut: true }],
        find: [{ fail }],
      });
      await h.run();
      h.clock.advanceMs(IN_FLIGHT_GRACE_MS + 1);
      const result = await h.run();
      expect(!result.ok && result.error.code).toBe("CARRIER_RESULT_UNKNOWN");
      expect(h.fake.record.createCalls).toHaveLength(1);
    },
  );
  it.each(["rejected", "credentials_rejected"] as const)(
    "resumed create %s parks for review",
    async (fail) => {
      const h = await harness({
        create: [{ fail: "unavailable", timedOut: true }, { fail }],
        find: [[]],
      });
      await h.run();
      h.clock.advanceMs(IN_FLIGHT_GRACE_MS + 1);
      const result = await h.run();
      expect(!result.ok && result.error.code).toBe("CARRIER_RESULT_UNKNOWN");
      expect((await h.shipment())?.needsCarrierReview).toBe(true);
      expect(h.fake.record.createCalls.map((c) => c.request.reference)).toEqual([
        "1001-1",
        "1001-1",
      ]);
    },
  );
  it("a refused preparation after zero search matches closes the pending attempt", async () => {
    const h = await harness({
      create: [{ fail: "unavailable", timedOut: true }],
      find: [[]],
      prepare: [null, { code: "ADDRESS_NOT_SHIPPABLE", reason: "PROVINCE_MISSING" }],
    });
    await h.run();
    h.clock.advanceMs(IN_FLIGHT_GRACE_MS + 1);
    const result = await h.run();
    expect(!result.ok && result.error).toMatchObject({
      code: "ADDRESS_NOT_SHIPPABLE",
      reason: "PROVINCE_MISSING",
      httpStatus: 422,
    });
    expect((await h.shipment())?.pendingLabelAttempt()).toBeUndefined();
    expect(h.fake.record.createCalls).toHaveLength(1);
    expect(h.fake.record.findOpenCounts).toEqual([0]);
    expect(h.fake.record.prepareCalls.map((c) => c.openCountAtCall)).toEqual([0, 0]);
  });
  it("a fresh 4xx closes the attempt and the next create uses -2", async () => {
    const h = await harness({
      create: [{ fail: "rejected", code: "ADDRESS_NOT_SHIPPABLE", reason: "DISTRICT_NOT_FOUND" }],
    });
    const result = await h.run();
    expect(!result.ok && result.error).toMatchObject({
      code: "ADDRESS_NOT_SHIPPABLE",
      reason: "DISTRICT_NOT_FOUND",
      httpStatus: 422,
    });
    const shipment = await h.shipment();
    expect(shipment?.attempts.map((a) => [a.outcome, a.reference])).toEqual([
      ["pending", "1001-1"],
      ["failed", "1001-1"],
    ]);
    expect(shipment?.pendingLabelAttempt()).toBeUndefined();
    expect(shipment?.status.value).toBe("created");
    expect((await h.run()).ok).toBe(true);
    expect(h.fake.record.createCalls.map((c) => c.request.reference)).toEqual(["1001-1", "1001-2"]);
  });
  it("a disabled carrier is CARRIER_NOT_ENABLED and nothing is written", async () => {
    const h = await harness({}, false);
    const result = await h.run();
    expect(!result.ok && result.error).toMatchObject({
      code: "CARRIER_NOT_ENABLED",
      httpStatus: 409,
    });
    expect((await h.shipment())?.attempts).toHaveLength(0);
    expect(h.fake.record.prepareCalls).toHaveLength(0);
  });
  it("pending attempts resume with the carrier disabled", async () => {
    const h = await harness({
      create: [{ fail: "unavailable", timedOut: true }],
      find: [[{ deliveryId: "del", trackingNumber: "tn" }]],
    });
    await h.run();
    await h.settings.save((await h.settings.get("t"))!.withEnabled("bosta", false), "t");
    h.clock.advanceMs(IN_FLIGHT_GRACE_MS + 1);
    const result = await h.run();
    expect(result.ok && result.value.trackingNumber).toBe("tn");
    expect(h.fake.record.prepareCalls).toHaveLength(1);
  });
  it("pending timeout then legacy label is refused without a legacy provider call", async () => {
    const shipments = new PostgresLikeShipmentRepository();
    const uow = new TrackingUnitOfWork();
    const pkg = ShipmentPackage.create("p", ["item"], 1);
    if (!pkg.ok) throw pkg.error;
    const shipment = Shipment.create(UniqueEntityId.from("s"), "f", [pkg.value]);
    shipment.beginLabelAttempt("1001-1", new Date());
    await shipments.save(shipment, "t");
    let calls = 0;
    const useCase = new CreateLabel({
      shipments,
      unitOfWork: uow,
      idGenerator: sequentialIds(),
      clock: fixedClock(),
      carrierProvider: {
        createLabel: () => {
          calls++;
          return Promise.reject(new Error("legacy called"));
        },
        voidLabel: () => Promise.resolve(),
      },
    });
    const result = await useCase.execute({ tenantId: "t", shipmentId: "s" });
    expect(!result.ok && result.error.code).toBe("CARRIER_USE_CANCEL");
    expect(calls).toBe(0);
    expect((await shipments.findById("s", "t"))?.attempts).toHaveLength(1);
  });
  it("unmanaged legacy labels still use the legacy provider and no carrier provider", async () => {
    const h = await harness();
    let calls = 0;
    const legacy = new CreateLabel({
      shipments: h.shipments,
      unitOfWork: h.unitOfWork,
      clock: h.clock,
      idGenerator: sequentialIds(),
      carriers: h.carriers,
      carrierProvider: {
        createLabel: () => {
          calls++;
          return Promise.resolve({
            carrier: "legacy",
            carrierService: "standard",
            labelId: "legacy-id",
            trackingNumber: "legacy-tn",
          });
        },
        voidLabel: () => Promise.resolve(),
      },
    });
    const result = await legacy.execute({ tenantId: "t", shipmentId: "s" });
    expect(result.ok && result.value.status).toBe("label_created");
    expect(calls).toBe(1);
    expect(h.fake.created).toHaveLength(0);
    expect(h.fake.record.prepareCalls).toHaveLength(0);
    expect(h.fake.record.createCalls).toHaveLength(0);
    expect(h.fake.record.findCalls).toHaveLength(0);
    expect(h.fake.record.cancelCalls).toHaveLength(0);
    expect(h.fake.record.printCalls).toHaveLength(0);
  });
  it("a stale success cannot return a newer attempt's stored label", async () => {
    const h = await harness();
    const resolve = h.carriers.resolve.bind(h.carriers);
    vi.spyOn(h.carriers, "resolve").mockImplementationOnce(async (...args) => {
      const provider = await resolve(...args);
      const createDelivery = provider.createDelivery.bind(provider);
      vi.spyOn(provider, "createDelivery").mockImplementation(async (request) => {
        const result = await createDelivery(request);
        const shipment = (await h.shipment())!;
        shipment.markCarrierResultUnknown(request.reference, "event", h.clock.now());
        await h.shipments.save(shipment, "t");
        expect((await h.retry.execute({ tenantId: "t", shipmentId: "s" })).ok).toBe(true);
        expect((await h.run()).ok).toBe(true);
        return result;
      });
      return provider;
    });
    const result = await h.run();
    expect(!result.ok && result.error.code).toBe("CARRIER_RESULT_UNKNOWN");
    expect((await h.shipment())?.trackingNumber?.value).toBe("TN-1001-2");
  });
  it("a late success after review and Retry cannot attach the old delivery", async () => {
    const h = await harness();
    const resolve = h.carriers.resolve.bind(h.carriers);
    vi.spyOn(h.carriers, "resolve").mockImplementation(async (...args) => {
      const provider = await resolve(...args);
      const createDelivery = provider.createDelivery.bind(provider);
      vi.spyOn(provider, "createDelivery").mockImplementation(async (request) => {
        const result = await createDelivery(request);
        const shipment = (await h.shipment())!;
        shipment.markCarrierResultUnknown(request.reference, "event", h.clock.now());
        await h.shipments.save(shipment, "t");
        expect((await h.retry.execute({ tenantId: "t", shipmentId: "s" })).ok).toBe(true);
        return result;
      });
      return provider;
    });
    const result = await h.run();
    expect(!result.ok && result.error.code).toBe("CARRIER_RESULT_UNKNOWN");
    expect((await h.shipment())?.label).toBeUndefined();
    expect((await h.shipment())?.pendingLabelAttempt()).toBeUndefined();
  });
  it.each([
    ["credentials_rejected", "CARRIER_CREDENTIALS_REJECTED", 409, false],
    ["unavailable", "CARRIER_UNAVAILABLE", 503, true],
  ] as const)(
    "fresh %s has the correct result and attempt state",
    async (fail, code, status, pending) => {
      const h = await harness({ create: [{ fail }] });
      const result = await h.run();
      expect(!result.ok && result.error).toMatchObject({ code, httpStatus: status });
      const shipment = (await h.shipment())!;
      expect(shipment.status.value).toBe("created");
      expect(shipment.pendingLabelAttempt() !== undefined).toBe(pending);
      expect(shipment.attempts.map((a) => a.outcome)).toEqual(
        pending ? ["pending"] : ["pending", "failed"],
      );
    },
  );
  it("prepare unavailable leaves no attempt", async () => {
    const h = await harness({ prepare: [{ fail: "unavailable" }] });
    const result = await h.run();
    expect(!result.ok && result.error).toMatchObject({
      code: "CARRIER_UNAVAILABLE",
      httpStatus: 503,
    });
    expect((await h.shipment())?.attempts).toHaveLength(0);
    expect(h.fake.record.createCalls).toHaveLength(0);
    expect(h.fake.record.prepareCalls.map((c) => c.openCountAtCall)).toEqual([0]);
  });
  it("already labelled returns the stored label without resolving a disabled carrier", async () => {
    const h = await harness({ create: [{ deliveryId: "del-1", trackingNumber: "5108002" }] });
    expect((await h.run()).ok).toBe(true);
    await h.settings.save((await h.settings.get("t"))!.withEnabled("bosta", false), "t");
    const resolve = vi.spyOn(h.carriers, "resolve");
    const result = await h.run();
    expect(result.ok && result.value).toMatchObject({
      status: "label_created",
      trackingNumber: "5108002",
      carrierDeliveryId: "del-1",
      carrierKey: "bosta",
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(h.fake.record.prepareCalls).toHaveLength(1);
  });
  it("concurrent fresh clicks issue only one carrier create", async () => {
    const h = await harness();
    const [first, second] = await Promise.all([h.run(), h.run()]);
    expect([first, second].filter((r) => r.ok)).toHaveLength(1);
    expect([first, second].filter((r) => !r.ok).map((r) => !r.ok && r.error.code)).toEqual([
      "CARRIER_CREATE_IN_PROGRESS",
    ]);
    // The tracking double counts other concurrent requests' transactions too.
    // Per-request transaction boundaries are asserted by the serial call tests.
    expect(h.fake.record.createCalls.map((c) => c.request.reference)).toEqual(["1001-1"]);
  });
  it("a late carrier success while parked cannot write a label", async () => {
    const h = await harness();
    const resolve = h.carriers.resolve.bind(h.carriers);
    h.carriers.resolve = async (...args) => {
      const provider = await resolve(...args);
      const createDelivery = provider.createDelivery.bind(provider);
      provider.createDelivery = async (request) => {
        const result = await createDelivery(request);
        const shipment = (await h.shipment())!;
        shipment.markCarrierResultUnknown(request.reference, "event", h.clock.now());
        await h.shipments.save(shipment, "t");
        return result;
      };
      return provider;
    };
    const result = await h.run();
    expect(!result.ok && result.error.code).toBe("CARRIER_RESULT_UNKNOWN");
    const shipment = (await h.shipment())!;
    expect(shipment.status.value).toBe("exception");
    expect(shipment.label).toBeUndefined();
    expect(shipment.needsCarrierReview).toBe(true);
  });
  it("creates outside any transaction, sends <order>-1 and settles label_created", async () => {
    const shipments = new PostgresLikeShipmentRepository();
    const uow = new TrackingUnitOfWork();
    const fake = fakeRegistration({ openCount: () => uow.openCount });
    const vault = new InMemoryCarrierCredentialVault();
    const settings = new InMemoryMerchantCarrierSettingsRepository();
    const configured = MerchantCarrierSettings.empty()
      .withCarrier("bosta", {
        config: {},
        sealedCredentials: await vault.seal("t", "bosta", { apiKey: "test" }),
        webhook: { sealedSecret: await vault.seal("t", "bosta:webhook", { secret: "test" }) },
      })
      .withEnabled("bosta", true);
    await settings.save(configured, "t");
    const carriers = new TenantCarrierResolver({
      settings,
      registry: CarrierRegistry.from([fake.registration]),
      vault,
    });
    const pkg = ShipmentPackage.create("p", ["item"], 1);
    if (!pkg.ok) throw pkg.error;
    await shipments.save(Shipment.create(UniqueEntityId.from("s"), "f", [pkg.value]), "t");
    const useCase = new CreateLabel({
      shipments,
      unitOfWork: uow,
      idGenerator: sequentialIds(),
      clock: fixedClock(),
      carriers,
      carrierProvider: {
        createLabel: () => Promise.reject(new Error("legacy called")),
        voidLabel: () => Promise.resolve(),
      },
    });
    const result = await useCase.execute({
      tenantId: "t",
      shipmentId: "s",
      carrier: {
        carrierKey: "bosta",
        reference: "1001",
        recipient: { name: "Sasuke", phone: "01065685435" },
        address: { line1: "Helwan street", city: "Helwan", province: "EG-C", country: "EG" },
        codAmountMinor: 5000,
        currency: "EGP",
        itemsCount: 2,
        description: "Desc.",
        packageImages: [],
      },
    });
    expect(result.ok && result.value).toMatchObject({
      status: "label_created",
      trackingNumber: "TN-1001-1",
    });
    expect(fake.record.createCalls.map((c) => [c.request.reference, c.openCountAtCall])).toEqual([
      ["1001-1", 0],
    ]);
  });
});
