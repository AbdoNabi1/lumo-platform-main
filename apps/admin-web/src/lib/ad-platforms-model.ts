/**
 * Lead site D1 - the vocabulary of Settings > Ad platforms, shared by the server action and the
 * client cards. Pure data: it never imports the API client, so a "use client" component may take
 * values from it (see `lib/client-boundary.test.ts`). Browser-safe copies of the committed backend's
 * shapes (`services/ad-platforms/src/domain/connection.ts`, `application/connections.use-cases.ts`);
 * admin-web never imports backend code.
 */

export const AD_PLATFORM_ORDER = ["meta", "tiktok", "snap", "ga4", "google_ads"] as const;
export type AdPlatformKey = (typeof AD_PLATFORM_ORDER)[number];

export function isAdPlatformKey(value: unknown): value is AdPlatformKey {
  return typeof value === "string" && (AD_PLATFORM_ORDER as readonly string[]).includes(value);
}

/** The public ids a platform saves; the API drops nothing and invents nothing. */
export type PublicConfigDto =
  | { readonly platform: "meta"; readonly pixelId: string }
  | { readonly platform: "tiktok"; readonly pixelCode: string }
  | { readonly platform: "snap"; readonly pixelId: string }
  | { readonly platform: "ga4"; readonly measurementId: string }
  | {
      readonly platform: "google_ads";
      readonly conversionId: string;
      readonly labels: {
        readonly lead?: string;
        readonly contact?: string;
        readonly purchase?: string;
      };
    };

/** `GET /ad-platforms` items and what a save answers with. Never a token: only whether one is saved. */
export interface ConnectionViewDto {
  readonly platform: AdPlatformKey;
  readonly enabled: boolean;
  readonly publicConfig: PublicConfigDto | null;
  readonly secret: { readonly configured: boolean; readonly last4: string | null };
  readonly testEventCode: string | null;
  /** Public ids (and, for the server platforms, a token) are all there. */
  readonly complete: boolean;
  /** Enabled and complete: events are being delivered. */
  readonly live: boolean;
  /** The version a save must send back; 0 while the shop has no row for this platform yet. */
  readonly version: number;
}

/** A save's outcome. The token is never in it. */
export type AdPlatformFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly view: ConnectionViewDto }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors?: Readonly<Record<string, string>>;
      readonly conflict?: boolean;
    };

/** The inputs a card can post (their `name`s), each one id the merchant copies from the vendor. */
export const ID_INPUT_NAMES = [
  "pixelId",
  "pixelCode",
  "measurementId",
  "conversionId",
  "labelLead",
  "labelContact",
  "labelPurchase",
] as const;
export type IdInputName = (typeof ID_INPUT_NAMES)[number];

export interface IdInputSpec {
  readonly name: IdInputName;
  readonly inputMode: "numeric" | "text";
  /** A shape example, not a real id. Brand formats are not translated. */
  readonly placeholder: string;
}

export interface AdPlatformSpec {
  readonly key: AdPlatformKey;
  /** Vendor names are brand names: never translated, always shown inside `<bdi dir="auto">`. */
  readonly label: string;
  readonly idInputs: readonly IdInputSpec[];
  /** Meta, TikTok, Snapchat and GA4 deliver from the server with a token; Google Ads does not (yet). */
  readonly serverToken: boolean;
  /** Only Meta and TikTok have a test-events tool. */
  readonly testEventCode: boolean;
}

export const AD_PLATFORM_SPECS: Readonly<Record<AdPlatformKey, AdPlatformSpec>> = {
  meta: {
    key: "meta",
    label: "Meta",
    idInputs: [{ name: "pixelId", inputMode: "numeric", placeholder: "123456789012345" }],
    serverToken: true,
    testEventCode: true,
  },
  tiktok: {
    key: "tiktok",
    label: "TikTok",
    idInputs: [{ name: "pixelCode", inputMode: "text", placeholder: "C1A2B3C4D5E6F7G8H9" }],
    serverToken: true,
    testEventCode: true,
  },
  snap: {
    key: "snap",
    label: "Snapchat",
    idInputs: [
      {
        name: "pixelId",
        inputMode: "text",
        placeholder: "12345678-1234-1234-1234-123456789012",
      },
    ],
    serverToken: true,
    testEventCode: false,
  },
  ga4: {
    key: "ga4",
    label: "Google Analytics 4",
    idInputs: [{ name: "measurementId", inputMode: "text", placeholder: "G-ABCDE12345" }],
    serverToken: true,
    testEventCode: false,
  },
  google_ads: {
    key: "google_ads",
    label: "Google Ads",
    idInputs: [
      { name: "conversionId", inputMode: "text", placeholder: "AW-123456789" },
      { name: "labelLead", inputMode: "text", placeholder: "AbC-D_efG-h12" },
      { name: "labelContact", inputMode: "text", placeholder: "AbC-D_efG-h12" },
      { name: "labelPurchase", inputMode: "text", placeholder: "AbC-D_efG-h12" },
    ],
    serverToken: false,
    testEventCode: false,
  },
};

