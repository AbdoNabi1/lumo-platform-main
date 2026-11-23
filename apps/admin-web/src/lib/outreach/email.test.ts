import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import {
  emailErrorMessage,
  isKnownEmailCode,
  isPlausibleEmail,
  normalizeEmail,
  parseSender,
} from "./email";

describe("isPlausibleEmail / normalizeEmail", () => {
  it.each(["a@b.co", "first.last+tag@sub.example.com", "owner@nour.example"])(
    "accepts %s",
    (value) => {
      expect.hasAssertions();
      expect(isPlausibleEmail(value)).toBe(true);
    },
  );
  it.each(["", "a", "a@b", "a b@c.co", "a@b .co", "<a>@b.co", `${"a".repeat(250)}@b.co`])(
    "rejects %j",
    (value) => {
      expect.hasAssertions();
      expect(isPlausibleEmail(value)).toBe(false);
    },
  );
  it("normalises case and surrounding spaces", () => {
    expect.hasAssertions();
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
  });
});

describe("parseSender", () => {
  it("splits a display name and an address", () => {
    expect.hasAssertions();
    expect(parseSender("Nour Store <noreply@mail.example.com>")).toEqual({
      name: "Nour Store",
      address: "noreply@mail.example.com",
    });
    expect(parseSender("متجر نور <a@b.co>")).toEqual({ name: "متجر نور", address: "a@b.co" });
  });
  it("handles a missing name, a bare value and null", () => {
    expect.hasAssertions();
    expect(parseSender("<a@b.co>")).toEqual({ name: null, address: "a@b.co" });
    expect(parseSender("Just a name")).toEqual({ name: "Just a name", address: null });
    expect(parseSender("")).toEqual({ name: null, address: null });
    expect(parseSender(null)).toEqual({ name: null, address: null });
  });
});

describe("email error copy", () => {
  it("maps the allowlisted codes in both languages and nothing else", () => {
    expect.hasAssertions();
    for (const t of [en, ar]) {
      for (const code of [
        "EMAIL_CAP_REACHED",
        "EMAIL_NOT_CONFIGURED",
        "EMAIL_MARKETING_NOT_AVAILABLE",
      ]) {
        expect(isKnownEmailCode(code, t)).toBe(true);
        expect(emailErrorMessage(code, t)).toBe(
          (t.emailSettings.errors as Record<string, string>)[code],
        );
      }
      for (const other of [
        "generic",
        "invalid_api_key",
        "HTTP_500",
        "toString",
        3,
        null,
        undefined,
      ]) {
        expect(isKnownEmailCode(other, t)).toBe(false);
        expect(emailErrorMessage(other, t)).toBe(t.emailSettings.errors.generic);
      }
    }
  });
});
