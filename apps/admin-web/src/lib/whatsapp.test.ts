import { describe, expect, it } from "vitest";
import { fillTemplate, toWhatsAppDigits, whatsAppUrl } from "./whatsapp";

describe("toWhatsAppDigits (spec §3.7; Review Focus 1)", () => {
  it.each([
    ["01001234567", "EG", "201001234567"],
    ["0100 123 4567", "EG", "201001234567"],
    ["1001234567", "EG", "201001234567"],
    ["201001234567", "EG", "201001234567"],
    ["+20 100 123 4567", "EG", "201001234567"],
    ["+20 (100) 123-4567", null, "201001234567"],
    ["00971501234567", "AE", "971501234567"],
    ["0501234567", "SA", "966501234567"],
    ["٠١٠٠١٢٣٤٥٦٧", "EG", "201001234567"],
    ["۰۵۰۱۲۳۴۵۶۷", "SA", "966501234567"],
    ["0791234567", "jo", "962791234567"],
  ])("%s in %s → %s", (phone, country, expected) => {
    expect(toWhatsAppDigits(phone, country)).toBe(expected);
  });

  it.each([
    [null, "EG"],
    ["0123", "EG"],
    ["01001234567", "US"],
    ["01001234567", null],
    ["+1234567890123456", null],
  ])("%s in %s is unusable → null (WhatsApp's chat picker opens instead)", (phone, country) => {
    expect(toWhatsAppDigits(phone, country)).toBeNull();
  });
});

describe("whatsAppUrl", () => {
  it("opens the customer's chat with the encoded text", () => {
    expect(whatsAppUrl("201001234567", "Hi Mona & co: https://x.shop/c/a?b")).toBe(
      "https://wa.me/201001234567?text=Hi%20Mona%20%26%20co%3A%20https%3A%2F%2Fx.shop%2Fc%2Fa%3Fb",
    );
  });

  it("without a number, lets the merchant pick the chat", () => {
    expect(whatsAppUrl(null, "مرحبا")).toBe(`https://wa.me/?text=${encodeURIComponent("مرحبا")}`);
  });
});

describe("fillTemplate", () => {
  it("fills every placeholder, leaves unknown ones, and never expands $ patterns", () => {
    expect(
      fillTemplate("Hi {name} from {shop}: {url} {other}", {
        name: "Mona $&",
        shop: "Sara",
        url: "u",
      }),
    ).toBe("Hi Mona $& from Sara: u {other}");
  });
});
