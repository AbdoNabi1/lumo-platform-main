"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CHECKOUT_SESSION_COOKIE,
  CHECKOUT_SESSION_COOKIE_OPTIONS,
  INVOICE_CHECKOUT_COOKIE,
} from "@/lib/cart";
import { currentOrNewSessionRef } from "@/lib/guest-session";
import { claimCheckoutLink as claimCheckoutLinkApi } from "@/lib/runtime-api";

/** As the API mints them: 32 bytes, base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type ClaimFailure =
  | "invalid"
  | "unavailable"
  | "completed"
  | "notReady"
  | "busy"
  | "tooLarge"
  | "outOfStock"
  | "network";

/** 409 codes the API gives a claim → the fixed key the page words. Server message text is never used. */
const CONFLICT_FAILURES: ReadonlyMap<string, ClaimFailure> = new Map([
  ["ALREADY_COMPLETED", "completed"],
  // The same state reached another way (task 10 review M5): the draft is already an order.
  ["DRAFT_COMPLETED", "completed"],
  ["DRAFT_NOT_READY", "notReady"],
  ["DRAFT_BUSY", "busy"],
  ["DRAFT_TOTAL_TOO_LARGE", "tooLarge"],
  ["OUT_OF_STOCK", "outOfStock"],
]);

function failureOf(status: number, body: unknown): ClaimFailure {
  if (status === 404) return "invalid";
  if (status === 409) {
    const code = (body as { readonly code?: unknown } | null)?.code;
    return (typeof code === "string" ? CONFLICT_FAILURES.get(code) : undefined) ?? "unavailable";
  }
  return "network";
}

/**
 * Order operations Part 3 — the landing page's "Continue to checkout" (spec §3.8). The claim happens
 * HERE, on the button, never when `/c/<token>` renders: WhatsApp and other apps fetch links to build
 * previews, and a claim on GET would clone carts for crawlers. The checkout made belongs to THIS
 * browser's guest session (minted if missing); the abandoned one is never handed over.
 *
 * Part 4: an invoice link's claim takes over the merchant's draft checkout for this browser; the same
 * cookie and redirect apply. Failures go back to the page as a fixed key, never the server's words.
 *
 * The token is never logged, never set in a cookie and never sent anywhere but the Runtime API; the
 * only URL it appears in is the link's own `/c/<token>` path (a failed claim goes back to it).
 * `purpose` (bound by the page from the preview) only chooses `/checkout`'s wording should this
 * browser lose the session later; it grants nothing.
 */
export async function claimCheckoutLink(
  token: string,
  purpose?: "recovery" | "invoice",
): Promise<void> {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) redirect("/");
  const sessionRef = await currentOrNewSessionRef();
  const result = await claimCheckoutLinkApi(token, sessionRef);
  if (result.status === 200 && result.body !== null) {
    const jar = await cookies();
    jar.set(
      CHECKOUT_SESSION_COOKIE,
      result.body.checkoutSessionId,
      CHECKOUT_SESSION_COOKIE_OPTIONS,
    );
    if (purpose === "invoice") {
      const id = result.body.checkoutSessionId;
      jar.set(INVOICE_CHECKOUT_COOKIE, id, CHECKOUT_SESSION_COOKIE_OPTIONS);
    }
    // The claim also replaced this browser's cart server-side.
    revalidatePath("/cart");
    revalidatePath("/checkout");
    redirect(result.body.droppedItems > 0 ? "/checkout?dropped=1" : "/checkout");
  }
  redirect(`/c/${token}?error=${failureOf(result.status, result.body)}`);
}
