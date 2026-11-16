import { beforeEach, expect, it } from "vitest";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import { carrierErrorMessage, CARRIER_KEY } from "./carrier-errors";

beforeEach(() => {
  expect.hasAssertions();
});

it("maps carrier failures in both locales and falls back for unknown codes", () => {
  for (const t of [en, ar]) {
    expect(carrierErrorMessage("CARRIER_CREDENTIALS_REJECTED", t)).toBe(
      t.carrierSettings.credentialsRejected,
    );
    expect(carrierErrorMessage("CARRIER_UNAVAILABLE", t)).toBe(t.carrierSettings.unavailable);
    expect(carrierErrorMessage("CARRIER_NOT_AVAILABLE", t)).toBe(t.carrierSettings.notAvailable);
    expect(carrierErrorMessage("CARRIER_NOT_CONFIGURED", t)).toBe(t.carrierSettings.notConfigured);
    expect(carrierErrorMessage("NOPE", t)).toBe(t.formErrors.unexpected);
    expect(carrierErrorMessage(undefined, t)).toBe(t.formErrors.unexpected);
  }
  expect(CARRIER_KEY.test("bosta")).toBe(true);
  expect(CARRIER_KEY.test("Bad Key")).toBe(false);
});
