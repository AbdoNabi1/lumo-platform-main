import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";
import { DEFAULT_PUBLIC_CHECKOUT_SETTINGS } from "./checkout-settings-model";

const getPublicCheckoutSettings = vi.fn();
const fetchPublicCheckoutSettings = vi.fn();
vi.mock("./runtime-api", () => ({
  getPublicCheckoutSettings: () => getPublicCheckoutSettings(),
  fetchPublicCheckoutSettings: (shopId: string) => fetchPublicCheckoutSettings(shopId),
  currentShopId: async () => "shop-1",
}));
/** The real `unstable_cache` needs Next's incremental cache; here it just runs the function. */
const cacheCalls: { keyParts: readonly string[]; options: unknown }[] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: readonly string[], options: unknown) => {
    cacheCalls.push({ keyParts, options });
    return fn;
  },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  cache: <T>(fn: T): T => fn,
}));

const { loadCheckoutSettings, getAccountLinkVisible, checkoutSettingsTag } =
  await import("./checkout-settings");

const CUSTOM = {
  ...DEFAULT_PUBLIC_CHECKOUT_SETTINGS,
  nameMode: "optional",
  requireLogin: true,
} as const;

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  cacheCalls.length = 0;
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

describe("loadCheckoutSettings (the checkout, cart and account pages)", () => {
  it("returns what the read says and reads again on every call (never cached)", async () => {
    getPublicCheckoutSettings.mockResolvedValue(CUSTOM);
    expect(await loadCheckoutSettings()).toEqual(CUSTOM);
    expect(await loadCheckoutSettings()).toEqual(CUSTOM);
    expect(getPublicCheckoutSettings).toHaveBeenCalledTimes(2);
    expect(cacheCalls).toEqual([]); // no unstable_cache on this path
    expect(logged).not.toHaveBeenCalled();
  });

  it("fails safe: a failed read gives the D33 defaults and says so in the log", async () => {
    getPublicCheckoutSettings.mockResolvedValue(null);
    expect(await loadCheckoutSettings()).toEqual(DEFAULT_PUBLIC_CHECKOUT_SETTINGS);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("checkout settings unavailable"));
  });

  it("fails safe when the read throws, too", async () => {
    getPublicCheckoutSettings.mockRejectedValue(new Error("boom"));
    expect(await loadCheckoutSettings()).toEqual(DEFAULT_PUBLIC_CHECKOUT_SETTINGS);
    expect(logged).toHaveBeenCalled();
  });
});

describe("getAccountLinkVisible (the header)", () => {
  it("is cached for 60 s under this shop's key and tag", async () => {
    fetchPublicCheckoutSettings.mockResolvedValue(DEFAULT_PUBLIC_CHECKOUT_SETTINGS);
    expect(await getAccountLinkVisible()).toBe(true);
    expect(fetchPublicCheckoutSettings).toHaveBeenCalledWith("shop-1");
    expect(cacheCalls[0]?.keyParts).toContain("shop-1");
    expect(cacheCalls[0]?.options).toEqual({
      tags: [checkoutSettingsTag("shop-1")],
      revalidate: 60,
    });
  });

  it("hides the link when the merchant hides it, or when accounts are off", async () => {
    fetchPublicCheckoutSettings.mockResolvedValue({
      ...DEFAULT_PUBLIC_CHECKOUT_SETTINGS,
      showAccountLink: false,
    });
    expect(await getAccountLinkVisible()).toBe(false);
    fetchPublicCheckoutSettings.mockResolvedValue({
      ...DEFAULT_PUBLIC_CHECKOUT_SETTINGS,
      accountsMode: "disabled",
    });
    expect(await getAccountLinkVisible()).toBe(false);
  });

  it("shows the link (today's header) and logs when the read fails", async () => {
    fetchPublicCheckoutSettings.mockResolvedValue(null);
    expect(await getAccountLinkVisible()).toBe(true);
    expect(logged).toHaveBeenCalled();
  });
});
