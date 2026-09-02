import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

/** The locales the Lumo admin surface is validated in — one LTR, one RTL. */
export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie the locale is persisted in. Read in the root layout, written by a server action. */
export const LOCALE_COOKIE = "lumo-locale";

const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = { en, ar };

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (LOCALES as readonly string[]).includes(value);
}

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/** Writing direction. This is the only place the app decides LTR vs RTL. */
export function directionFor(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}
