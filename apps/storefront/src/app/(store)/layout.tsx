import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { StoreChrome } from "@/components/store-chrome";
import {
  getPreviewToken,
  getRequestLocale,
  getRequestShell,
  getReturnPath,
} from "@/lib/request-locale";
import { safeReturnTo } from "@/lib/return-to";

/** Spec 1.12 "Route structure": every store page renders inside the shop's shell. */
export default async function StoreLayout({ children }: { readonly children: ReactNode }) {
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
  return (
    <StoreChrome
      shell={shell}
      locale={locale}
      previewToken={previewToken}
      previewExpired={token !== null && shell.previewExpired}
    >
      {children}
    </StoreChrome>
  );
}
