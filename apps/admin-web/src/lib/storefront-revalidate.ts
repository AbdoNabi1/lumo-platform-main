import { currentTenantRef } from "@/lib/api/client";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/** Global constraints: the revalidation call's own timeout. */
const TIMEOUT_MS = 2_000;

/**
 * Decision 33 / spec 1.11: after a save that changes the live storefront, ask the storefront to drop
 * its cached shell for this shop (`POST <storefront>/api/revalidate`, `apps/storefront/src/app/api/
 * revalidate/route.ts`). Best effort: 2 s timeout, never throws, never fails the action — the
 * storefront's 60 s TTL is the safety net, and `false` tells the caller to say so.
 *
 * Server only. The secret is never logged. A missing secret is logged, not fatal (Ruling 21); a 400
 * means the storefront refused the shop id, which is a configuration bug, so it is logged as an error.
 */
export async function revalidateStorefront(shopId?: string): Promise<boolean> {
  try {
    const secret = process.env["STOREFRONT_REVALIDATE_SECRET"]?.trim() ?? "";
    const base = (
      process.env["STOREFRONT_INTERNAL_URL"]?.trim() ||
      process.env["STOREFRONT_URL"]?.trim() ||
      ""
    ).replace(/\/+$/, "");
    if (secret === "" || base === "") {
      console.warn("storefront revalidation skipped: not configured", {
        missing: [
          ...(secret === "" ? ["STOREFRONT_REVALIDATE_SECRET"] : []),
          ...(base === "" ? ["STOREFRONT_INTERNAL_URL or STOREFRONT_URL"] : []),
        ],
      });
      return false;
    }
    const shop = shopId ?? currentTenantRef();
    const response = await fetchWithTimeout(
      `${base}/api/revalidate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-revalidate-secret": secret },
        body: JSON.stringify({ shopId: shop }),
        cache: "no-store",
      },
      TIMEOUT_MS,
    );
    if (response.status === 400) {
      console.error(
        "storefront revalidation refused the shop id: a configuration bug (TENANT_DEFAULT_ID?)",
        { status: response.status, shopId: shop },
      );
      return false;
    }
    if (!response.ok) console.warn("storefront revalidation refused", { status: response.status });
    return response.ok;
  } catch (error) {
    console.warn("storefront revalidation failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
