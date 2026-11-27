import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

// Fake local values, nothing real.
const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
} satisfies NodeJS.ProcessEnv;

describe("email config (Plan 1C)", () => {
  it("is optional with a Resend sandbox sender by default", () => {
    const c = loadRuntimeConfig({ ...base, APP_ENV: "local" });
    expect(c.RESEND_API_KEY).toBeUndefined();
    expect(c.EMAIL_FROM).toBe("Morbeh <onboarding@resend.dev>");
    expect(c.ADMIN_PUBLIC_URL).toBeUndefined();
  });

  it("accepts a key, a sender and an admin URL", () => {
    const c = loadRuntimeConfig({
      ...base,
      APP_ENV: "local",
      RESEND_API_KEY: "re_fake_key_123",
      EMAIL_FROM: "Morbeh <no-reply@example.test>",
      ADMIN_PUBLIC_URL: "https://admin.example.test",
    });
    expect(c.RESEND_API_KEY).toBe("re_fake_key_123");
    expect(c.EMAIL_FROM).toBe("Morbeh <no-reply@example.test>");
    expect(c.ADMIN_PUBLIC_URL).toBe("https://admin.example.test");
  });

  it("EMAIL_CREDENTIALS_KEK_REF (Wave 2b2) is optional and needs at least 32 characters", () => {
    expect(
      loadRuntimeConfig({ ...base, APP_ENV: "local" }).EMAIL_CREDENTIALS_KEK_REF,
    ).toBeUndefined();
    expect(
      loadRuntimeConfig({ ...base, APP_ENV: "local", EMAIL_CREDENTIALS_KEK_REF: "k".repeat(32) })
        .EMAIL_CREDENTIALS_KEK_REF,
    ).toBe("k".repeat(32));
    expect(() =>
      loadRuntimeConfig({ ...base, APP_ENV: "local", EMAIL_CREDENTIALS_KEK_REF: "short" }),
    ).toThrow(/EMAIL_CREDENTIALS_KEK_REF/);
  });

  it("EMAIL_SMTP_ENABLED (Wave 2b2 Task 3) is a boolean from a string and defaults to off", () => {
    const flag = (value?: string) =>
      loadRuntimeConfig({
        ...base,
        APP_ENV: "local",
        ...(value === undefined ? {} : { EMAIL_SMTP_ENABLED: value }),
      }).EMAIL_SMTP_ENABLED;
    expect(flag()).toBe(false);
    expect(flag("false")).toBe(false);
    expect(flag("")).toBe(false);
    expect(flag("nonsense")).toBe(false);
    expect(flag("true")).toBe(true);
    expect(flag(" TRUE ")).toBe(true);
  });

  it("the platform-domain-authentication key is gone (D50): setting it changes nothing", () => {
    const c = loadRuntimeConfig({
      ...base,
      APP_ENV: "local",
      RESEND_DOMAINS_API_KEY: "re_full_access_1",
    } as NodeJS.ProcessEnv);
    expect("RESEND_DOMAINS_API_KEY" in c).toBe(false);
  });

  it("rejects a non-URL admin address and a too-short key", () => {
    expect(() =>
      loadRuntimeConfig({ ...base, APP_ENV: "local", ADMIN_PUBLIC_URL: "admin" }),
    ).toThrow();
    expect(() =>
      loadRuntimeConfig({ ...base, APP_ENV: "local", RESEND_API_KEY: "short" }),
    ).toThrow();
  });
});
