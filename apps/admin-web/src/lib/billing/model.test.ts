import { describe, expect, it } from "vitest";
import {
  billingBanner,
  isMerchantBillingDto,
  isMerchantPlanDto,
  trialDaysLeft,
  type MerchantBillingDto,
} from "./model";

const NOW = new Date("2026-10-17T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number): string => new Date(NOW.getTime() + days * DAY).toISOString();

const plan = {
  key: "growth",
  name: "Growth",
  planVersionRef: "pv-1",
  priceMinor: 29900,
  currency: "EGP",
  billingCycle: "monthly",
  trialDays: 14,
} as const;

function billing(overrides: Partial<MerchantBillingDto> = {}): MerchantBillingDto {
  return {
    plan,
    status: "active",
    nextChargeAt: null,
    trialEndsAt: null,
    cardOnFile: false,
    invoices: [],
    ...overrides,
  };
}

describe("trialDaysLeft", () => {
  it("is null when there is no trial", () => {
    expect(trialDaysLeft(null, NOW)).toBeNull();
  });

  it("counts whole days", () => {
    expect(trialDaysLeft(inDays(14), NOW)).toBe(14);
  });

  it("rounds a partial day up", () => {
    expect(trialDaysLeft(inDays(2.5), NOW)).toBe(3);
  });

  it("is 0 once the trial has ended, never negative", () => {
    expect(trialDaysLeft(inDays(-1), NOW)).toBe(0);
    expect(trialDaysLeft(NOW.toISOString(), NOW)).toBe(0);
  });

  it("is null for an unparseable date", () => {
    expect(trialDaysLeft("not a date", NOW)).toBeNull();
  });
});

describe("billingBanner", () => {
  it("is trial-ending when 1 to 3 days are left", () => {
    expect(billingBanner(billing({ trialEndsAt: inDays(3) }), NOW)).toBe("trial-ending");
    expect(billingBanner(billing({ trialEndsAt: inDays(0.5) }), NOW)).toBe("trial-ending");
  });

  it("is null with more than 3 days left, or when the trial is over", () => {
    expect(billingBanner(billing({ trialEndsAt: inDays(4) }), NOW)).toBeNull();
    expect(billingBanner(billing({ trialEndsAt: inDays(-2) }), NOW)).toBeNull();
    expect(billingBanner(billing(), NOW)).toBeNull();
  });

  it("is past-due for grace, suspended and expired", () => {
    for (const status of ["grace", "suspended", "expired"]) {
      expect(billingBanner(billing({ status }), NOW)).toBe("past-due");
    }
  });

  it("past-due wins over a trial that is about to end", () => {
    expect(billingBanner(billing({ status: "grace", trialEndsAt: inDays(2) }), NOW)).toBe(
      "past-due",
    );
  });

  it("is null for an active subscription and for none at all", () => {
    expect(billingBanner(billing({ status: "active" }), NOW)).toBeNull();
    expect(billingBanner(billing({ plan: null, status: null }), NOW)).toBeNull();
  });
});

describe("billing guards", () => {
  it("accepts a plan and a full billing view", () => {
    expect(isMerchantPlanDto(plan)).toBe(true);
    expect(
      isMerchantBillingDto(
        billing({
          nextChargeAt: inDays(5),
          trialEndsAt: inDays(5),
          invoices: [
            { id: "i1", status: "open", totalMinor: 29900, currency: "EGP", createdAt: inDays(-1) },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("accepts the no-subscription view", () => {
    expect(isMerchantBillingDto(billing({ plan: null, status: null }))).toBe(true);
  });

  it("rejects malformed shapes", () => {
    expect(isMerchantPlanDto({ ...plan, billingCycle: "weekly" })).toBe(false);
    expect(isMerchantPlanDto({ ...plan, priceMinor: "299" })).toBe(false);
    expect(isMerchantBillingDto({ ...billing(), cardOnFile: "yes" })).toBe(false);
    expect(isMerchantBillingDto({ ...billing(), invoices: [{ id: "i1" }] })).toBe(false);
    expect(isMerchantBillingDto({ ...billing(), plan: { key: "x" } })).toBe(false);
    expect(isMerchantBillingDto(null)).toBe(false);
  });
});
