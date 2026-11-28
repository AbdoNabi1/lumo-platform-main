import { describe, expect, it } from "vitest";
import {
  AD_PLATFORM_ORDER,
  AD_PLATFORM_SPECS,
  idValuesOf,
  inputNameForIssue,
  isAdPlatformKey,
  isValidTestEventCode,
  maskedToken,
  publicConfigFrom,
  samePublicConfig,
  statusOf,
  type ConnectionViewDto,
} from "./ad-platforms-model";

function view(overrides: Partial<ConnectionViewDto>): ConnectionViewDto {
  return {
    platform: "meta",
    enabled: false,
    publicConfig: null,
    secret: { configured: false, last4: null },
    testEventCode: null,
    complete: false,
    live: false,
    version: 0,
    ...overrides,
  };
}

describe("ad platforms model", () => {
  it("knows the five platforms in the API's order, each with a spec", () => {
    expect.hasAssertions();
    expect([...AD_PLATFORM_ORDER]).toEqual(["meta", "tiktok", "snap", "ga4", "google_ads"]);
    expect(AD_PLATFORM_ORDER.map((key) => AD_PLATFORM_SPECS[key].key)).toEqual([
      ...AD_PLATFORM_ORDER,
    ]);
    expect(isAdPlatformKey("meta")).toBe(true);
    expect(isAdPlatformKey("x")).toBe(false);
    expect(isAdPlatformKey(undefined)).toBe(false);
  });

  it("gives a token to the four server platforms and a test code to Meta and TikTok only", () => {
    expect.hasAssertions();
    expect(AD_PLATFORM_ORDER.filter((key) => AD_PLATFORM_SPECS[key].serverToken)).toEqual([
      "meta",
      "tiktok",
      "snap",
      "ga4",
    ]);
    expect(AD_PLATFORM_ORDER.filter((key) => AD_PLATFORM_SPECS[key].testEventCode)).toEqual([
      "meta",
      "tiktok",
    ]);
  });

  it("builds each platform's public config from what was typed, null when nothing was", () => {
    expect.hasAssertions();
    expect(publicConfigFrom("meta", { pixelId: " 123 " })).toEqual({ pixelId: "123" });
    expect(publicConfigFrom("snap", { pixelId: "abc" })).toEqual({ pixelId: "abc" });
    expect(publicConfigFrom("tiktok", { pixelCode: "ABC" })).toEqual({ pixelCode: "ABC" });
    expect(publicConfigFrom("ga4", { measurementId: "G-X" })).toEqual({ measurementId: "G-X" });
    expect(publicConfigFrom("meta", { pixelId: "  " })).toBeNull();
    expect(publicConfigFrom("meta", {})).toBeNull();
    expect(
      publicConfigFrom("google_ads", { conversionId: "AW-1", labelLead: "a", labelPurchase: "c" }),
    ).toEqual({ conversionId: "AW-1", labels: { lead: "a", purchase: "c" } });
    expect(publicConfigFrom("google_ads", { conversionId: "AW-1" })).toEqual({
      conversionId: "AW-1",
      labels: {},
    });
    expect(publicConfigFrom("google_ads", {})).toBeNull();
    // Labels without a conversion id are still sent: the API says which box is wrong.
    expect(publicConfigFrom("google_ads", { labelLead: "a" })).toEqual({
      conversionId: "",
      labels: { lead: "a" },
    });
  });

  it("reads the typed ids back out of a saved view", () => {
    expect.hasAssertions();
    expect(idValuesOf(view({}))).toEqual({});
    expect(idValuesOf(view({ publicConfig: { platform: "meta", pixelId: "12345678" } }))).toEqual({
      pixelId: "12345678",
    });
    expect(
      idValuesOf(
        view({
          platform: "google_ads",
          publicConfig: { platform: "google_ads", conversionId: "AW-1", labels: { lead: "a" } },
        }),
      ),
    ).toEqual({ conversionId: "AW-1", labelLead: "a", labelContact: "", labelPurchase: "" });
  });

  it("maps a 422 issue to the input it belongs to", () => {
    expect.hasAssertions();
    expect(inputNameForIssue("meta", "publicConfig.pixelId")).toBe("pixelId");
    expect(inputNameForIssue("tiktok", "publicConfig.pixelCode")).toBe("pixelCode");
    expect(inputNameForIssue("google_ads", "publicConfig.labels.purchase")).toBe("labelPurchase");
    expect(inputNameForIssue("google_ads", "publicConfig.conversionId")).toBe("conversionId");
    expect(inputNameForIssue("ga4", "publicConfig")).toBe("measurementId");
    expect(inputNameForIssue("meta", "publicConfig.platform")).toBe("pixelId");
    expect(inputNameForIssue("meta", "secret")).toBe("secret");
    expect(inputNameForIssue("meta", "testEventCode")).toBe("testEventCode");
    expect(inputNameForIssue("meta", "expectedVersion")).toBeNull();
    expect(inputNameForIssue("meta", "publicConfig.constructor")).toBeNull();
  });

  it("is Live when delivering, Incomplete when on but missing something, Off otherwise", () => {
    expect.hasAssertions();
    expect(statusOf(view({ enabled: true, complete: true, live: true }))).toBe("live");
    expect(statusOf(view({ enabled: true }))).toBe("incomplete");
    expect(statusOf(view({}))).toBe("off");
    expect(statusOf(view({ complete: true }))).toBe("off");
  });

  it("compares saved configs by value, whatever the key order", () => {
    expect.hasAssertions();
    expect(samePublicConfig(null, null)).toBe(true);
    expect(samePublicConfig(null, { platform: "meta", pixelId: "1" })).toBe(false);
    expect(
      samePublicConfig({ platform: "meta", pixelId: "1" }, { pixelId: "1", platform: "meta" }),
    ).toBe(true);
    expect(
      samePublicConfig({ platform: "meta", pixelId: "1" }, { platform: "meta", pixelId: "2" }),
    ).toBe(false);
  });

  it("masks a token down to its last four", () => {
    expect.hasAssertions();
    expect(maskedToken("1234")).toBe("\u2022\u2022\u2022\u20221234");
  });
});

describe("send test event (P2-D11)", () => {
  it("offers the test on the four server platforms and not on Google Ads", () => {
    expect.hasAssertions();
    expect(AD_PLATFORM_ORDER.filter((key) => AD_PLATFORM_SPECS[key].testEvent)).toEqual([
      "meta",
      "tiktok",
      "snap",
      "ga4",
    ]);
    // Only Meta and TikTok have a code to type.
    expect(AD_PLATFORM_ORDER.filter((key) => AD_PLATFORM_SPECS[key].testEventCode)).toEqual([
      "meta",
      "tiktok",
    ]);
  });

  it("validates a test code like the API: letters, digits, _ and -, 1 to 64", () => {
    expect.hasAssertions();
    for (const good of ["T", "TEST_ab-9", "A".repeat(64)]) {
      expect(isValidTestEventCode(good)).toBe(true);
    }
    for (const bad of ["", " ", "has space", "a.b", "é", "A".repeat(65), "x\n"]) {
      expect(isValidTestEventCode(bad)).toBe(false);
    }
  });
});
