import { describe, expect, it } from "vitest";
import { isPaymobRegion, parsePaymobConfig } from "./index";

describe("parsePaymobConfig — Paymob's own non-secret routing data, validated by this package", () => {
  it("accepts a supported region and a positive integer integration id, and returns exactly those two fields", () => {
    expect(parsePaymobConfig({ region: "egy", integrationId: 158, extra: "dropped" })).toEqual({
      ok: true,
      value: { region: "egy", integrationId: 158 },
    });
  });

  it("keeps an optional MOTO integration id (needed for merchant-initiated charges) and drops it when absent", () => {
    expect(
      parsePaymobConfig({ region: "egy", integrationId: 158, motoIntegrationId: 777 }),
    ).toEqual({ ok: true, value: { region: "egy", integrationId: 158, motoIntegrationId: 777 } });
    const without = parsePaymobConfig({ region: "egy", integrationId: 158 });
    expect(without.ok && "motoIntegrationId" in without.value).toBe(false);
    for (const bad of [0, -1, 1.5, "777", null]) {
      expect(
        parsePaymobConfig({ region: "egy", integrationId: 158, motoIntegrationId: bad }).ok,
      ).toBe(false);
    }
  });

  it("accepts EXACTLY the regions the adapter supports — one source of truth, not a mirrored list", () => {
    for (const region of [
      "egy",
      "ksa",
      "uae",
      "oman",
      "atlantis",
      "",
      "__proto__",
      "constructor",
    ]) {
      expect(parsePaymobConfig({ region, integrationId: 1 }).ok).toBe(isPaymobRegion(region));
    }
  });

  it.each([
    ["no config", undefined],
    ["null", null],
    ["a string", "egy"],
    ["a missing region", { integrationId: 1 }],
    ["a non-string region", { region: 1, integrationId: 1 }],
    ["a zero integration id", { region: "egy", integrationId: 0 }],
    ["a negative integration id", { region: "egy", integrationId: -3 }],
    ["a fractional integration id", { region: "egy", integrationId: 1.5 }],
    ["a string integration id", { region: "egy", integrationId: "158" }],
    ["an unsafe integer", { region: "egy", integrationId: Number.MAX_SAFE_INTEGER + 1 }],
  ])("refuses %s", (_name, raw) => {
    const result = parsePaymobConfig(raw);

    expect(result.ok).toBe(false);
  });
});
