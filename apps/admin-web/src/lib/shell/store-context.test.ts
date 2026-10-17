import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantBillingDto } from "@/lib/billing/model";
import type { ShopDomainDto } from "@/lib/domains/model";

const readSession = vi.fn();
const fetchStoreSettings = vi.fn();
const fetchMyDomains = vi.fn();
const fetchMyBilling = vi.fn();

vi.mock("@/lib/auth/session", () => ({ readSession: () => readSession() }));
vi.mock("@/lib/api/store-settings", () => ({ fetchStoreSettings: () => fetchStoreSettings() }));
vi.mock("@/lib/api/store-domains", () => ({ fetchMyDomains: () => fetchMyDomains() }));
vi.mock("@/lib/api/store-billing", () => ({ fetchMyBilling: () => fetchMyBilling() }));

import { loadStoreContext } from "./store-context";

const NOW = new Date("2026-10-17T10:00:00.000Z");

function domain(overrides: Partial<ShopDomainDto>): ShopDomainDto {
  return {
    id: "d1",
    shopId: "s1",
    hostname: "acme.morbeh.shop",
    kind: "platform",
    status: "verified",
    isPrimary: true,
    verifiedAt: null,
    ...overrides,
  };
}

/** The runtime's real trial shape: `active`, no invoice, first charge = trial end, still ahead. */
function billing(overrides: Partial<MerchantBillingDto>): MerchantBillingDto {
  return {
    plan: null,
    status: "active",
    nextChargeAt: "2026-10-19T10:00:00.000Z",
    trialEndsAt: "2026-10-19T10:00:00.000Z",
    cardOnFile: false,
    invoices: [],
    ...overrides,
  };
}

const NO_CONTEXT = { storeName: null, storeUrl: null, banner: null, trialDaysLeft: null };

beforeEach(() => {
  readSession.mockReset().mockResolvedValue({ token: "t" });
  fetchStoreSettings
    .mockReset()
    .mockResolvedValue({ outcome: "ok", settings: { storeName: "Acme" } });
  fetchMyDomains
    .mockReset()
    .mockResolvedValue({ outcome: "ok", domains: [domain({ isPrimary: true })] });
  fetchMyBilling.mockReset().mockResolvedValue({ outcome: "ok", billing: billing({}) });
});

describe("loadStoreContext", () => {
  it("reads the store name, the primary domain and the billing banner", async () => {
    await expect(loadStoreContext(NOW)).resolves.toEqual({
      storeName: "Acme",
      storeUrl: "https://acme.morbeh.shop",
      banner: "trial-ending",
      trialDaysLeft: 2,
    });
  });

  it("returns all nulls without fetching when there is no session", async () => {
    readSession.mockResolvedValue(null);
    await expect(loadStoreContext(NOW)).resolves.toEqual(NO_CONTEXT);
    expect(fetchStoreSettings).not.toHaveBeenCalled();
    expect(fetchMyDomains).not.toHaveBeenCalled();
    expect(fetchMyBilling).not.toHaveBeenCalled();
  });

  it("nulls only the field whose fetch threw, keeping the others", async () => {
    fetchStoreSettings.mockRejectedValue(new Error("boom"));
    await expect(loadStoreContext(NOW)).resolves.toMatchObject({
      storeName: null,
      storeUrl: "https://acme.morbeh.shop",
      banner: "trial-ending",
    });
  });

  it("nulls the fields behind a non-ok outcome", async () => {
    fetchMyDomains.mockResolvedValue({ outcome: "error", message: "x" });
    fetchMyBilling.mockResolvedValue({ outcome: "unauthorized" });
    await expect(loadStoreContext(NOW)).resolves.toEqual({
      storeName: "Acme",
      storeUrl: null,
      banner: null,
      trialDaysLeft: null,
    });
  });

  it("never throws, even if every fetch and the session read fail", async () => {
    fetchStoreSettings.mockRejectedValue(new Error("a"));
    fetchMyDomains.mockRejectedValue(new Error("b"));
    fetchMyBilling.mockRejectedValue(new Error("c"));
    await expect(loadStoreContext(NOW)).resolves.toEqual(NO_CONTEXT);
    readSession.mockRejectedValue(new Error("d"));
    await expect(loadStoreContext(NOW)).resolves.toEqual(NO_CONTEXT);
  });

  it("treats a blank store name as no name", async () => {
    fetchStoreSettings.mockResolvedValue({ outcome: "ok", settings: { storeName: "   " } });
    await expect(loadStoreContext(NOW)).resolves.toMatchObject({ storeName: null });
  });

  it("has no store URL when no domain is primary", async () => {
    fetchMyDomains.mockResolvedValue({
      outcome: "ok",
      domains: [domain({ isPrimary: false })],
    });
    await expect(loadStoreContext(NOW)).resolves.toMatchObject({ storeUrl: null });
  });

  it("uses the primary domain even when it is a custom one", async () => {
    fetchMyDomains.mockResolvedValue({
      outcome: "ok",
      domains: [
        domain({ isPrimary: false }),
        domain({ id: "d2", hostname: "shop.acme.com", kind: "custom", isPrimary: true }),
      ],
    });
    await expect(loadStoreContext(NOW)).resolves.toMatchObject({
      storeUrl: "https://shop.acme.com",
    });
  });

  it("reports past-due without a trial day count", async () => {
    fetchMyBilling.mockResolvedValue({
      outcome: "ok",
      billing: billing({ status: "grace", trialEndsAt: null }),
    });
    await expect(loadStoreContext(NOW)).resolves.toMatchObject({
      banner: "past-due",
      trialDaysLeft: null,
    });
  });
});
