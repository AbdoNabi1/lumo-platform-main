import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

const base = {
  DATABASE_URL: "postgresql://u:***@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_ISSUER_URL: "https://issuer.example/",
  AUTH_JWKS_URL: "https://issuer.example/.well-known/jwks.json",
} satisfies NodeJS.ProcessEnv;

describe("outreach config", () => {
  it("parses with every outreach variable unset: nothing configured, documented defaults", () => {
    expect.hasAssertions();
    const config = loadRuntimeConfig({ ...base });
    expect(config.META_APP_ID).toBeUndefined();
    expect(config.META_APP_SECRET).toBeUndefined();
    expect(config.META_WHATSAPP_CONFIG_ID).toBeUndefined();
    expect(config.META_WEBHOOK_VERIFY_TOKEN).toBeUndefined();
    expect(config.OUTREACH_CREDENTIALS_KEK_REF).toBeUndefined();
    expect(config.OUTREACH_EMAIL_FROM).toBeUndefined();
    expect(config.META_GRAPH_API_VERSION).toBe("v24.0");
    expect(config.OUTREACH_EMAIL_CAP_PER_HOUR).toBe(200);
    expect(config.OUTREACH_EMAIL_CAP_PER_DAY).toBe(2000);
    expect(config.OUTREACH_UNRESOLVED_AFTER_MS).toBe(300_000);
  });

  it("accepts a complete configuration", () => {
    expect.hasAssertions();
    const config = loadRuntimeConfig({
      ...base,
      META_APP_ID: "1234567890",
      META_APP_SECRET: "s".repeat(16),
      META_WHATSAPP_CONFIG_ID: "cfg-1",
      META_WEBHOOK_VERIFY_TOKEN: "v".repeat(16),
      META_GRAPH_API_VERSION: "v25.1",
      OUTREACH_CREDENTIALS_KEK_REF: "k".repeat(32),
      OUTREACH_EMAIL_FROM: "no-reply@send.example.com",
      OUTREACH_EMAIL_CAP_PER_HOUR: "50",
      OUTREACH_EMAIL_CAP_PER_DAY: "500",
      OUTREACH_UNRESOLVED_AFTER_MS: "120000",
    });
    expect(config.META_GRAPH_API_VERSION).toBe("v25.1");
    expect(config.OUTREACH_EMAIL_CAP_PER_HOUR).toBe(50);
    expect(config.OUTREACH_EMAIL_CAP_PER_DAY).toBe(500);
    expect(config.OUTREACH_UNRESOLVED_AFTER_MS).toBe(120_000);
  });

  it.each(["v24", "24.0", "v24.0.1", "latest", "V24.0"])(
    "META_GRAPH_API_VERSION=%s is invalid",
    (version) => {
      expect.hasAssertions();
      expect(() => loadRuntimeConfig({ ...base, META_GRAPH_API_VERSION: version })).toThrow(
        /META_GRAPH_API_VERSION/,
      );
    },
  );

  it.each([
    ["META_APP_SECRET", "short"],
    ["META_WEBHOOK_VERIFY_TOKEN", "short"],
    ["OUTREACH_CREDENTIALS_KEK_REF", "k".repeat(31)],
    ["OUTREACH_EMAIL_FROM", "not-an-email"],
    ["OUTREACH_UNRESOLVED_AFTER_MS", "59999"],
    ["OUTREACH_EMAIL_CAP_PER_HOUR", "0"],
    ["OUTREACH_EMAIL_CAP_PER_DAY", "-1"],
  ])("%s=%s is rejected", (name, value) => {
    expect.hasAssertions();
    expect(() => loadRuntimeConfig({ ...base, [name]: value })).toThrow(new RegExp(name));
  });
});
