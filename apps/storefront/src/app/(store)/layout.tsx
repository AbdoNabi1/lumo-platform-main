import type { ReactNode } from "react";
import { StoreChrome } from "@/components/store-chrome";
import { getPreviewToken, getRequestLocale, getRequestShell } from "@/lib/request-locale";

/** Spec 1.12 "Route structure": every store page renders inside the shop's shell. */
export default async function StoreLayout({ children }: { readonly children: ReactNode }) {
  const [shell, locale, token] = await Promise.all([
    getRequestShell(),
    getRequestLocale(),
    getPreviewToken(),
  ]);
  const previewToken = token !== null && shell.mode === "preview" ? token : null;
  return (
    <StoreChrome shell={shell} locale={locale} previewToken={previewToken}>
      {children}
    </StoreChrome>
  );
}
