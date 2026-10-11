import { describe, expect, it } from "vitest";
import { ValidationError } from "@platform/utils";
import { StoreSettings, type StoreSettingsInput } from "./store-settings";

const valid: StoreSettingsInput = {
  storeName: "Lumo",
  contactEmail: "hello@lumo.test",
  currency: "SAR",
  timezone: "Asia/Riyadh",
  weightUnit: "g",
};

function fieldsOf(input: StoreSettingsInput): string[] {
  const result = StoreSettings.create(input);
  if (result.ok) return [];
  expect(result.error).toBeInstanceOf(ValidationError);
  return (result.error as ValidationError).fields.map((issue) => issue.field);
}

describe("StoreSettings", () => {
  it("defaults to an unnamed Egyptian store (EGP, Africa/Cairo, kg)", () => {
    const defaults = StoreSettings.defaults();
    expect(defaults.storeName).toBe("");
    expect(defaults.contactEmail).toBeNull();
    expect(defaults.currency).toBe("EGP");
    expect(defaults.timezone).toBe("Africa/Cairo");
    expect(defaults.weightUnit).toBe("kg");
  });

  it("creates from valid input", () => {
    const result = StoreSettings.create(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe("SAR");
    expect(result.value.weightUnit).toBe("g");
  });

  it("trims the name and email, and treats a blank email as none", () => {
    const result = StoreSettings.create({ ...valid, storeName: "  Lumo  ", contactEmail: "   " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storeName).toBe("Lumo");
    expect(result.value.contactEmail).toBeNull();
  });

  it("rejects a currency that is not an ISO 4217 code", () => {
    expect(fieldsOf({ ...valid, currency: "XXX" })).toEqual(["currency"]);
    expect(fieldsOf({ ...valid, currency: "egp" })).toEqual(["currency"]);
    expect(fieldsOf({ ...valid, currency: "EG" })).toEqual(["currency"]);
  });

  it("rejects an unknown time zone and accepts UTC and Area/City zones", () => {
    expect(fieldsOf({ ...valid, timezone: "Mars/Olympus" })).toEqual(["timezone"]);
    expect(fieldsOf({ ...valid, timezone: "" })).toEqual(["timezone"]);
    expect(fieldsOf({ ...valid, timezone: "UTC" })).toEqual([]);
    expect(fieldsOf({ ...valid, timezone: "Africa/Cairo" })).toEqual([]);
  });

  it("rejects a weight unit outside kg, g, lb and oz", () => {
    expect(fieldsOf({ ...valid, weightUnit: "stone" })).toEqual(["weightUnit"]);
    for (const unit of ["kg", "g", "lb", "oz"]) {
      expect(fieldsOf({ ...valid, weightUnit: unit })).toEqual([]);
    }
  });

  it("rejects a malformed contact email", () => {
    expect(fieldsOf({ ...valid, contactEmail: "not-an-email" })).toEqual(["contactEmail"]);
  });

  it("caps the store name at 120 characters", () => {
    expect(fieldsOf({ ...valid, storeName: "x".repeat(120) })).toEqual([]);
    expect(fieldsOf({ ...valid, storeName: "x".repeat(121) })).toEqual(["storeName"]);
  });

  it("reports every invalid field at once", () => {
    expect(
      fieldsOf({ ...valid, currency: "ZZZ", weightUnit: "x", contactEmail: "nope" }).sort(),
    ).toEqual(["contactEmail", "currency", "weightUnit"]);
  });
});
