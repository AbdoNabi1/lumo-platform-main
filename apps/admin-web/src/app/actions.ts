"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";

/**
 * Persist the operator's language choice.
 *
 * Switching language also switches writing direction, which the root layout applies to
 * `<html dir>` — so this has to round-trip through the server rather than being flipped
 * client-side.
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) {
    throw new Error(`Unsupported locale: ${String(locale)}`);
  }

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/");
}
