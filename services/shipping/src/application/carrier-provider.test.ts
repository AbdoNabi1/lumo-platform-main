import { beforeEach, describe, expect, it } from "vitest";
import { carrierFailureOf } from "./carrier-provider";

beforeEach(() => {
  expect.hasAssertions();
});

describe("carrierFailureOf (Ruling 20: a discriminant, never instanceof)", () => {
  it("reads a rejection with its code and reason", () => {
    const error = Object.assign(new Error("boom"), {
      carrierFailure: "rejected",
      code: "ADDRESS_NOT_SHIPPABLE",
      reason: "DISTRICT_NOT_FOUND",
    });
    expect(carrierFailureOf(error)).toEqual({
      carrierFailure: "rejected",
      code: "ADDRESS_NOT_SHIPPABLE",
      reason: "DISTRICT_NOT_FOUND",
    });
  });

  it("reads an unavailable failure with timedOut, from a plain object too", () => {
    expect(carrierFailureOf({ carrierFailure: "unavailable", timedOut: true })).toEqual({
      carrierFailure: "unavailable",
      timedOut: true,
    });
    expect(carrierFailureOf({ carrierFailure: "credentials_rejected" })).toEqual({
      carrierFailure: "credentials_rejected",
    });
  });

  it("drops a code outside the rejection union and fields of the wrong type", () => {
    expect(
      carrierFailureOf({
        carrierFailure: "rejected",
        code: "NOT_A_CODE",
        reason: 7,
        timedOut: "y",
      }),
    ).toEqual({ carrierFailure: "rejected" });
  });

  it.each([
    [null],
    [undefined],
    ["rejected"],
    [new Error("plain")],
    [{ carrierFailure: "exploded" }],
    [{ code: "CARRIER_REJECTED" }],
  ])("is null for anything else (%j)", (value) => {
    expect(carrierFailureOf(value)).toBeNull();
  });
});
