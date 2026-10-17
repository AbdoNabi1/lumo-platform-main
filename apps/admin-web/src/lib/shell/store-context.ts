import { cache } from "react";
import { fetchMyBilling } from "@/lib/api/store-billing";
import { fetchMyDomains } from "@/lib/api/store-domains";
import { fetchStoreSettings } from "@/lib/api/store-settings";
import { readSession } from "@/lib/auth/session";
import { billingBanner, trialDaysLeft } from "@/lib/billing/model";
import { primaryDomain } from "@/lib/domains/model";
import { requireProdEnv } from "@/lib/env";

/** What the admin shell shows about the shop; every field is `null` when it can't be read. */
export interface StoreContext {
  readonly storeName: string | null;
  /** The primary domain as `https://<hostname>`. */
  readonly storeUrl: string | null;
  readonly banner: "trial-ending" | "past-due" | null;
  readonly trialDaysLeft: number | null;
  /** The signed-in store (the session's `tenant_id` claim); `null` with no session or no claim. */
  readonly sessionTenantId: string | null;
}

const NO_CONTEXT: StoreContext = {
  storeName: null,
  storeUrl: null,
  banner: null,
  trialDaysLeft: null,
  sessionTenantId: null,
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
  const session = await attempt(readSession);
  if (session === null) return NO_CONTEXT;

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
    sessionTenantId: session.tenantId ?? null,
  };
}

/** `TENANT_DEFAULT_ID` as the API client resolves it; `null` if it cannot be resolved here. */
function defaultTenantId(): string | null {
  try {
    return requireProdEnv("TENANT_DEFAULT_ID", "tenant-local");
  } catch {
    return null;
  }
}

/**
 * Where "View your store" (and the product editor's Preview) should go — never another store. The
 * store's own primary domain when known; otherwise `STOREFRONT_URL` (the single-store deployment's
 * storefront) ONLY when there is no session tenant or it is the default tenant; else `null`, which
 * hides the link. Read per request, on the server: `NEXT_PUBLIC_*` would be frozen at build time.
 */
export function storeUrlForSession(
  context: Pick<StoreContext, "storeUrl" | "sessionTenantId">,
): string | null {
  if (context.storeUrl !== null) return context.storeUrl;
  const fallback = process.env["STOREFRONT_URL"]?.trim() || null;
  if (fallback === null) return null;
  if (context.sessionTenantId === null) return fallback;
  return context.sessionTenantId === defaultTenantId() ? fallback : null;
}

/** `loadStoreContext` memoised for the current request, so the shell and any page share one read. */
export const getStoreContext = cache(() => loadStoreContext());
