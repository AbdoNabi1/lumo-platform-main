import { beforeEach, describe, expect, it } from "vitest";
import { CODE_PLACEHOLDER, readCodeInput } from "./code-input";

beforeEach(() => {
  expect.hasAssertions();
});

describe("readCodeInput", () => {
  it("keeps six digits and strips everything else as it is typed", () => {
    expect(readCodeInput("123456")).toEqual({ value: "123456", looksLikeKey: false });
    expect(readCodeInput("123 456")).toEqual({ value: "123456", looksLikeKey: false });
    expect(readCodeInput("12-34.56")).toEqual({ value: "123456", looksLikeKey: false });
    expect(readCodeInput("1234567890")).toEqual({ value: "123456", looksLikeKey: false });
    expect(readCodeInput("")).toEqual({ value: "", looksLikeKey: false });
  });

  it("flags letters as a pasted setup key and still keeps only digits", () => {
    expect(readCodeInput("JBSWY3DPEHPK3PXP")).toEqual({ value: "33", looksLikeKey: true });
    expect(readCodeInput("JBSW Y3DP EHPK 3PXP").looksLikeKey).toBe(true);
    expect(readCodeInput("12a").looksLikeKey).toBe(true);
    // The link a phone offers is the key too.
    expect(readCodeInput("otpauth://totp/Morbeh:a@b.co?secret=ABC234").looksLikeKey).toBe(true);
  });

  it("reads Arabic-Indic and Persian digits as digits", () => {
    expect(readCodeInput("١٢٣٤٥٦")).toEqual({ value: "123456", looksLikeKey: false });
    expect(readCodeInput("۱۲۳ ۴۵۶")).toEqual({ value: "123456", looksLikeKey: false });
  });

  it("uses a digits-only placeholder", () => {
    expect(CODE_PLACEHOLDER).toBe("123456");
  });
});
