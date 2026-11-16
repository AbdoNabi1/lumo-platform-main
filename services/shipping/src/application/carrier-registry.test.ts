import { beforeEach, describe, expect, it } from "vitest";
import { fakeRegistration } from "../testing/carrier-doubles";
import { CarrierRegistry } from "./carrier-registry";

beforeEach(() => {
  expect.hasAssertions();
});

describe("CarrierRegistry", () => {
  it("refuses a duplicate key: a later registration never replaces an earlier one", () => {
    expect(() =>
      CarrierRegistry.from([fakeRegistration().registration, fakeRegistration().registration]),
    ).toThrow(/duplicate/i);
  });

  it.each([["Bosta"], ["b"], ["1bosta"], ["bosta!"], ["a".repeat(33)]])(
    "refuses the malformed key %j",
    (key) => {
      expect(() => CarrierRegistry.from([fakeRegistration({ key }).registration])).toThrow(
        /malformed/,
      );
    },
  );

  it("refuses a registration with no credential fields", () => {
    expect(() =>
      CarrierRegistry.from([fakeRegistration({ credentialFields: [] }).registration]),
    ).toThrow(/credentialFields/);
  });

  it("answers by key and lists in registration order", () => {
    const registry = CarrierRegistry.from([
      fakeRegistration({ key: "zeta" }).registration,
      fakeRegistration({ key: "bosta" }).registration,
      fakeRegistration({ key: "aramex" }).registration,
    ]);
    expect(registry.list().map((r) => r.key)).toEqual(["zeta", "bosta", "aramex"]);
    expect(registry.has("bosta")).toBe(true);
    expect(registry.get("bosta")?.key).toBe("bosta");
    expect(registry.has("dhl")).toBe(false);
    expect(registry.get("dhl")).toBeUndefined();
  });

  it("an empty registry is valid: every carrier is simply unknown", () => {
    const registry = CarrierRegistry.from([]);
    expect(registry.list()).toEqual([]);
    expect(registry.has("bosta")).toBe(false);
  });
});
