import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  DEFAULT_THEME_DOCUMENT,
  FOOTER_NOTE_MAX,
  POLICY_TYPES,
  readBrandStyle,
  readResolvedMenu,
  readSocial,
  type BrandStyle,
  type Locale,
  type LocalizedText,
  type PolicyType,
  type PublicAnnouncement,
  type ResolvedMenuItem,
  type ThemeBrand,
} from "@platform/storefront-content";
import { readPublicAnnouncement } from "./public-sections";
import { currentShopId, RUNTIME_API_URL } from "./runtime-api";
import { clip, imageOf, textOf } from "./sanitize";
import { shellTag, STOREFRONT_CACHE_TTL_SECONDS } from "./shell-tag";

export { clip, imageOf, shellTag, textOf };

/** Set ONLY by middleware (client-sent copies are stripped there). */
export const PREVIEW_HEADER = "x-morbeh-preview";
/** The admin's own limits (home title 70, description 320, footer note 200, visitor message 500). */
const HOME_TITLE_MAX = 70;
const HOME_DESCRIPTION_MAX = 320;
const VISITOR_MESSAGE_MAX = 500;
const STORE_NAME_MAX = 120;
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
  /** Spec 2.8: the header menu as the Runtime resolved it, every item re-validated here. */
  readonly header: {
    readonly sticky: boolean;
    readonly menu: readonly ResolvedMenuItem[];
    /** Part 3: the announcement bar, re-validated; null when there is none to show. */
    readonly announcement: PublicAnnouncement | null;
  };
  readonly footer: {
    readonly note: LocalizedText;
    readonly showSocial: boolean;
    readonly menu: readonly ResolvedMenuItem[];
    /** The set policies to link in the footer, once each, in `POLICY_TYPES` order. */
    readonly policies: readonly PolicyType[];
  };
  readonly locked: boolean;
}

/** Frozen all the way down; a clone first, because the style objects are shared defaults. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** What renders when the Runtime cannot answer: today's look, unlocked (the gate fails closed in middleware). */
export const FALLBACK_SHELL: StorefrontShell = deepFreeze(
  structuredClone({
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
    header: { sticky: false, menu: [], announcement: null },
    footer: { note: {}, showSocial: true, menu: [], policies: [] },
    locked: false,
  } satisfies StorefrontShell),
);

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
/**
 * Spec 1.12 step 3: re-validate EVERYTHING received before it reaches CSS or markup. Null when the
 * body is not a usable shell of the requested mode: empty, not an object, without `brand` and
 * `preferences`, or labelled with another `mode`. The label comes from the RESPONSE, never from the
 * caller alone, so a live body can never be presented as a preview.
 */
export function parseShell(raw: unknown, mode: "live" | "preview"): StorefrontShell | null {
  const o = obj(raw);
  if (o["mode"] !== mode) return null;
  if (
    Object.keys(obj(o["brand"])).length === 0 ||
    Object.keys(obj(o["preferences"])).length === 0
  ) {
    return null;
  }
  const prefs = obj(o["preferences"]);
  const brand = obj(o["brand"]);
  const logo = obj(brand["logo"]);
  const width = logo["widthPx"];
  const header = obj(o["header"]);
  const footer = obj(o["footer"]);
  const policies = footer["policies"];
  return {
    mode,
    previewExpiresAt:
      mode === "preview" && typeof o["previewExpiresAt"] === "string"
        ? o["previewExpiresAt"]
        : null,
    previewExpired: false,
    branded: o["branded"] === true,
    storeName:
      typeof o["storeName"] === "string" ? clip(o["storeName"].trim(), STORE_NAME_MAX) : "",
    defaultLocale: o["defaultLocale"] === "en" ? "en" : "ar",
    preferences: {
      homeTitle: textOf(prefs["homeTitle"], HOME_TITLE_MAX),
      homeMetaDescription: textOf(prefs["homeMetaDescription"], HOME_DESCRIPTION_MAX),
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
    // Spec 2.8: the package reader keeps only safe, labelled items and recomputes `external`.
    header: {
      sticky: header["sticky"] === true,
      menu: readResolvedMenu(header["menu"]),
      // Part 3: the same re-check as a homepage section, in this body's mode (Ruling 25).
      announcement: readPublicAnnouncement(header["announcement"], mode),
    },
    footer: {
      note: textOf(footer["note"], FOOTER_NOTE_MAX, true),
      showSocial: footer["showSocial"] !== false,
      menu: readResolvedMenu(footer["menu"]),
      policies: POLICY_TYPES.filter((type) => Array.isArray(policies) && policies.includes(type)),
    },
    locked: o["locked"] === true,
  };
}

/** Like `parseShell`, but an unusable body is the (frozen) fallback. */
export function sanitizeShell(raw: unknown, mode: "live" | "preview"): StorefrontShell {
  return parseShell(raw, mode) ?? FALLBACK_SHELL;
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
 * failed read AND an unusable body (empty, garbage, or the wrong mode) throw inside the cached
 * function, so neither is ever cached: the fallback means "we do not know" and is never stored.
 */
function cachedLiveShell(shopId: string): Promise<StorefrontShell> {
  return unstable_cache(
    async () => {
      const res = await fetchShell(shopId, null);
      if (res.status !== 200) throw new Error(`storefront shell read failed (${res.status})`);
      const shell = parseShell(res.body, "live");
      if (shell === null) throw new Error("storefront shell read returned no usable body");
      return shell;
    },
    ["online-store", shopId, "shell"],
    { tags: [shellTag(shopId)], revalidate: STOREFRONT_CACHE_TTL_SECONDS },
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
    if (res.status === 200) {
      // Only a body that says it is a preview is one; anything else is treated like a failed read.
      const preview = parseShell(res.body, "preview");
      return preview ?? live();
    }
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
    const version = body["accessVersion"];
    if (
      typeof body["locked"] !== "boolean" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 0
    ) {
      return null;
    }
    return {
      locked: body["locked"],
      accessVersion: version,
      message: textOf(body["message"], VISITOR_MESSAGE_MAX, true),
    };
  } catch {
    return null;
  }
}
