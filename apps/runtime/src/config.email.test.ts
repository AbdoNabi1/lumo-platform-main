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

  it("rejects a non-URL admin address and a too-short key", () => {
    expect(() =>
      loadRuntimeConfig({ ...base, APP_ENV: "local", ADMIN_PUBLIC_URL: "admin" }),
    ).toThrow();
    expect(() =>
      loadRuntimeConfig({ ...base, APP_ENV: "local", RESEND_API_KEY: "short" }),
    ).toThrow();
  });
});
