import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { SignupToken } from "./signup-token";

const NOW = new Date("2026-09-22T00:00:00.000Z");
const LATER = new Date("2026-09-23T00:00:00.000Z");
const EARLIER = new Date("2026-09-21T00:00:00.000Z");

function issued(): SignupToken {
  return SignupToken.issue(
    UniqueEntityId.from("token-1"),
    "tenant-1",
    "customer-1",
    "hash-1",
    LATER,
  );
}

describe("SignupToken (G-72)", () => {
  it("a freshly issued token is unconsumed", () => {
    const token = issued();
    expect(token.consumedAt).toBeNull();
    expect(token.expiresAt).toEqual(LATER);
  });

  it("is valid before expiry and unconsumed", () => {
    expect(issued().isValid(NOW)).toBe(true);
  });

  it("is invalid once expired", () => {
    const token = SignupToken.issue(
      UniqueEntityId.from("t"),
      "tenant-1",
      "customer-1",
      "hash",
      EARLIER,
    );
    expect(token.isValid(NOW)).toBe(false);
  });

  it("is invalid once consumed", () => {
    const token = issued();
    token.consume(NOW);
    expect(token.isValid(NOW)).toBe(false);
    expect(token.consumedAt).toEqual(NOW);
  });

  it("consume throws on an already-consumed token", () => {
    const token = issued();
    token.consume(NOW);
    expect(() => token.consume(NOW)).toThrow(
      "Signup token is not valid (expired, already used, or unknown)",
    );
  });

  it("consume throws on an expired token", () => {
    const token = SignupToken.issue(
      UniqueEntityId.from("t"),
      "tenant-1",
      "customer-1",
      "hash",
      EARLIER,
    );
    expect(() => token.consume(NOW)).toThrow(
      "Signup token is not valid (expired, already used, or unknown)",
    );
  });

  it("reconstitute rebuilds a persisted token exactly", () => {
    const token = SignupToken.reconstitute(
      UniqueEntityId.from("t"),
      "tenant-1",
      "customer-1",
      "hash-x",
      LATER,
      NOW,
    );
    expect(token.tenantId).toBe("tenant-1");
    expect(token.customerId).toBe("customer-1");
    expect(token.tokenHash).toBe("hash-x");
    expect(token.consumedAt).toEqual(NOW);
  });
});
