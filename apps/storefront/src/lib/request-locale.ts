import { cache } from "react";
import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "./i18n";
import { getStorefrontShell, PREVIEW_HEADER, type StorefrontShell } from "./online-store";

/** The preview token the middleware forwarded (client-sent copies were stripped there). */
export const getPreviewToken = cache(async (): Promise<string | null> =>
  (await headers()).get(PREVIEW_HEADER),
);

export const getRequestShell = cache(async (): Promise<StorefrontShell> =>
  getStorefrontShell(await getPreviewToken()),
);

/** Ruling 22: the shopper's cookie, else the shop's default language (Arabic when unset). */
export const getRequestLocale = cache(async (): Promise<Locale> => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;
  return (await getRequestShell()).defaultLocale;
});
