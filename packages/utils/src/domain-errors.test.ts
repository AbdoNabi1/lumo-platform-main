import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import {
  AuthenticationError,
  AuthorizationError,
  BusinessRuleError,
  ConcurrencyError,
  DomainError,
  NotFoundError,
  ValidationError,
  isDomainError,
} from "./domain-errors";
import { toErrorEnvelope } from "./error-envelope";

describe("domain errors", () => {
  it("are AppError and DomainError instances with stable codes", () => {
    const error = new NotFoundError("missing");
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("NOT_FOUND");
    expect(isDomainError(error)).toBe(true);
    expect(isDomainError(new Error("x"))).toBe(false);
  });

  it("carry retryable semantics", () => {
    expect(new ConcurrencyError().retryable).toBe(true);
    expect(new BusinessRuleError("nope").retryable).toBe(false);
  });

  it("model authentication and authorization failures", () => {
    const authn = new AuthenticationError();
    const authz = new AuthorizationError("denied", { context: { permission: "orders:refund" } });

    expect(authn).toBeInstanceOf(DomainError);
    expect(authn.code).toBe("UNAUTHENTICATED");
    expect(authn.retryable).toBe(false);

    expect(authz).toBeInstanceOf(DomainError);
    expect(authz.code).toBe("FORBIDDEN");
    expect(authz.retryable).toBe(false);
    expect(toErrorEnvelope(authz, "trace-2").code).toBe("FORBIDDEN");
  });
});

describe("toErrorEnvelope", () => {
  it("includes field issues for validation errors", () => {
    const envelope = toErrorEnvelope(
      new ValidationError("invalid", [{ field: "email", message: "required" }]),
      "trace-1",
    );
    expect(envelope).toEqual({
      code: "VALIDATION",
      message: "invalid",
      retryable: false,
      fields: [{ field: "email", message: "required" }],
      traceId: "trace-1",
    });
  });

  it("does not leak details for unknown errors", () => {
    const envelope = toErrorEnvelope(new Error("internal stack details"));
    expect(envelope.code).toBe("UNEXPECTED");
    expect(envelope.message).toBe("An unexpected error occurred");
    expect(envelope.retryable).toBe(true);
  });
});
