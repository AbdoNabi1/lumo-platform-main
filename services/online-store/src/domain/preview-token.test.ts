import { describe, expect, it } from "vitest";
import { hashPreviewToken, isWellFormedPreviewToken, mintPreviewToken } from "./preview-token";

describe("preview tokens", () => {
  it("mints 32 random bytes as base64url (43 characters), different every time", () => {
    const a = mintPreviewToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mintPreviewToken()).not.toBe(a);
  });

  it("hashes to lower-case hex SHA-256, never the token itself", () => {
    const token = mintPreviewToken();
    expect(hashPreviewToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPreviewToken(token)).not.toContain(token);
  });

  it.each([
    ["", false],
    ["short", false],
    ["a".repeat(101), false],
    ["has space and !".padEnd(43, "x"), false],
    ["A".repeat(43), true],
  ])("isWellFormedPreviewToken(%j) = %s", (value, expected) => {
    expect(isWellFormedPreviewToken(value)).toBe(expected);
  });
});
