import { describe, expect, it } from "vitest";
import {
  isFreeMailDomain,
  isValidEmail,
  mailboxAddress,
  resolveSender,
  safeDisplayName,
} from "./sender-resolution";

const platformFrom = "Morbeh <onboarding@resend.dev>";
const base = { storeName: "Nusuj Store", platformFrom, verifiedDomains: ["nusuj.com"] };

describe("resolveSender (D38 matrix)", () => {
  it("verified custom domain: the merchant address is From, no Reply-To", () => {
    expect.hasAssertions();
    const sender = resolveSender({ ...base, senderEmail: "Hello@Nusuj.com" });
    expect(sender).toEqual({
      from: '"Nusuj Store" <hello@nusuj.com>',
      mode: "own_domain",
      effectiveEmail: "hello@nusuj.com",
    });
  });

  it("unverified custom domain: platform From with the store name, merchant address as Reply-To", () => {
    expect.hasAssertions();
    const sender = resolveSender({ ...base, senderEmail: "hello@other.com" });
    expect(sender.from).toBe('"Nusuj Store" <onboarding@resend.dev>');
    expect(sender.replyTo).toBe("hello@other.com");
    expect(sender.mode).toBe("reply_to");
    expect(sender.from).not.toContain("other.com");
  });

  it("gmail: always Reply-To, even if someone 'verified' gmail.com", () => {
    expect.hasAssertions();
    const sender = resolveSender({
      ...base,
      verifiedDomains: ["gmail.com", "nusuj.com"],
      senderEmail: "shop@gmail.com",
    });
    expect(sender.from).toBe('"Nusuj Store" <onboarding@resend.dev>');
    expect(sender.replyTo).toBe("shop@gmail.com");
  });

  it("no sender email: the store contact email takes its place", () => {
    expect.hasAssertions();
    const sender = resolveSender({ ...base, senderEmail: null, contactEmail: "contact@other.com" });
    expect(sender.replyTo).toBe("contact@other.com");
    expect(sender.from).toContain("onboarding@resend.dev");
    const verified = resolveSender({
      ...base,
      senderEmail: null,
      contactEmail: "contact@nusuj.com",
    });
    expect(verified.from).toBe('"Nusuj Store" <contact@nusuj.com>');
  });

  it("no sender and no contact email: platform From, no Reply-To", () => {
    expect.hasAssertions();
    const sender = resolveSender({ ...base, senderEmail: null, contactEmail: null });
    expect(sender).toEqual({
      from: '"Nusuj Store" <onboarding@resend.dev>',
      mode: "platform_only",
      effectiveEmail: null,
    });
    expect("replyTo" in sender).toBe(false);
  });

  it("never lets a store name break out of the header", () => {
    expect.hasAssertions();
    const sender = resolveSender({
      ...base,
      storeName: 'Evil" <attacker@x.com>\r\nBcc: z@z.com',
      senderEmail: null,
    });
    expect(sender.from).not.toMatch(/[\r\n]/);
    expect(sender.from.match(/</g)).toHaveLength(1);
    expect(sender.from).toMatch(/<onboarding@resend\.dev>$/);
  });

  it("falls back to the bare platform address for an empty store name", () => {
    expect.hasAssertions();
    expect(resolveSender({ ...base, storeName: "  ", senderEmail: null }).from).toBe(
      "<onboarding@resend.dev>",
    );
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

  it("extracts the address from a mailbox and cleans a display name", () => {
    expect.hasAssertions();
    expect(mailboxAddress("Morbeh <onboarding@resend.dev>")).toBe("onboarding@resend.dev");
    expect(mailboxAddress("plain@x.com")).toBe("plain@x.com");
    expect(safeDisplayName('A"B<C>')).toBe("A B C");
  });
});
