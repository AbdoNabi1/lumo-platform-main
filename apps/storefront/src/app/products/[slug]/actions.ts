"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-session";
import { createProductReview } from "@/lib/runtime-api";

/**
 * Product review authoring (T5.18-write). Same discipline as `app/account/wishlist/actions.ts`:
 * the customer session cookie is read here, server-side, and never reaches a Client Component.
 * This action takes no `customerRef` — the route derives the author from the session, so there is
 * nothing here for a caller to supply or tamper with.
 *
 * One `Idempotency-Key` per submit (`crypto.randomUUID()`), same convention as every other
 * storefront write action.
 */

export type ReviewSubmissionResult =
  | { readonly ok: true; readonly status: string }
  | {
      readonly ok: false;
      /** `"signed-out"`: no valid customer session (the guard's 401). `"duplicate"`: this customer
       * already reviewed this product (one review per customer/product — a 409). `"validation"`: the
       * rating/body were rejected. `"network"`: unreachable or an unexpected status. */
      readonly reason: "signed-out" | "duplicate" | "validation" | "network";
    };

async function customerSession(): Promise<string | undefined> {
  const jar = await cookies();
  const value = jar.get(CUSTOMER_SESSION_COOKIE)?.value;
  return value !== undefined && value.length > 0 ? value : undefined;
}

function mapFailure(status: number): ReviewSubmissionResult {
  if (status === 401) return { ok: false, reason: "signed-out" };
  if (status === 409) return { ok: false, reason: "duplicate" };
  if (status === 422 || status === 400) return { ok: false, reason: "validation" };
  return { ok: false, reason: "network" };
}

export async function submitProductReview(
  slug: string,
  productRef: string,
  rating: number,
  bodyText: string,
): Promise<ReviewSubmissionResult> {
  const sessionId = await customerSession();
  if (sessionId === undefined) return { ok: false, reason: "signed-out" };

  const response = await createProductReview(
    sessionId,
    { productRef, rating, bodyText },
    crypto.randomUUID(),
  );
  if (response.status < 200 || response.status >= 300 || response.body === null) {
    return mapFailure(response.status);
  }

  // The submitted review is `"pending"` moderation — it will not appear in the published list
  // above until an operator publishes it, but the page is still revalidated so a subsequent visit
  // reflects the moment it does.
  revalidatePath(`/products/${slug}`);
  return { ok: true, status: response.body.status };
}
