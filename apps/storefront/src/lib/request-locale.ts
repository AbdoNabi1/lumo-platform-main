import { cache } from "react";
import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "./i18n";
import { getStorefrontShell, PREVIEW_HEADER, type StorefrontShell } from "./online-store";
import { RETURN_PATH_HEADER } from "./return-to";

/** The preview token the middleware forwarded (client-sent copies were stripped there). */
export const getPreviewToken = cache(async (): Promise<string | null> =>
  (await headers()).get(PREVIEW_HEADER),
);

/** The page asked for, as the middleware recorded it (already a safe path; re-check on use). */
export const getReturnPath = cache(async (): Promise<string | null> =>
  (await headers()).get(RETURN_PATH_HEADER),
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
