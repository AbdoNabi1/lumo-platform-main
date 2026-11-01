import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  DEFAULT_THEME_DOCUMENT,
  normalizeLocalizedText,
  readBrandStyle,
  readSocial,
  type BrandStyle,
  type Locale,
  type LocalizedText,
  type ThemeBrand,
} from "@platform/storefront-content";
import { currentShopId, RUNTIME_API_URL } from "./runtime-api";

/** Set ONLY by middleware (client-sent copies are stripped there). */
export const PREVIEW_HEADER = "x-morbeh-preview";
export const shellTag = (shopId: string): string => `os:${shopId}`;
const SHELL_TTL_SECONDS = 60;
/** A hung Runtime must not hang the layout: past this the read fails and the fallback renders. */
const RUNTIME_TIMEOUT_MS = 3_000;

export interface ShellImage {
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface StorefrontShell {
  readonly mode: "live" | "preview";
  readonly previewExpiresAt: string | null;
  /** A preview token was sent but is invalid or expired: this is the LIVE shell. */
  readonly previewExpired: boolean;
  readonly branded: boolean;
  readonly storeName: string;
  readonly defaultLocale: Locale;
  readonly preferences: {
    readonly homeTitle: LocalizedText;
    readonly homeMetaDescription: LocalizedText;
    readonly shareImage: ShellImage | null;
  };
  readonly brand: {
    readonly logo: { readonly image: ShellImage | null; readonly widthPx: number };
    readonly favicon: ShellImage | null;
    readonly style: BrandStyle;
    readonly social: ThemeBrand["social"];
  };
  readonly header: { readonly sticky: boolean };
  readonly footer: { readonly note: LocalizedText; readonly showSocial: boolean };
  readonly locked: boolean;
}

/** What renders when the Runtime cannot answer: today's look, unlocked (the gate fails closed in middleware). */
export const FALLBACK_SHELL: StorefrontShell = Object.freeze({
  mode: "live",
  previewExpiresAt: null,
  previewExpired: false,
  branded: false,
  storeName: "",
  defaultLocale: "ar",
  preferences: { homeTitle: {}, homeMetaDescription: {}, shareImage: null },
  brand: {
    logo: { image: null, widthPx: 140 },
    favicon: null,
    style: readBrandStyle(DEFAULT_THEME_DOCUMENT.brand),
    social: {},
  },
  header: { sticky: false },
  footer: { note: {}, showSocial: true },
  locked: false,
});

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const size = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000
    ? value
    : null;

function imageOf(value: unknown): ShellImage | null {
  const o = obj(value);
  const url = o["url"];
  if (typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return {
    url: parsed.toString(),
    alt: typeof o["alt"] === "string" ? o["alt"] : null,
    width: size(o["width"]),
    height: size(o["height"]),
  };
}

const textOf = (value: unknown, multiline = false): LocalizedText =>
  normalizeLocalizedText(value, { path: "", max: Number.MAX_SAFE_INTEGER, multiline }, []);

/** Spec 1.12 step 3: re-validate EVERYTHING received before it reaches CSS or markup. */
export function sanitizeShell(raw: unknown, mode: "live" | "preview"): StorefrontShell {
  const o = obj(raw);
  if (Object.keys(o).length === 0) return { ...FALLBACK_SHELL };
  const prefs = obj(o["preferences"]);
  const brand = obj(o["brand"]);
  const logo = obj(brand["logo"]);
  const width = logo["widthPx"];
  return {
    mode,
    previewExpiresAt:
      mode === "preview" && typeof o["previewExpiresAt"] === "string"
        ? o["previewExpiresAt"]
        : null,
    previewExpired: false,
    branded: o["branded"] === true,
    storeName: typeof o["storeName"] === "string" ? o["storeName"].trim() : "",
    defaultLocale: o["defaultLocale"] === "en" ? "en" : "ar",
    preferences: {
      homeTitle: textOf(prefs["homeTitle"]),
      homeMetaDescription: textOf(prefs["homeMetaDescription"]),
      shareImage: imageOf(prefs["shareImage"]),
    },
    brand: {
      logo: {
        image: imageOf(logo["image"]),
        widthPx:
          typeof width === "number" && Number.isInteger(width) && width >= 60 && width <= 320
            ? width
            : 140,
      },
      favicon: imageOf(brand["favicon"]),
      style: readBrandStyle(brand),
      social: readSocial(brand["social"]),
    },
    header: { sticky: obj(o["header"])["sticky"] === true },
    footer: {
      note: textOf(obj(o["footer"])["note"], true),
      showSocial: obj(o["footer"])["showSocial"] !== false,
    },
    locked: o["locked"] === true,
  };
}

/** Never throws: a refused, failed or timed-out read is `status: 0`, otherwise the Runtime's status. */
async function fetchShell(
  shopId: string,
  previewToken: string | null,
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(`${RUNTIME_API_URL}/api/v1/public/online-store`, {
      headers: {
        "x-tenant-id": shopId,
        ...(previewToken === null ? {} : { "x-preview-token": previewToken }),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(RUNTIME_TIMEOUT_MS),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * Decision 32: `unstable_cache` with the shop id in the KEY PARTS and tag `os:<shopId>`, 60 s TTL. A
 * failed read throws inside the cached function, so a failure is never cached.
 */
function cachedLiveShell(shopId: string): Promise<StorefrontShell> {
  return unstable_cache(
    async () => {
      const res = await fetchShell(shopId, null);
      if (res.status !== 200) throw new Error(`storefront shell read failed (${res.status})`);
      return sanitizeShell(res.body, "live");
    },
    ["online-store", shopId, "shell"],
    { tags: [shellTag(shopId)], revalidate: SHELL_TTL_SECONDS },
  )();
}

/** Live (cached) or preview (`no-store`); an invalid preview falls back to live with `previewExpired`. */
export const getStorefrontShell = cache(
  async (previewToken: string | null): Promise<StorefrontShell> => {
    const shopId = await currentShopId();
    const live = async (): Promise<StorefrontShell> => {
      try {
        return await cachedLiveShell(shopId);
      } catch {
        return FALLBACK_SHELL;
      }
    };
    if (previewToken === null) return live();
    const res = await fetchShell(shopId, previewToken);
    if (res.status === 200) return sanitizeShell(res.body, "preview");
    if (res.status === 401) return { ...(await live()), previewExpired: true };
    return live();
  },
);

/** For the password page only (never cached): the visitor message and lock state. */
export async function getPublicAccess(): Promise<{
  locked: boolean;
  accessVersion: number;
  message: LocalizedText;
} | null> {
  try {
    const response = await fetch(`${RUNTIME_API_URL}/api/v1/public/online-store/access`, {
      headers: { "x-tenant-id": await currentShopId() },
      cache: "no-store",
      signal: AbortSignal.timeout(RUNTIME_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = obj(await response.json());
    if (typeof body["locked"] !== "boolean" || typeof body["accessVersion"] !== "number")
      return null;
    return {
      locked: body["locked"],
      accessVersion: body["accessVersion"],
      message: textOf(body["message"], true),
    };
  } catch {
    return null;
  }
}
