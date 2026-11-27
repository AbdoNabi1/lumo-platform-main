import { beforeEach, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

beforeEach(() => {
  expect.hasAssertions();
});

const base = {
  DATABASE_URL: "postgresql://u:***@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_ISSUER_URL: "https://issuer.example/",
  AUTH_JWKS_URL: "https://issuer.example/.well-known/jwks.json",
} satisfies NodeJS.ProcessEnv;

describe("carrier config", () => {
  it("is optional and absent by default", () => {
    const config = loadRuntimeConfig({ ...base });
    expect(config.SHIPPING_CREDENTIALS_KEK_REF).toBeUndefined();
    expect(config.ADMIN_API_PUBLIC_URL).toBeUndefined();
  });

  it("accepts a 32+ char KEK ref and a url", () => {
    const config = loadRuntimeConfig({
      ...base,
      SHIPPING_CREDENTIALS_KEK_REF: "k".repeat(32),
      ADMIN_API_PUBLIC_URL: "https://api.example.com",
    });
    expect(config.SHIPPING_CREDENTIALS_KEK_REF).toBe("k".repeat(32));
    expect(config.ADMIN_API_PUBLIC_URL).toBe("https://api.example.com");
  });

  it("rejects a short KEK ref and a non-url origin", () => {
    expect(() => loadRuntimeConfig({ ...base, SHIPPING_CREDENTIALS_KEK_REF: "short" })).toThrow(
      /SHIPPING_CREDENTIALS_KEK_REF/,
    );
    expect(() => loadRuntimeConfig({ ...base, ADMIN_API_PUBLIC_URL: "not a url" })).toThrow(
      /ADMIN_API_PUBLIC_URL/,
    );
  });
});

describe("O15 rotation envs (…_KEK_REF_PREVIOUS)", () => {
  const A = "kek-test-aaaa".padEnd(40, "a");
  const B = "kek-test-bbbb".padEnd(40, "b");

  it.each([
    ["PAYMENT_CREDENTIALS_KEK_REF", "PAYMENT_CREDENTIALS_KEK_REF_PREVIOUS"],
    ["SHIPPING_CREDENTIALS_KEK_REF", "SHIPPING_CREDENTIALS_KEK_REF_PREVIOUS"],
  ] as const)(
    "%s: %s is optional, needs 32+ chars, and is read next to the current ref",
    (current, previous) => {
      expect(loadRuntimeConfig({ ...base, [current]: A })[previous]).toBeUndefined();
      expect(loadRuntimeConfig({ ...base, [current]: A, [previous]: B })[previous]).toBe(B);
      expect(() => loadRuntimeConfig({ ...base, [current]: A, [previous]: "short" })).toThrow(
        new RegExp(previous),
      );
    },
  );

  it.each([
    ["PAYMENT_CREDENTIALS_KEK_REF", "PAYMENT_CREDENTIALS_KEK_REF_PREVIOUS"],
    ["SHIPPING_CREDENTIALS_KEK_REF", "SHIPPING_CREDENTIALS_KEK_REF_PREVIOUS"],
  ] as const)("refuses %s_PREVIOUS without the current ref", (current, previous) => {
    expect(() => loadRuntimeConfig({ ...base, [previous]: B })).toThrow(
      new RegExp(`${previous} is set but ${current} is not`),
    );
  });

  it.each([
    ["PAYMENT_CREDENTIALS_KEK_REF", "PAYMENT_CREDENTIALS_KEK_REF_PREVIOUS"],
    ["SHIPPING_CREDENTIALS_KEK_REF", "SHIPPING_CREDENTIALS_KEK_REF_PREVIOUS"],
  ] as const)(
    "refuses %s_PREVIOUS equal to the current ref, without printing the value",
    (current, previous) => {
      let message = "";
      try {
        loadRuntimeConfig({ ...base, [current]: A, [previous]: A });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(new RegExp(`${previous} must differ from ${current}`));
      expect(message).not.toContain(A);
    },
  );

  it("the two rotations are independent: payments may rotate while shipping does not", () => {
    const config = loadRuntimeConfig({
      ...base,
      PAYMENT_CREDENTIALS_KEK_REF: A,
      PAYMENT_CREDENTIALS_KEK_REF_PREVIOUS: B,
      SHIPPING_CREDENTIALS_KEK_REF: B,
    });
    expect(config.SHIPPING_CREDENTIALS_KEK_REF_PREVIOUS).toBeUndefined();
    expect(config.PAYMENT_CREDENTIALS_KEK_REF_PREVIOUS).toBe(B);
  });
});
