import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import {
  isKnownWhatsAppCode,
  limitSentence,
  PHONE_PATTERN,
  qualityBadge,
  testSendOutcome,
  tierLimit,
  whatsappErrorMessage,
} from "./whatsapp";

describe("whatsappErrorMessage", () => {
  it.each([en, ar])("maps every allowlisted code to its own copy", (t) => {
    expect.hasAssertions();
    const codes = Object.keys(t.whatsappSettings.errors).filter(
      (code) => code !== "generic" && code !== "stale",
    );
    expect(codes.length).toBeGreaterThan(10);
    for (const code of codes) {
      expect(isKnownWhatsAppCode(code, t)).toBe(true);
      expect(whatsappErrorMessage(code, t)).not.toBe(t.whatsappSettings.errors.generic);
    }
  });

  it("shows generic copy for provider codes, unknown codes and non-strings, never the code", () => {
    expect.hasAssertions();
    for (const code of [
      "META_131056",
      "HTTP_500",
      "PROVIDER_ERROR",
      "weird",
      "",
      "generic",
      null,
      7,
    ]) {
      const message = whatsappErrorMessage(code, en);
      expect(message).toBe(en.whatsappSettings.errors.generic);
      expect(message).not.toContain("META_");
    }
  });

  it("does not treat Object prototype keys as codes", () => {
    expect.hasAssertions();
    expect(isKnownWhatsAppCode("toString", en)).toBe(false);
    expect(isKnownWhatsAppCode("constructor", en)).toBe(false);
  });
});

describe("messaging limit", () => {
  it.each([
    ["TIER_50", 50],
    ["TIER_250", 250],
    ["TIER_1K", 1000],
    ["TIER_10K", 10000],
    ["TIER_100K", 100000],
    ["TIER_UNLIMITED", "unlimited"],
    ["TIER_X", null],
    ["tier_250", null],
    ["TIER_0", null],
    [null, null],
  ] as const)("reads %s", (tier, expected) => {
    expect.hasAssertions();
    expect(tierLimit(tier)).toBe(expected);
  });

  it("writes the plan's sentence for a known tier and a dash for an unknown one", () => {
    expect.hasAssertions();
    expect(limitSentence("TIER_250", en, "en")).toBe(
      "Business messaging limit: up to 250 customers you start conversations with in 24 hours (shared across your business)",
    );
    expect(limitSentence("TIER_1K", en, "en")).toContain("up to 1,000 customers");
    expect(limitSentence("TIER_SOMETHING", en, "en")).toBe("Business messaging limit: —");
    expect(limitSentence(null, ar, "ar")).toBe(ar.whatsappSettings.limitUnknown);
  });
});

describe("quality badge", () => {
  it("maps GREEN/YELLOW/RED and falls back to not rated yet", () => {
    expect.hasAssertions();
    expect(qualityBadge("GREEN", en)).toEqual({ label: "High", variant: "success" });
    expect(qualityBadge("YELLOW", en)).toEqual({ label: "Medium", variant: "warning" });
    expect(qualityBadge("RED", en)).toEqual({ label: "Low", variant: "destructive" });
    expect(qualityBadge(null, en)).toEqual({ label: "Not rated yet", variant: "neutral" });
    expect(qualityBadge("UNKNOWN", en).label).toBe("Not rated yet");
  });
});

describe("test send outcome", () => {
  it("only a provider-acknowledged status is accepted; pending is not", () => {
    expect.hasAssertions();
    expect(testSendOutcome("accepted")).toBe("accepted");
    expect(testSendOutcome("delivered")).toBe("accepted");
    expect(testSendOutcome("suppressed")).toBe("suppressed");
    expect(testSendOutcome("failed")).toBe("failed");
    expect(testSendOutcome("unknown")).toBe("unknown");
    expect(testSendOutcome("pending")).toBe("unknown");
  });
});

describe("phone pattern", () => {
  it("accepts an E.164 number and common separators, rejects text and short input", () => {
    expect.hasAssertions();
    expect(PHONE_PATTERN.test("+201001234567")).toBe(true);
    expect(PHONE_PATTERN.test("010 0123 4567")).toBe(true);
    expect(PHONE_PATTERN.test("abc")).toBe(false);
    expect(PHONE_PATTERN.test("123")).toBe(false);
  });
});