/** The text of every id input as the card shows it ("" for an id the connection does not have). */
export function idValuesOf(view: ConnectionViewDto): Readonly<Record<string, string>> {
  const config = view.publicConfig;
  if (config === null) return {};
  switch (config.platform) {
    case "meta":
    case "snap":
      return { pixelId: config.pixelId };
    case "tiktok":
      return { pixelCode: config.pixelCode };
    case "ga4":
      return { measurementId: config.measurementId };
    case "google_ads":
      return {
        conversionId: config.conversionId,
        labelLead: config.labels.lead ?? "",
        labelContact: config.labels.contact ?? "",
        labelPurchase: config.labels.purchase ?? "",
      };
  }
}

/**
 * The `publicConfig` the API takes for a platform, from what was typed: `null` when every id box is
 * empty (a connection with no ids), otherwise only the boxes that have text. The platform itself is
 * the path's, never sent here. Shape rules (ids, characters) are the API's and answer 422.
 */
export function publicConfigFrom(
  platform: AdPlatformKey,
  values: Readonly<Record<string, string>>,
): Record<string, unknown> | null {
  const text = (name: IdInputName): string => (values[name] ?? "").trim();
  switch (platform) {
    case "meta":
    case "snap":
      return text("pixelId") === "" ? null : { pixelId: text("pixelId") };
    case "tiktok":
      return text("pixelCode") === "" ? null : { pixelCode: text("pixelCode") };
    case "ga4":
      return text("measurementId") === "" ? null : { measurementId: text("measurementId") };
    case "google_ads": {
      const labels: Record<string, string> = {};
      if (text("labelLead") !== "") labels["lead"] = text("labelLead");
      if (text("labelContact") !== "") labels["contact"] = text("labelContact");
      if (text("labelPurchase") !== "") labels["purchase"] = text("labelPurchase");
      if (text("conversionId") === "" && Object.keys(labels).length === 0) return null;
      return { conversionId: text("conversionId"), labels };
    }
  }
}

/** Whether two saved public configs hold the same ids (so the storefront has nothing new to show). */
export function samePublicConfig(a: PublicConfigDto | null, b: PublicConfigDto | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, sortKeys(child)]),
  );
}

const LABEL_INPUTS: Readonly<Record<string, IdInputName>> = {
  lead: "labelLead",
  contact: "labelContact",
  purchase: "labelPurchase",
};

/**
 * The input a 422 issue belongs to: `publicConfig.pixelId` is the `pixelId` box, `publicConfig.labels.lead`
 * the `labelLead` box. A config-level issue (`publicConfig`, `publicConfig.platform`) lands on the
 * platform's first id box; `secret` and `testEventCode` keep their names. Anything else is not tied to a box.
 */
export function inputNameForIssue(platform: AdPlatformKey, field: string): string | null {
  if (field === "secret" || field === "testEventCode" || field === "clearSecret") return field;
  if (field === "publicConfig" || field === "publicConfig.platform") {
    return AD_PLATFORM_SPECS[platform].idInputs[0]?.name ?? null;
  }
  if (field.startsWith("publicConfig.labels.")) {
    return LABEL_INPUTS[field.slice("publicConfig.labels.".length)] ?? null;
  }
  if (field === "publicConfig.labels") return "labelLead";
  if (field.startsWith("publicConfig.")) {
    const name = field.slice("publicConfig.".length);
    return (ID_INPUT_NAMES as readonly string[]).includes(name) ? name : null;
  }
  return null;
}

/** The three states a card shows (Live: delivering; Incomplete: switched on but missing something; Off). */
export type AdPlatformStatus = "live" | "incomplete" | "off";

export function statusOf(view: ConnectionViewDto): AdPlatformStatus {
  if (view.live) return "live";
  if (view.enabled && !view.complete) return "incomplete";
  return "off";
}

/** The last four characters of a saved token, as the placeholder shows them. */
export function maskedToken(last4: string | null): string {
  return `\u2022\u2022\u2022\u2022${last4 ?? ""}`;
}
