import { describe, expect, it } from "vitest";
import { isWhatsAppDigits, toWhatsAppDigits, whatsAppHref } from "./phone";

describe("toWhatsAppDigits (spec 3.2, Ruling 10)", () => {
  it.each([
    ["+20 100 123 4567", "201001234567"],
    ["01001234567", "201001234567"],
    ["٠١٠٠١٢٣٤٥٦٧", "201001234567"], // Arabic-Indic
    ["۰۱۰۰۱۲۳۴۵۶۷", "201001234567"], // Persian
    ["00201001234567", "201001234567"],
    ["(010) 0123-4567", "201001234567"],
    ["966501234567", "966501234567"],
  ])("%s → %s", (raw, digits) => expect(toWhatsAppDigits(raw)).toBe(digits));

  it("never sends a number to the wrong country (bare digits)", () => {
    expect(toWhatsAppDigits("1001234567")).toBe("201001234567");
    expect(toWhatsAppDigits("100 123 4567")).toBe("201001234567");
    expect(toWhatsAppDigits("1201234567")).toBe("201201234567");
    expect(toWhatsAppDigits("201001234567")).toBe("201001234567");
    expect(toWhatsAppDigits("5551234567")).toBeNull();
    expect(toWhatsAppDigits("1301234567")).toBeNull();
    expect(toWhatsAppDigits("123456789")).toBeNull();
    expect(toWhatsAppDigits("1001234567", "966")).toBeNull();
  });

  it("drops one trunk 0 after the calling code, and refuses letters", () => {
    expect(toWhatsAppDigits("+20 0100 123 4567")).toBe("201001234567");
    expect(toWhatsAppDigits("(+20) 0100 123 4567")).toBe("201001234567");
    expect(toWhatsAppDigits("0020 0100 123 4567")).toBe("201001234567");
    expect(toWhatsAppDigits("0100 123 4567 ext 12")).toBeNull();
    expect(toWhatsAppDigits("call 01001234567")).toBeNull();
  });

  it("throws on a calling code that is not 1-3 digits without a leading 0", () => {
    for (const bad of ["", "0", "020", "1234", "+20", "ab"]) {
      expect(() => toWhatsAppDigits("0501234567", bad)).toThrow();
    }
  });

  it("completes a leading 0 from the calling code it is given", () => {
    expect(toWhatsAppDigits("0501234567", "966")).toBe("966501234567");
  });

  it.each(["", "   ", "0", "1234567", "+1234567890123456", "0000000000", "abc", "+0123456789"])(
    "refuses %j (8–15 digits, never a leading 0)",
    (raw) => expect(toWhatsAppDigits(raw)).toBeNull(),
  );

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 201001234567, {}, ["01001234567"]]) {
      expect(toWhatsAppDigits(value)).toBeNull();
    }
  });
});

describe("whatsAppHref", () => {
  it("builds wa.me with the encoded message, or without one", () => {
    expect(whatsAppHref("201001234567", "مرحبًا، سؤال")).toBe(
      `https://wa.me/201001234567?text=${encodeURIComponent("مرحبًا، سؤال")}`,
    );
    expect(whatsAppHref("201001234567", null)).toBe("https://wa.me/201001234567");
    expect(whatsAppHref("201001234567", "")).toBe("https://wa.me/201001234567");
  });
  it("is null for digits that are not a WhatsApp number", () => {
    expect(whatsAppHref("0100", "x")).toBeNull();
    expect(whatsAppHref("20100/../x", null)).toBeNull();
    expect(isWhatsAppDigits("201001234567")).toBe(true);
    expect(isWhatsAppDigits("01001234567")).toBe(false);
  });
});
