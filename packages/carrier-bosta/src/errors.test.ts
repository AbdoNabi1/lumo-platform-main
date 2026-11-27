import { beforeEach, describe, expect, it } from "vitest";
import { BostaApiError } from "./errors";

beforeEach(() => {
  expect.hasAssertions();
});

describe("Bosta errors", () => {
  it("exposes a structural failure discriminant and details", () => {
    const error = new BostaApiError({
      carrierFailure: "rejected",
      status: 400,
      message: "Rejected",
      code: "ADDRESS_NOT_SHIPPABLE",
      reason: "DISTRICT_NOT_FOUND",
      timedOut: true,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      carrierFailure: "rejected",
      status: 400,
      message: "Rejected",
      code: "ADDRESS_NOT_SHIPPABLE",
      reason: "DISTRICT_NOT_FOUND",
      timedOut: true,
    });
  });
  it("defaults timeout to false", () => {
    expect(
      new BostaApiError({ carrierFailure: "unavailable", status: 0, message: "Unavailable" })
        .timedOut,
    ).toBe(false);
  });
});
