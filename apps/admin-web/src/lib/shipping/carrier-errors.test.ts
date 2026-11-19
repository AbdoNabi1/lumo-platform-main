import { beforeEach, expect, it } from "vitest";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import { carrierErrorMessage, CARRIER_KEY } from "./carrier-errors";

beforeEach(() => {
  expect.hasAssertions();
});

it("maps settings failures in both locales and falls back for unknown codes", () => {
  for (const t of [en, ar]) {
    expect(carrierErrorMessage("CARRIER_CREDENTIALS_REJECTED", t, "settings")).toBe(
      t.carrierSettings.credentialsRejected,
    );
    expect(carrierErrorMessage("CARRIER_UNAVAILABLE", t, "settings")).toBe(
      t.carrierSettings.unavailable,
    );
    expect(carrierErrorMessage("CARRIER_NOT_AVAILABLE", t, "settings")).toBe(
      t.carrierSettings.notAvailable,
    );
    expect(carrierErrorMessage("CARRIER_NOT_CONFIGURED", t, "settings")).toBe(
      t.carrierSettings.notConfigured,
    );
    expect(carrierErrorMessage("NOPE", t, "settings")).toBe(t.formErrors.unexpected);
    expect(carrierErrorMessage(undefined, t)).toBe(t.formErrors.unexpected);
  }
  expect(CARRIER_KEY.test("bosta")).toBe(true);
  expect(CARRIER_KEY.test("Bad Key")).toBe(false);
});

it("maps shipping codes first, with the review and not-enabled aliases", () => {
  for (const t of [en, ar]) {
    expect(carrierErrorMessage("ORDER_NOT_PAID", t)).toBe(t.carrierShipping.errors.ORDER_NOT_PAID);
    expect(carrierErrorMessage("CARRIER_RESULT_UNKNOWN", t)).toBe(t.carrierShipping.needsReview);
    expect(carrierErrorMessage("SHIPMENT_NEEDS_REVIEW", t)).toBe(t.carrierShipping.needsReview);
    expect(carrierErrorMessage("CARRIER_NOT_CONFIGURED", t)).toBe(
      t.carrierShipping.errors.CARRIER_NOT_ENABLED,
    );
    expect(carrierErrorMessage("CARRIER_CREDENTIALS_REJECTED", t)).toBe(
      t.carrierShipping.errors.CARRIER_CREDENTIALS_REJECTED,
    );
    expect(carrierErrorMessage("constructor", t)).toBe(t.formErrors.unexpected);
  }
});
