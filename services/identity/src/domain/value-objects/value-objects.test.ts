import { describe, expect, it } from "vitest";
import { ConsentScope } from "./consent-scope";
import { Email } from "./email";

describe("Email", () => {
  it("normalizes and validates", () => {
    const email = Email.create("  Alice@Example.COM ");
    expect(email.ok).toBe(true);
    if (email.ok) {
      expect(email.value.value).toBe("alice@example.com");
    }
    expect(Email.create("nope").ok).toBe(false);
    expect(Email.create("a@b").ok).toBe(false);
  });
});

describe("ConsentScope", () => {
  it("accepts known scopes and rejects others", () => {
    expect(ConsentScope.create("marketing").ok).toBe(true);
    expect(ConsentScope.create("analytics").ok).toBe(true);
    expect(ConsentScope.create("telepathy").ok).toBe(false);
  });
});
