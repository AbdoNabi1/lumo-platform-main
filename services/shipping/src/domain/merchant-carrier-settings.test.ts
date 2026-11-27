import { BusinessRuleError } from "@platform/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MerchantCarrierSettings,
  PREVIOUS_WEBHOOK_SECRET_TTL_MS,
  type StoredCarrierSettings,
} from "./merchant-carrier-settings";

beforeEach(() => {
  expect.hasAssertions();
});

const stored = (secret = "sealed-whsec-1"): StoredCarrierSettings => ({
  config: { awbFormat: "A6" },
  sealedCredentials: "sealed-creds",
  webhook: { sealedSecret: secret },
});

describe("MerchantCarrierSettings", () => {
  it("starts empty at version 0 and keeps the loaded version through changes", () => {
    const empty = MerchantCarrierSettings.empty();
    expect(empty.version).toBe(0);
    expect(empty.enabledCarriers).toEqual([]);
    expect(empty.carriers).toEqual({});

    const loaded = MerchantCarrierSettings.reconstitute({
      enabledCarriers: [],
      carriers: {},
      version: 4,
    });
    expect(loaded.withCarrier("bosta", stored()).withEnabled("bosta", true).version).toBe(4);
  });

  it("enabling an unconfigured carrier throws CARRIER_NOT_CONFIGURED:", () => {
    const attempt = () => MerchantCarrierSettings.empty().withEnabled("bosta", true);
    expect(attempt).toThrow(BusinessRuleError);
    expect(attempt).toThrow(/^CARRIER_NOT_CONFIGURED: /);
  });

  it("is enabled only when both enabled and configured; enabling twice keeps one entry", () => {
    const configured = MerchantCarrierSettings.empty().withCarrier("bosta", stored());
    expect(configured.isEnabled("bosta")).toBe(false);

    const enabled = configured.withEnabled("bosta", true).withEnabled("bosta", true);
    expect(enabled.isEnabled("bosta")).toBe(true);
    expect(enabled.enabledCarriers).toEqual(["bosta"]);

    const disabled = enabled.withEnabled("bosta", false);
    expect(disabled.isEnabled("bosta")).toBe(false);
    expect(disabled.carrier("bosta")).toEqual(stored());

    const orphan = MerchantCarrierSettings.reconstitute({
      enabledCarriers: ["bosta"],
      carriers: {},
      version: 1,
    });
    expect(orphan.isEnabled("bosta")).toBe(false);
    // Disabling an unconfigured carrier is always allowed.
    expect(orphan.withEnabled("bosta", false).enabledCarriers).toEqual([]);
  });

  it("withRotatedWebhook(now) moves current → previous with previousValidUntil = now + 7 d", () => {
    const now = new Date("2026-11-12T10:00:00.000Z");
    const rotated = MerchantCarrierSettings.empty()
      .withCarrier("bosta", stored("sealed-old"))
      .withRotatedWebhook("bosta", "sealed-new", now);

    expect(PREVIOUS_WEBHOOK_SECRET_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(rotated.carrier("bosta")?.webhook).toEqual({
      sealedSecret: "sealed-new",
      previousSealedSecret: "sealed-old",
      previousValidUntil: new Date("2026-11-19T10:00:00.000Z"),
    });
    expect(rotated.carrier("bosta")?.sealedCredentials).toBe("sealed-creds");
  });

  it("rotating an unconfigured carrier's webhook is CARRIER_NOT_CONFIGURED:", () => {
    expect(() =>
      MerchantCarrierSettings.empty().withRotatedWebhook("bosta", "sealed-new", new Date(0)),
    ).toThrow(/^CARRIER_NOT_CONFIGURED: /);
  });

  it("withoutCarrier removes the entry and the enablement (Ruling 28)", () => {
    const settings = MerchantCarrierSettings.empty()
      .withCarrier("bosta", stored())
      .withCarrier("aramex", stored())
      .withEnabled("bosta", true)
      .withEnabled("aramex", true);

    const removed = settings.withoutCarrier("bosta");

    expect(removed.carrier("bosta")).toBeUndefined();
    expect(removed.enabledCarriers).toEqual(["aramex"]);
    expect(Object.keys(removed.carriers)).toEqual(["aramex"]);
    // The original is untouched (immutable).
    expect(settings.carrier("bosta")).toBeDefined();
  });

  it('carrier("__proto__") is undefined and inherited names never read as configured', () => {
    const settings = MerchantCarrierSettings.empty().withCarrier("bosta", stored());
    expect(settings.carrier("__proto__")).toBeUndefined();
    expect(settings.carrier("constructor")).toBeUndefined();
    expect(settings.carrier("toString")).toBeUndefined();
    expect(settings.isEnabled("__proto__")).toBe(false);
  });

  it("refuses a malformed key or an unsealed credential/secret", () => {
    const empty = MerchantCarrierSettings.empty();
    expect(() => empty.withCarrier("Bosta", stored())).toThrow(BusinessRuleError);
    expect(() => empty.withCarrier("__proto__", stored())).toThrow(BusinessRuleError);
    expect(() => empty.withCarrier("bosta", { ...stored(), sealedCredentials: "" })).toThrow(
      BusinessRuleError,
    );
    expect(() =>
      empty.withCarrier("bosta", { ...stored(), webhook: { sealedSecret: "" } }),
    ).toThrow(BusinessRuleError);
    expect(() => empty.withRotatedWebhook("bosta", "", new Date(0))).toThrow(BusinessRuleError);
  });
});
