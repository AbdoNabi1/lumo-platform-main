import { cache } from "react";
import { unstable_cache } from "next/cache";
import { STOREFRONT_CACHE_TTL_SECONDS } from "./shell-tag";
import {
  accountLinkVisible,
  DEFAULT_PUBLIC_CHECKOUT_SETTINGS,
  type PublicCheckoutSettings,
} from "./checkout-settings-model";
import {
  currentShopId,
  fetchPublicCheckoutSettings,
  getPublicCheckoutSettings,
} from "./runtime-api";

/** The cache tag of one shop's header switches (only the header reads them through a cache). */
export const checkoutSettingsTag = (shopId: string): string => `checkout-settings:${shopId}`;

/**
 * The shop's checkout switches for a page that RENDERS them (checkout, cart, account pages): read
 * fresh on every call, never through the shell cache, so a merchant's change shows on the next view.
 *
 * Fails safe: when the read fails, the defaults apply, which are today's behaviour (D33), and the
 * failure is logged. The server enforces every switch itself (D34), so a page showing the defaults
 * for a moment cannot let a shopper past a rule; it can only show the form a little too plainly.
 */
export async function loadCheckoutSettings(): Promise<PublicCheckoutSettings> {
  const settings = await getPublicCheckoutSettings().catch(() => null);
  if (settings === null) {
    console.error("storefront: checkout settings unavailable, using the defaults");
    return DEFAULT_PUBLIC_CHECKOUT_SETTINGS;
  }
  return settings;
}

/**
 * Whether the header shows the account icon. This one is DISPLAY ONLY (the account pages and the
 * server answer for themselves when a shopper gets there), so it may ride a 60 s cache keyed by shop
 * like the shell, which keeps a settings read off every page view. A failed read throws inside the
 * cached function (never cached) and shows the link: today's behaviour.
 */
export const getAccountLinkVisible = cache(async (): Promise<boolean> => {
  try {
    const shopId = await currentShopId();
    const settings = await unstable_cache(
      async () => {
        const read = await fetchPublicCheckoutSettings(shopId);
        if (read === null) throw new Error("storefront checkout settings read failed");
        return read;
      },
      ["checkout-settings", shopId, "header"],
      { tags: [checkoutSettingsTag(shopId)], revalidate: STOREFRONT_CACHE_TTL_SECONDS },
    )();
    return accountLinkVisible(settings);
  } catch {
    console.error(
      "storefront: checkout settings unavailable for the header, showing the account link",
    );
    return true;
  }
});
