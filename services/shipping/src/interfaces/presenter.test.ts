import { err, ok } from "@platform/types";
import { BusinessRuleError, type DomainError } from "@platform/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { CarrierError } from "../domain/errors";
import { present } from "./presenter";

beforeEach(() => {
  expect.hasAssertions();
});

describe("present", () => {
  it("maps a CarrierError to its own status, code and allow-listed reason", () => {
    const response = present<never>(
      err<DomainError>(
        new CarrierError(
          "ADDRESS_NOT_SHIPPABLE",
          "the district is unknown",
          422,
          "DISTRICT_NOT_FOUND",
        ),
      ),
      200,
    );
    expect(response).toEqual({
      status: 422,
      body: {
        code: "ADDRESS_NOT_SHIPPABLE",
        message: "ADDRESS_NOT_SHIPPABLE: the district is unknown",
        retryable: false,
        fields: [],
        traceId: undefined,
        reason: "DISTRICT_NOT_FOUND",
      },
    });
  });

  it("omits `reason` when the CarrierError has none and keeps 503 retryable", () => {
    const response = present<never>(
      err<DomainError>(new CarrierError("CARRIER_UNAVAILABLE", "Bosta is down", 503)),
      200,
    );
    expect(response.status).toBe(503);
    expect(response.body).not.toHaveProperty("reason");
    expect(response.body).toMatchObject({ code: "CARRIER_UNAVAILABLE", retryable: true });
  });

  it("keeps the code table for other domain errors and passes success through", () => {
    expect(present(err<DomainError>(new BusinessRuleError("nope")), 200).status).toBe(409);
    expect(present(ok({ id: "s-1" }), 201)).toEqual({ status: 201, body: { id: "s-1" } });
  });
});
