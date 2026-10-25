"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { issueRecoveryLink } from "@/lib/api/abandoned-checkouts";
import { newIdempotencyKey } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { recoveryLinkHref } from "@/lib/orders/abandoned-checkouts";

export type RecoveryLinkActionResult =
  | { readonly ok: true; readonly url: string; readonly shopName: string }
  | { readonly ok: false; readonly message: string };

const CHECKOUT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Order operations Part 3 — "Copy recovery link" and "Share on WhatsApp" both start here: a NEW link
 * per press (one idempotency key per press), its absolute URL (the shop's domain, else
 * `STOREFRONT_URL`), and the shop name for the WhatsApp text. The API decides the permission.
 */
export async function issueRecoveryLinkAction(
  checkoutId: string,
): Promise<RecoveryLinkActionResult> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const r = dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE).abandonedCheckouts.recovery;
  if (typeof checkoutId !== "string" || !CHECKOUT_ID.test(checkoutId)) {
    return { ok: false, message: r.error };
  }
  const result = await issueRecoveryLink(checkoutId, newIdempotencyKey());
  if (result.outcome !== "ok") {
    const message =
      result.outcome === "forbidden" || result.outcome === "unauthorized"
        ? r.forbidden
        : result.outcome === "conflict"
          ? r.alreadyRecovered
          : r.error;
    return { ok: false, message };
  }
  const url = recoveryLinkHref(result.data, process.env["STOREFRONT_URL"] ?? null);
  if (url === null) return { ok: false, message: r.noStoreAddress };
  revalidatePath(`/abandoned-checkouts/${checkoutId}`);
  revalidatePath("/abandoned-checkouts");
  return { ok: true, url, shopName: result.data.shopName };
}
