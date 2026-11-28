import { beforeEach, describe, expect, it } from "vitest";

import {
  DENY_ALL_CONSENT,
  applyConsentPolicy,
  evaluateConsent,
  type ConsentSnapshot,
} from "./consent";

beforeEach(() => {
  expect.hasAssertions();
});

const NOW = new Date("2026-11-28T10:00:00.000Z");

const FROM_BODY: ConsentSnapshot = {
  analytics: false,
  marketing: false,
  personalization: true,
  recordRef: "rec-1",
};

describe("applyConsentPolicy", () => {
  it("notice_only stamps the exact notice-only snapshot, whatever the envelope carried", () => {
    expect(applyConsentPolicy(FROM_BODY, "notice_only", NOW)).toEqual({
      analytics: true,
      marketing: true,
      personalization: false,
      grants: {
        analytics_storage: true,
        ad_storage: true,
        ad_user_data: true,
        ad_personalization: false,
      },
      framework: "notice_only",
      capturedAt: "2026-11-28T10:00:00.000Z",
    });
  });

  it("notice_only turns an absent consent into the same snapshot", () => {
    expect(applyConsentPolicy(undefined, "notice_only", NOW).framework).toBe("notice_only");
  });

  it("a notice_only snapshot passes the marketing and analytics gates, and denies personalization", () => {
    const stamped = applyConsentPolicy(DENY_ALL_CONSENT, "notice_only", NOW);
    expect(evaluateConsent(stamped, "marketing")).toEqual({ allowed: true });
    expect(evaluateConsent(stamped, "analytics")).toEqual({ allowed: true });
    expect(evaluateConsent(stamped, "personalization").allowed).toBe(false);
  });

  it("opt_in leaves the snapshot exactly as it arrived (fail-closed stays the router's job)", () => {
    expect(applyConsentPolicy(FROM_BODY, "opt_in", NOW)).toBe(FROM_BODY);
    const denied = applyConsentPolicy(DENY_ALL_CONSENT, "opt_in", NOW);
    expect(evaluateConsent(denied, "marketing").allowed).toBe(false);
  });

  it("opt_in with no snapshot at all is the deny-all snapshot", () => {
    expect(applyConsentPolicy(undefined, "opt_in", NOW)).toEqual(DENY_ALL_CONSENT);
  });
});
