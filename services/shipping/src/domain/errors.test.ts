import { DomainError, toErrorEnvelope } from "@platform/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { CarrierError } from "./errors";

beforeEach(() => {
  expect.hasAssertions();
});

describe("CarrierError (Ruling 19)", () => {
  it("carries the specific code as `code` and `CODE: text` as the message", () => {
    const error = new CarrierError(
      "ADDRESS_NOT_SHIPPABLE",
      "the address can't be shipped",
      422,
      "CITY_NOT_FOUND",
    );
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("ADDRESS_NOT_SHIPPABLE");
    expect(error.message).toBe("ADDRESS_NOT_SHIPPABLE: the address can't be shipped");
    expect(error.httpStatus).toBe(422);
    expect(error.reason).toBe("CITY_NOT_FOUND");
    expect(error.retryable).toBe(false);
    expect(toErrorEnvelope(error).code).toBe("ADDRESS_NOT_SHIPPABLE");
  });

  it("is retryable only for 503", () => {
    expect(new CarrierError("CARRIER_UNAVAILABLE", "try again", 503).retryable).toBe(true);
    expect(new CarrierError("CARRIER_RESULT_UNKNOWN", "check", 409).retryable).toBe(false);
    expect(new CarrierError("CARRIER_RESULT_UNKNOWN", "check", 409).reason).toBeUndefined();
  });
});
