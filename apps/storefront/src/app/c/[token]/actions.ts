"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CHECKOUT_SESSION_COOKIE, CHECKOUT_SESSION_COOKIE_OPTIONS } from "@/lib/cart";
import { currentOrNewSessionRef } from "@/lib/guest-session";
import { claimCheckoutLink as claimCheckoutLinkApi } from "@/lib/runtime-api";

/** As the API mints them: 32 bytes, base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function failureOf(status: number): "invalid" | "unavailable" | "network" {
  if (status === 404) return "invalid";
  if (status === 409) return "unavailable";
  return "network";
}

/**
 * Order operations Part 3 — the landing page's "Continue to checkout" (spec §3.8). The claim happens
 * HERE, on the button, never when `/c/<token>` renders: WhatsApp and other apps fetch links to build
 * previews, and a claim on GET would clone carts for crawlers. The checkout made belongs to THIS
 * browser's guest session (minted if missing); the abandoned one is never handed over.
 *
 * The token is never logged, never set in a cookie and never sent anywhere but the Runtime API; the
 * only URL it appears in is the link's own `/c/<token>` path (a failed claim goes back to it).
 */
export async function claimCheckoutLink(token: string): Promise<void> {
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
    revalidatePath("/checkout");
    redirect(result.body.droppedItems > 0 ? "/checkout?dropped=1" : "/checkout");
  }
  redirect(`/c/${token}?error=${failureOf(result.status)}`);
}
