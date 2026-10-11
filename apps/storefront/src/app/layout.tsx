import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "./globals.css";
import { ThemeProvider } from "@platform/ui";
import { DEFAULT_LOCALE, directionFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { getPublicStore } from "@/lib/runtime-api";

/**
 * Plan 3C: the tab shows the shop's own name (Settings → General), or "Store" until it has one — not a
 * build-time placeholder. Read per request, so renaming the shop shows on the next page load.
 */
export async function generateMetadata(): Promise<Metadata> {
  const store = await getPublicStore();
  const name = store?.name.trim() ?? "";
  return { title: name.length > 0 ? name : "Store" };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;

  return (
    <html
      lang={locale}
      dir={directionFor(locale)}
      className={GeistSans.variable}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
