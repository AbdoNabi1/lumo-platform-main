import { beforeEach, expect, it } from "vitest";
import { Connection, SECRET_RULE, validatePublicConfig } from "./connection";

beforeEach(() => {
  expect.hasAssertions();
});

it("validates every platform's public id without exposing input", () => {
  for (const [platform, config] of [
    ["meta", { pixelId: "bad" }],
    ["tiktok", { pixelCode: "lowercase" }],
    ["snap", { pixelId: "not-uuid" }],
    ["ga4", { measurementId: "UA-1" }],
    ["google_ads", { conversionId: "AW-12", labels: {} }],
  ] as const) {
    const result = validatePublicConfig(platform, config);
    expect(result.ok).toBe(false);
  }
  expect(validatePublicConfig("meta", { pixelId: "123456789012345" }).ok).toBe(true);
});

it("restricts token characters to the amended safe alphabet", () => {
  expect(SECRET_RULE.pattern.test("abcDE123+/:|=-._~")).toBe(true);
  for (const value of ['abcdefghij"', "abcdefghij\\", "abcdefghij "]) {
    expect(SECRET_RULE.pattern.test(value)).toBe(false);
  }
});

it("distinguishes completeness and live state", () => {
  const props = {
    id: "x",
    platform: "meta" as const,
    enabled: true,
    publicConfig: { platform: "meta" as const, pixelId: "12345678" },
    sealedSecret: null,
    secretLast4: null,
    testEventCode: null,
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  expect(Connection.restore(props).isComplete()).toBe(false);
  expect(Connection.restore({ ...props, sealedSecret: "sealed" }).isLive()).toBe(true);
  expect(Connection.restore({ ...props, enabled: false, sealedSecret: "sealed" }).isLive()).toBe(
    false,
  );
});
