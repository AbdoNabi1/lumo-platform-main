import { cache } from "react";
import { fetchMyBilling } from "@/lib/api/store-billing";
import { fetchMyDomains } from "@/lib/api/store-domains";
import { fetchStoreSettings } from "@/lib/api/store-settings";
import { readSession } from "@/lib/auth/session";
import { billingBanner, trialDaysLeft } from "@/lib/billing/model";
import { primaryDomain } from "@/lib/domains/model";

/** What the admin shell shows about the shop; every field is `null` when it can't be read. */
export interface StoreContext {
  readonly storeName: string | null;
  /** The primary domain as `https://<hostname>`. */
  readonly storeUrl: string | null;
  readonly banner: "trial-ending" | "past-due" | null;
  readonly trialDaysLeft: number | null;
}

const NO_CONTEXT: StoreContext = {
  storeName: null,
  storeUrl: null,
  banner: null,
  trialDaysLeft: null,
};

/** Runs one lookup; a throw or a non-ok outcome becomes `null`, never an error. */
async function attempt<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/**
 * Reads the shop's name, primary domain and billing in parallel for the shell. It MUST NOT make the
 * shell fail: a failed lookup only nulls its own field. With no session (tests, build-time
 * rendering) it returns all nulls without calling the runtime.
 */
export async function loadStoreContext(now: Date = new Date()): Promise<StoreContext> {
  if ((await attempt(readSession)) === null) return NO_CONTEXT;

  const [storeName, storeUrl, billing] = await Promise.all([
    attempt(async () => {
      const result = await fetchStoreSettings();
      if (result.outcome !== "ok") return null;
      const name = result.settings.storeName.trim();
      return name === "" ? null : name;
    }),
    attempt(async () => {
      const result = await fetchMyDomains();
      if (result.outcome !== "ok") return null;
      const primary = primaryDomain(result.domains);
      return primary === null ? null : `https://${primary.hostname}`;
    }),
    attempt(async () => {
      const result = await fetchMyBilling();
      return result.outcome === "ok" ? result.billing : null;
    }),
  ]);

  return {
    storeName,
    storeUrl,
    banner: billing === null ? null : billingBanner(billing, now),
    trialDaysLeft: billing === null ? null : trialDaysLeft(billing.trialEndsAt, now),
  };
}

/** `loadStoreContext` memoised for the current request, so the shell and any page share one read. */
export const getStoreContext = cache(() => loadStoreContext());
