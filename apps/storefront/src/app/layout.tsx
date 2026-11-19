import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
// The merchant's choice among six bundled families (spec 1.3). @font-face downloads lazily, so a shop
// only fetches the families its CSS variables name.
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/700.css";
import "@fontsource/tajawal/400.css";
import "@fontsource/tajawal/700.css";
import "@fontsource/almarai/400.css";
import "@fontsource/almarai/700.css";
import "@fontsource/readex-pro/400.css";
import "@fontsource/readex-pro/700.css";
import "@fontsource/amiri/400.css";
import "@fontsource/amiri/700.css";
import "./globals.css";
import { ThemeProvider } from "@platform/ui";
import { dictionaryFor, directionFor } from "@/lib/i18n";
import { getLockedView, getRequestLocale, getRequestShell } from "@/lib/request-locale";
import { brandStyleFor, lockedMetadataFor, metadataFor } from "@/lib/shell-presentation";

/**
 * A locked store's pages that stay reachable (the gate, a 404, policies) never show its home title,
 * description or share image (preflight 18); the owner's private preview keeps them.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [lockedView, shell, locale] = await Promise.all([
    getLockedView(),
    getRequestShell(),
    getRequestLocale(),
  ]);
  const t = dictionaryFor(locale);
  // The gate's locked view too (task 9 review, minor 2): a fallback or stale-unlocked shell must
  // not give a locked store's policy page the home description, share image or an index.
  return lockedView || (shell.locked && shell.mode === "live")
    ? lockedMetadataFor(shell, locale, t)
    : metadataFor(shell, locale, t);
}

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const [shell, locale] = await Promise.all([getRequestShell(), getRequestLocale()]);
  const brandCss = brandStyleFor(shell);
  return (
    <html
      lang={locale}
      dir={directionFor(locale)}
      className={GeistSans.variable}
      suppressHydrationWarning
    >
      <head>{brandCss === null ? null : <style id="brand">{brandCss}</style>}</head>
      <body>
        <ThemeProvider {...(shell.branded ? { forcedTheme: "light" } : {})}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
