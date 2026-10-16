import { describe, expect, it } from "vitest";
import { ContactEmail } from "./contact-email";

describe("ContactEmail", () => {
  it("trims and lower-cases", () => {
    const result = ContactEmail.create("  Guest@Example.COM ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value).toBe("guest@example.com");
  });

  it.each(["", "   ", "no-at-sign", "a@b", "a b@c.com", "@c.com"])("rejects %j", (raw) => {
    const result = ContactEmail.create(raw);
    expect(result.ok).toBe(false);
  });
});
