/**
 * Advertising click identifiers (doc 17 §2.2).
 *
 * Captured on any landing that carries one, persisted against the visitor/journey, and replayed at
 * conversion time for the owning platform's conversions API — so a click survives cookie loss.
 * The set is a registry, not a union baked into call sites: a new advertising platform is a new
 * entry here plus a destination mapping, never a change to any business module (ADR-0032 §6).
 */

/** How a click identifier reaches us and how long it stays useful. */
export interface ClickIdDefinition {
  /** Canonical parameter name as it appears on the landing URL, e.g. `gclid`. */
  readonly param: string;
  /** Owning advertising platform, for diagnostics and destination routing. */
  readonly platform: ClickIdPlatform;
  /**
   * Days the identifier remains valid for conversion forwarding. Mirrors each vendor's documented
   * attribution window; capture time is stored alongside so expiry is computable at conversion.
   */
  readonly ttlDays: number;
  /** Human-readable purpose, surfaced in the admin Attribution Builder. */
  readonly description: string;
}

export type ClickIdPlatform =
  "meta" | "google" | "tiktok" | "microsoft" | "snapchat" | "x" | "linkedin" | "pinterest";

/**
 * The canonical click-identifier registry. Extend by adding an entry — every consumer reads the
 * registry rather than hard-coding parameter names.
 */
export const CLICK_ID_DEFINITIONS = {
  fbclid: {
    param: "fbclid",
    platform: "meta",
    ttlDays: 90,
    description: "Meta click id; the source for the derived `fbc` browser cookie.",
  },
  gclid: {
    param: "gclid",
    platform: "google",
    ttlDays: 90,
    description: "Google Ads click id (standard web-to-web click).",
  },
  gbraid: {
    param: "gbraid",
    platform: "google",
    ttlDays: 90,
    description: "Google Ads app-to-web click id (iOS, no user identifier).",
  },
  wbraid: {
    param: "wbraid",
    platform: "google",
    ttlDays: 90,
    description: "Google Ads web-to-app click id (iOS privacy-preserving).",
  },
  ttclid: {
    param: "ttclid",
    platform: "tiktok",
    ttlDays: 90,
    description: "TikTok click id for the Events API.",
  },
  msclkid: {
    param: "msclkid",
    platform: "microsoft",
    ttlDays: 90,
    description: "Microsoft Advertising click id.",
  },
  scclid: {
    param: "scclid",
    platform: "snapchat",
    ttlDays: 28,
    description: "Snapchat click id for Snap Conversions API.",
  },
  twclid: {
    param: "twclid",
    platform: "x",
    ttlDays: 30,
    description: "X (Twitter) click id for the X Conversion API.",
  },
  li_fat_id: {
    param: "li_fat_id",
    platform: "linkedin",
    ttlDays: 90,
    description: "LinkedIn first-party ad tracking id for the Conversions API.",
  },
  epik: {
    param: "epik",
    platform: "pinterest",
    ttlDays: 90,
    description: "Pinterest click id for the Pinterest Conversions API.",
  },
} as const satisfies Record<string, ClickIdDefinition>;

/** Every registered click-identifier parameter name. */
export type ClickIdName = keyof typeof CLICK_ID_DEFINITIONS;

export const CLICK_ID_NAMES = Object.keys(CLICK_ID_DEFINITIONS) as readonly ClickIdName[];

export function isClickIdName(value: string): value is ClickIdName {
  return Object.prototype.hasOwnProperty.call(CLICK_ID_DEFINITIONS, value);
}

/**
 * A captured click identifier. The resolved source/medium/campaign are frozen **at capture time**
 * so attribution stays correct even if the campaign is later renamed or the cookie is lost.
 */
export interface CapturedClickId {
  readonly name: ClickIdName;
  readonly value: string;
  /** ISO-8601 UTC capture instant; combined with `ttlDays` to decide conversion-time validity. */
  readonly capturedAt: string;
  readonly source?: string;
  readonly medium?: string;
  readonly campaign?: string;
}

/**
 * Meta derives two first-party cookies from a click; they are carried separately from the raw
 * `fbclid` because Meta's CAPI expects the cookie form for advanced matching.
 */
export interface MetaBrowserIds {
  /** `_fbp` — the Meta browser id cookie. */
  readonly fbp?: string;
  /** `_fbc` — the Meta click cookie, derived from `fbclid` at landing. */
  readonly fbc?: string;
}

/** True when a captured click id is still inside its platform's attribution window. */
export function isClickIdValidAt(captured: CapturedClickId, at: Date): boolean {
  const capturedAt = Date.parse(captured.capturedAt);
  if (Number.isNaN(capturedAt)) return false;

  const ttlMs = CLICK_ID_DEFINITIONS[captured.name].ttlDays * 24 * 60 * 60 * 1000;
  const age = at.getTime() - capturedAt;
  return age >= 0 && age <= ttlMs;
}

/**
 * Reads a single query parameter. Passing a lookup rather than a `URLSearchParams` keeps this
 * schema layer free of runtime globals, so the same code runs in a browser bundle, a Node server
 * and an edge worker. Adapters supply `(p) => url.searchParams.get(p)`.
 */
export type QueryLookup = (param: string) => string | null | undefined;

/**
 * Extracts every registered click identifier present in a landing URL's query parameters.
 * Unknown parameters are ignored — capture is registry-driven, never opportunistic.
 */
export function extractClickIds(
  lookup: QueryLookup,
  capturedAt: string,
  resolved: { source?: string; medium?: string; campaign?: string } = {},
): readonly CapturedClickId[] {
  const captured: CapturedClickId[] = [];

  for (const name of CLICK_ID_NAMES) {
    const value = lookup(CLICK_ID_DEFINITIONS[name].param);
    if (value === null || value === undefined || value.trim() === "") continue;

    captured.push({
      name,
      value: value.trim(),
      capturedAt,
      ...(resolved.source === undefined ? {} : { source: resolved.source }),
      ...(resolved.medium === undefined ? {} : { medium: resolved.medium }),
      ...(resolved.campaign === undefined ? {} : { campaign: resolved.campaign }),
    });
  }

  return captured;
}
