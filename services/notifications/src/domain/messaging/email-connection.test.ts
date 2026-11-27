import { describe, expect, it } from "vitest";
import {
  connectionState,
  isUsableConnection,
  sanitizeProviderMessage,
  validateEmailConnectionDraft,
  type StoredEmailConnection,
} from "./email-connection";

const KEY = "re_xxxxxxxxxxxxxxxxxxxxxx123456";

function connection(overrides: Partial<StoredEmailConnection> = {}): StoredEmailConnection {
  return {
    kind: "resend",
    fromEmail: "shop@nusuj.com",
    sealedCredentials: "sealed",
    secretLast4: "3456",
    enabled: true,
    status: "connected",
    lastError: null,
    lastErrorAt: null,
    verifiedAt: null,
    version: 1,
    ...overrides,
  };
}

describe("validateEmailConnectionDraft", () => {
  it("accepts a Resend key and normalizes the From address", () => {
    expect.hasAssertions();
    expect(
      validateEmailConnectionDraft({
        kind: "resend",
        fromEmail: " Shop@Nusuj.COM ",
        apiKey: ` ${KEY} `,
      }),
    ).toEqual({
      ok: true,
      value: { kind: "resend", fromEmail: "shop@nusuj.com", apiKey: KEY, smtp: null },
    });
  });

  it("an empty or missing key means 'keep the stored one'", () => {
    expect.hasAssertions();
    for (const apiKey of [null, undefined, ""]) {
      expect(
        validateEmailConnectionDraft({ kind: "resend", fromEmail: "a@b.co", apiKey }),
      ).toMatchObject({ ok: true, value: { apiKey: null } });
    }
  });

  it("refuses a malformed key, listing the field but never the value", () => {
    expect.hasAssertions();
    for (const apiKey of ["pk_xxxxxxxxxxxxxxxx5678", "re_tiny", `re_${"x".repeat(200)}`, 42]) {
      const result = validateEmailConnectionDraft({ kind: "resend", fromEmail: "a@b.co", apiKey });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("sk_live");
      expect(JSON.stringify(result)).toContain("apiKey");
    }
  });

  it("refuses an unknown kind and a bad or header-injecting From address", () => {
    expect.hasAssertions();
    expect(
      validateEmailConnectionDraft({ kind: "smtp", fromEmail: "a@b.co", apiKey: KEY }).ok,
    ).toBe(false);
    for (const fromEmail of ["", "  ", "a", "a@b", "Name <a@b.co>", "a@b.co\r\nBcc: x@y.co", 7]) {
      expect(validateEmailConnectionDraft({ kind: "resend", fromEmail, apiKey: KEY }).ok).toBe(
        false,
      );
    }
  });
});

describe("usable connection", () => {
  it("is a switched-on connection that passed its last test", () => {
    expect.hasAssertions();
    expect(isUsableConnection(connection())).toBe(true);
    expect(isUsableConnection(connection({ enabled: false }))).toBe(false);
    expect(isUsableConnection(connection({ status: "failed" }))).toBe(false);
    expect(isUsableConnection(null)).toBe(false);
    expect(connectionState(null)).toBe("none");
    expect(connectionState(connection({ enabled: false, status: "failed" }))).toBe("disabled");
    expect(connectionState(connection({ status: "failed" }))).toBe("failed");
    expect(connectionState(connection())).toBe("connected");
  });
});

describe("sanitizeProviderMessage", () => {
  it("removes a key, a bearer token, addresses and control characters; bounds the length", () => {
    expect.hasAssertions();
    const text = sanitizeProviderMessage(
      `Bad key ${KEY}\r\nAuthorization: Bearer abcdefgh12345678 to sara@customer.test <ops@x.co>`,
      "fallback",
    );
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("abcdefgh12345678");
    expect(text).not.toContain("sara@customer.test");
    expect(text).not.toContain("ops@x.co");
    expect(text).not.toMatch(/[\r\n]/);
    expect(sanitizeProviderMessage("x ".repeat(500), "fallback").length).toBeLessThanOrEqual(200);
  });

  it("removes a secret it was told about even when it does not look like a key", () => {
    expect.hasAssertions();
    expect(sanitizeProviderMessage("token hunter2-secret rejected", "f", ["hunter2-secret"])).toBe(
      "token [hidden] rejected",
    );
  });

  it("keeps a useful domain message and falls back on nothing usable", () => {
    expect.hasAssertions();
    expect(
      sanitizeProviderMessage(
        "The nusuj.com domain is not verified. Please add and verify it.",
        "f",
      ),
    ).toBe("The nusuj.com domain is not verified. Please add and verify it.");
    expect(sanitizeProviderMessage("", "fallback")).toBe("fallback");
    expect(sanitizeProviderMessage({ message: "x" }, "fallback")).toBe("fallback");
  });
});
