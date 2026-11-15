import type { Database } from "@platform/db";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { wireShipping } from "./composition";
import {
  fakeRegistration,
  fixedClock,
  sequentialIds,
  testCarrierVault,
} from "./testing/carrier-doubles";

beforeEach(() => {
  expect.hasAssertions();
});

const base = () => ({
  serializer: new InMemoryEventSerializer(),
  idGenerator: sequentialIds(),
  clock: fixedClock(),
});

describe("wireShipping — carrier foundation (Project 5)", () => {
  it("composes an empty registry when nothing is registered (no stub default)", () => {
    expect(wireShipping(base()).carrierRegistry.list()).toEqual([]);
  });

  it("exposes the registered carriers in both branches", () => {
    const registration = fakeRegistration().registration;
    const inMemory = wireShipping({
      ...base(),
      carrierRegistrations: [registration],
      carrierCredentialVault: testCarrierVault(),
    });
    const prisma = wireShipping({
      ...base(),
      prisma: {} as unknown as Database,
      carrierRegistrations: [registration],
    });
    expect(inMemory.carrierRegistry.get("bosta")).toBe(registration);
    expect(prisma.carrierRegistry.list().map((r) => r.key)).toEqual(["bosta"]);
  });

  it("refuses to boot with a duplicate carrier registration", () => {
    const registration = fakeRegistration().registration;
    expect(() =>
      wireShipping({ ...base(), carrierRegistrations: [registration, registration] }),
    ).toThrow(/already registered/);
  });
});
