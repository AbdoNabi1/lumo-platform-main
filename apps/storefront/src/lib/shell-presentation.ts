import type { Metadata } from "next";
import { brandStyleSheet, pickText } from "@platform/storefront-content";
import type { Locale } from "./i18n";
import type { ShellImage, StorefrontShell } from "./online-store";
import type { Dictionary } from "@/messages/en";

/** Ruling 6: only a branded shop gets a brand sheet; the package re-validates every value. */
export function brandStyleFor(shell: StorefrontShell): string | null {
  return shell.branded ? brandStyleSheet(shell.brand.style) : null;
}

export function metadataFor(shell: StorefrontShell, locale: Locale, t: Dictionary): Metadata {
  const name = shell.storeName.trim();
  const title =
    pickText(shell.preferences.homeTitle, locale) ?? (name !== "" ? name : t.meta.fallbackTitle);
  const description = pickText(shell.preferences.homeMetaDescription, locale);
  const share = shell.preferences.shareImage;
  const favicon = shell.brand.favicon;
  return {
    // Next substitutes every %s in a template, so the name must not bring its own.
    title: { default: title, template: name !== "" ? `%s | ${name.replaceAll("%", "")}` : "%s" },
    ...(description === null ? {} : { description }),
    openGraph: {
      ...(name === "" ? {} : { siteName: name }),
      locale: locale === "ar" ? "ar_EG" : "en_US",
      type: "website",
      // No title or description: Next fills og:title and og:description per page from the resolved
      // title and description, so a child page does not repeat the home page's (review M-6).
      ...(share === null
        ? {}
        : {
            images: [
              {
                url: share.url,
                ...(share.width === null ? {} : { width: share.width }),
                ...(share.height === null ? {} : { height: share.height }),
                ...(share.alt === null ? {} : { alt: share.alt }),
              },
            ],
          }),
    },
    twitter: { card: "summary_large_image" },
    ...(favicon === null
      ? {}
      : { icons: { icon: [{ url: favicon.url }], apple: [{ url: favicon.url }] } }),
    // Decision 35: a locked store is noindex, and so is every preview, locked or not (a draft must
    // never be indexed, final review M-1).
    ...(shell.locked || shell.mode === "preview"
      ? { robots: { index: false, follow: false } }
      : {}),
  };
}

/**
 * Preflight 18 / Review Focus 5: what a locked store may tell a link preview or a crawler: its name
 * and "Opening soon", nothing else (no home title, description or share image). Never indexed.
 */
export function lockedMetadataFor(shell: StorefrontShell, locale: Locale, t: Dictionary): Metadata {
  const name = shell.storeName.trim();
  const title = name !== "" ? name : t.password.title;
  const description = t.password.defaultMessage;
  const favicon = shell.brand.favicon;
  return {
    title,
    description,
    openGraph: {
      ...(name === "" ? {} : { siteName: name }),
      locale: locale === "ar" ? "ar_EG" : "en_US",
      title,
      description,
    },
    twitter: { card: "summary", title, description },
    ...(favicon === null
      ? {}
      : { icons: { icon: [{ url: favicon.url }], apple: [{ url: favicon.url }] } }),
    robots: { index: false, follow: false },
  };
}

export function logoSize(
  image: ShellImage,
  widthPx: number,
): { width: number; height: number | undefined } {
  if (image.width === null || image.height === null) return { width: widthPx, height: undefined };
  return { width: widthPx, height: Math.round((widthPx * image.height) / image.width) };
}
