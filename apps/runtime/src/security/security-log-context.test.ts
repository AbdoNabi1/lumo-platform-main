import { describe, expect, it } from "vitest";
import { redact, securityLogFields } from "./security-log-context";

describe("redact", () => {
  it("redacts sensitive-looking fields and preserves the rest", () => {
    const out = redact({
      principalId: "p-1",
      password: "hunter2",
      apiKey: "sk-123",
      accessToken: "tok",
      privateKey: "-----BEGIN",
      authorization: "Bearer x",
      durationMs: 5,
    });
    expect(out["principalId"]).toBe("p-1");
    expect(out["durationMs"]).toBe(5);
    expect(out["password"]).toBe("[redacted]");
    expect(out["apiKey"]).toBe("[redacted]");
    expect(out["accessToken"]).toBe("[redacted]");
    expect(out["privateKey"]).toBe("[redacted]");
    expect(out["authorization"]).toBe("[redacted]");
  });
});

describe("securityLogFields", () => {
  it("includes only the provided ids and never leaks secrets", () => {
    const fields = securityLogFields(
      { correlationId: "c-1", requestId: "r-1", principalId: "p-1", tenantId: "t-1" },
      { operation: "authorization", token: "should-be-redacted" },
    );
    expect(fields).toMatchObject({
      correlationId: "c-1",
      requestId: "r-1",
      principalId: "p-1",
      tenantId: "t-1",
      operation: "authorization",
    });
    expect(fields["token"]).toBe("[redacted]");
  });

  it("omits absent context ids", () => {
    const fields = securityLogFields({ correlationId: "c-1" });
    expect(fields).toHaveProperty("correlationId", "c-1");
    expect(fields).not.toHaveProperty("principalId");
    expect(fields).not.toHaveProperty("tenantId");
  });
});
