import { describe, expect, it } from "vitest";
import { toE164 } from "./phone";

describe("toE164", () => {
  it.each([
    ["01012345678", "+201012345678"],
    ["٠١٠١٢٣٤٥٦٧٨", "+201012345678"],
    ["۰۱۰۱۲۳۴۵۶۷۸", "+201012345678"],
    ["+20 101 234 5678", "+201012345678"],
    ["00201012345678", "+201012345678"],
    ["201012345678", "+201012345678"],
    ["1012345678", "+201012345678"],
    ["(010) 1234-5678", "+201012345678"],
    ["010.1234.5678", "+201012345678"],
    ["  01112345678  ", "+201112345678"],
    ["01212345678", "+201212345678"],
    ["01512345678", "+201512345678"],
    ["+447911123456", "+447911123456"],
    ["00447911123456", "+447911123456"],
    ["+14155552671", "+14155552671"],
    ["+966501234567", "+966501234567"],
    ["+971501234567", "+971501234567"],
  ])("normalizes %j -> %j", (input, expected) => {
    expect.hasAssertions();
    expect(toE164(input)).toBe(expected);
  });

  it.each([
    ["0101234567"],
    ["01312345678"],
    ["+201312345678"],
    ["+2001012345678"],
    ["abc"],
    [""],
    ["   "],
    ["+"],
    ["+123"],
    ["+1234567890123456"],
    ["+0447911123456"],
    ["01012345678x"],
    ["0101+2345678"],
    ["+96641234567"],
    ["+97141234567"],
  ])("rejects %j", (input) => {
    expect.hasAssertions();
    expect(toE164(input)).toBeNull();
  });

  it("returns null for undefined and null", () => {
    expect.hasAssertions();
    expect(toE164(undefined)).toBeNull();
    expect(toE164(null)).toBeNull();
  });

  it("applies the default country for national numbers", () => {
    expect.hasAssertions();
    expect(toE164("0501234567", "SA")).toBe("+966501234567");
    expect(toE164("501234567", "SA")).toBe("+966501234567");
    expect(toE164("966501234567", "SA")).toBe("+966501234567");
    expect(toE164("0501234567", "AE")).toBe("+971501234567");
    expect(toE164("00966501234567", "AE")).toBe("+966501234567");
  });

  it("rejects numbers that do not match the country mobile rule", () => {
    expect.hasAssertions();
    expect(toE164("0401234567", "SA")).toBeNull();
    expect(toE164("0401234567", "AE")).toBeNull();
    expect(toE164("01012345678", "SA")).toBeNull();
  });

  it("strips invisible directional marks pasted from chat apps", () => {
    expect.hasAssertions();
    expect(toE164("\u200e+20 101 234 5678\u200f")).toBe("+201012345678");
  });
});
