import { beforeEach, describe, expect, it } from "vitest";
import { carrierFailureOf } from "../application/carrier-provider";
import { fakeRegistration, fixedClock, sequentialIds } from "./carrier-doubles";

beforeEach(() => {
  expect.hasAssertions();
});

const parcel = {
  recipient: { name: "Mona Ali", phone: "01012345678" },
  address: { line1: "12 Tahrir St", city: "Cairo", country: "EG" },
  codAmountMinor: 10_000,
  currency: "EGP",
  itemsCount: 1,
  description: "Mug ×1",
  packageImages: [],
};

const context = { config: {}, credentials: { apiKey: "k" }, webhookHeaders: {} };

describe("carrier doubles", () => {
  it("shares shifted queues and call records across providers", async () => {
    const reg = fakeRegistration({
      script: {
        create: [{ fail: "unavailable", timedOut: true }],
        find: [[{ deliveryId: "d", trackingNumber: "t" }]],
      },
      openCount: () => 3,
    });
    const first = reg.registration.create(context);
    const error = await first
      .createDelivery({ ...parcel, reference: "1001-1" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("fake carrier failure");
    expect(carrierFailureOf(error)).toEqual({ carrierFailure: "unavailable", timedOut: true });
    const second = reg.registration.create(context);
    expect(await second.findDeliveriesByReference("1001-1")).toEqual([
      { deliveryId: "d", trackingNumber: "t" },
    ]);
    expect(await second.createDelivery({ ...parcel, reference: "1001-1" })).toEqual({
      deliveryId: "dlv-1001-1",
      trackingNumber: "TN-1001-1",
    });
    expect(reg.record.createCalls).toHaveLength(2);
    expect(reg.record.createCalls[0]?.openCountAtCall).toBe(3);
    expect(reg.record.findCalls).toEqual(["1001-1"]);
    expect(reg.record.findOpenCounts).toEqual([3]);
    expect(second).not.toBe(first);
  });

  it("records repeated scripted verification failures", async () => {
    const reg = fakeRegistration({ script: { verify: "credentials_rejected" } });
    const provider = reg.registration.create(context);
    const error = await provider.verifyCredentials().catch((e: unknown) => e);
    expect(carrierFailureOf(error)).toEqual({ carrierFailure: "credentials_rejected" });
    expect(reg.record.verifyCalls).toBe(1);
  });
  it("shifts prepare, cancel, print and get queues before using defaults", async () => {
    const status = {
      trackingNumber: "TN",
      stateCode: 45,
      stateLabel: "Delivered",
      target: "delivered",
    } as const;
    const reg = fakeRegistration({
      script: {
        prepare: [
          { code: "PHONE_NOT_SHIPPABLE" },
          { fail: "rejected", code: "CARRIER_REJECTED", reason: "bad" },
        ],
        cancel: ["not_found"],
        print: [new Uint8Array([1])],
        get: [status],
      },
      openCount: () => 3,
    });
    const provider = reg.registration.create(context);
    expect(await provider.prepare(parcel)).toEqual({ code: "PHONE_NOT_SHIPPABLE" });
    const failure = await provider.prepare(parcel).catch((e: unknown) => e);
    expect(carrierFailureOf(failure)).toEqual({
      carrierFailure: "rejected",
      code: "CARRIER_REJECTED",
      reason: "bad",
    });
    expect(await provider.prepare(parcel)).toBeNull();
    expect(await provider.findDeliveriesByReference("x")).toEqual([]);
    expect(await provider.cancelDelivery("TN")).toBe("not_found");
    expect(await provider.cancelDelivery("TN2")).toBe("cancelled");
    expect(await provider.printAwbs(["TN"], { format: "A4" })).toEqual(new Uint8Array([1]));
    expect(new TextDecoder().decode(await provider.printAwbs([], {}))).toBe("%PDF-1.4 fake");
    expect(await provider.getDelivery("TN")).toEqual(status);
    expect(await provider.getDelivery("TN2")).toMatchObject({
      trackingNumber: "TN2",
      stateCode: 10,
      target: null,
    });
    expect(reg.record.prepareCalls.map((call) => call.openCountAtCall)).toEqual([3, 3, 3]);
    expect(reg.record.cancelCalls).toEqual(["TN", "TN2"]);
    expect(reg.record.printCalls).toEqual([
      [["TN"], { format: "A4" }],
      [[], {}],
    ]);
    expect(reg.record.getCalls).toEqual(["TN", "TN2"]);
  });

  it("fakeRegistration builds a fresh provider per create and parses object config only", () => {
    const fake = fakeRegistration({ key: "aramex" });
    const a = fake.registration.create({
      config: {},
      credentials: { apiKey: "k" },
      webhookHeaders: {},
    });
    const b = fake.registration.create({
      config: {},
      credentials: { apiKey: "k" },
      webhookHeaders: {},
    });
    expect(a).not.toBe(b);
    expect(a.key).toBe("aramex");
    expect(fake.created).toHaveLength(2);
    expect(fake.registration.parseConfig({ lang: "ar" })).toEqual({
      ok: true,
      value: { lang: "ar" },
    });
    expect(fake.registration.parseConfig(undefined)).toEqual({ ok: true, value: {} });
    expect(fake.registration.parseConfig("x").ok).toBe(false);
  });

  it("fixedClock moves only when told; sequentialIds are distinct UUIDs", () => {
    const clock = fixedClock("2026-11-12T00:00:00.000Z");
    clock.advanceMs(1000);
    expect(clock.now().toISOString()).toBe("2026-11-12T00:00:01.000Z");
    clock.set("2027-01-01T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2027-01-01T00:00:00.000Z");

    const ids = sequentialIds();
    const [first, second] = [ids.generate(), ids.generate()];
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
