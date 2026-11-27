import { describe, expect, it } from "vitest";
import {
  emailDomain,
  formatFrom,
  isFreeMailDomain,
  isValidEmail,
  normalizeEmail,
  safeDisplayName,
} from "./sender-resolution";

describe("formatFrom (D46): the store's name at the merchant's own address", () => {
  it("is a quoted store name and the lower-cased address", () => {
    expect.hasAssertions();
    expect(formatFrom("Nusuj Store", "Hello@Nusuj.com")).toBe('"Nusuj Store" <hello@nusuj.com>');
  });

  it("keeps an Arabic store name", () => {
    expect.hasAssertions();
    expect(formatFrom("متجر النيل", "hello@nile.example")).toBe(
      '"متجر النيل" <hello@nile.example>',
    );
  });

  it("never lets a store name break out of the header", () => {
    expect.hasAssertions();
    const from = formatFrom('Evil" <attacker@x.com>\r\nBcc: z@z.com', "shop@store.example");
    expect(from).not.toMatch(/[\r\n]/);
    expect(from.match(/</g)).toHaveLength(1);
    expect(from.match(/"/g)).toHaveLength(2);
    expect(from.endsWith("<shop@store.example>")).toBe(true);
  });

  it("falls back to the bare address for an empty store name", () => {
    expect.hasAssertions();
    expect(formatFrom("  ", "shop@store.example")).toBe("<shop@store.example>");
  });

  it("bounds a very long name", () => {
    expect.hasAssertions();
    expect(safeDisplayName("x".repeat(300))).toHaveLength(80);
  });
});

describe("sender helpers", () => {
  it("knows the free-mail domains and their families", () => {
    expect.hasAssertions();
    for (const domain of [
      "gmail.com",
      "googlemail.com",
      "yahoo.com",
      "yahoo.co.uk",
      "outlook.com",
      "hotmail.com",
      "hotmail.fr",
      "live.com",
      "icloud.com",
      "me.com",
      "aol.com",
      "proton.me",
      "protonmail.com",
      "yandex.ru",
      "mail.ru",
      "gmx.de",
    ]) {
      expect(isFreeMailDomain(domain)).toBe(true);
    }
    expect(isFreeMailDomain("nusuj.com")).toBe(false);
    expect(isFreeMailDomain("mygmail.com")).toBe(false);
  });

  it("validates email syntax", () => {
    expect.hasAssertions();
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a b@c.com")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail('a"@b.com')).toBe(false);
    expect(isValidEmail("a@b.com\r\nBcc: x@y.com")).toBe(false);
  });

  it("normalizes an address, reads its domain and cleans a display name", () => {
    expect.hasAssertions();
    expect(normalizeEmail("  A@B.Co ")).toBe("a@b.co");
    expect(emailDomain("A@Store.Example")).toBe("store.example");
    expect(safeDisplayName('A"B<C>')).toBe("A B C");
  });
});
