import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { LockedFrame } from "@/components/locked-frame";
import { StoreChrome } from "@/components/store-chrome";
import {
  getLockedView,
  getPreviewToken,
  getRequestLocale,
  getRequestShell,
  getReturnPath,
} from "@/lib/request-locale";
import { getAccountLinkVisible } from "@/lib/checkout-settings";
import { safeReturnTo } from "@/lib/return-to";

/** Spec 1.12 "Route structure": every store page renders inside the shop's shell. */
export default async function StoreLayout({ children }: { readonly children: ReactNode }) {
  // Ruling 5: the gate let this request through a locked store only because the route stays
  // reachable (a policy page). It renders without the shop's chrome, whatever the shell read says.
  if (await getLockedView()) {
    const [shell, locale] = await Promise.all([getRequestShell(), getRequestLocale()]);
    return (
      <LockedFrame shell={shell} locale={locale}>
        {children}
      </LockedFrame>
    );
  }
  const [shell, locale, token] = await Promise.all([
    getRequestShell(),
    getRequestLocale(),
    getPreviewToken(),
  ]);
  // Ruling 36, second layer only: the middleware already checked the token with the Runtime before
  // letting it through a locked store. A token this shell read did not honour lands on the gate. (A
  // failed read is the unlocked FALLBACK_SHELL, so this can never be the only gate.) The visitor
  // comes back to the same page after unlocking (review M-4).
  if (token !== null && shell.mode !== "preview" && shell.locked) {
    const back = safeReturnTo(await getReturnPath());
    redirect(`/password?return_to=${encodeURIComponent(back)}`);
  }
  const previewToken = token !== null && shell.mode === "preview" ? token : null;
  // Wave 2a: the header's account icon follows the shop's checkout settings (display only).
  const showAccountLink = await getAccountLinkVisible();
  return (
    <StoreChrome
      shell={shell}
      locale={locale}
      previewToken={previewToken}
      previewExpired={token !== null && shell.previewExpired}
      showAccountLink={showAccountLink}
    >
      {children}
    </StoreChrome>
  );
}
