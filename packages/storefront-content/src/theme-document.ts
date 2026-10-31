import { colors as designColors } from "@platform/design";
import { normalizeHex, type HexColor } from "./color";
import { isFontKey, type FontKey } from "./fonts";
import { normalizeLocalizedText, type ContentIssue, type LocalizedText } from "./locale";

export const SOCIAL_NETWORKS = [
  "facebook",
  "instagram",
  "tiktok",
  "x",
  "youtube",
  "snapchat",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export const BASE_SIZES = ["small", "medium", "large"] as const;
export type BaseSize = (typeof BASE_SIZES)[number];
export const CORNER_STYLES = ["square", "rounded", "pill"] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];
export const COLOR_KEYS = [
  "background",
  "foreground",
  "primary",
  "primaryForeground",
  "accent",
  "accentForeground",
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type BrandColors = { readonly [K in ColorKey]: HexColor };

export const LOGO_WIDTH = { min: 60, max: 320, default: 140 } as const;
export const FOOTER_NOTE_MAX = 200;
export const SOCIAL_URL_MAX = 500;
export const MAX_DOCUMENT_BYTES = 256 * 1024;
const IMAGE_REF = /^[A-Za-z0-9-]{1,64}$/;

export interface ThemeBrand {
  readonly logo: { readonly imageRef: string | null; readonly widthPx: number };
  readonly favicon: { readonly imageRef: string | null };
  readonly colors: BrandColors;
  readonly typography: {
    readonly headingFont: FontKey;
    readonly bodyFont: FontKey;
    readonly baseSize: BaseSize;
  };
  readonly corners: CornerStyle;
  readonly social: Readonly<Partial<Record<SocialNetwork, string>>>;
}

export interface ThemeDocument {
  readonly schemaVersion: 1;
  readonly brand: ThemeBrand;
  /** Part 2 adds `menuHandle`; Part 3 adds `announcement`. */
  readonly header: { readonly sticky: boolean };
  /** Part 2 adds `menuHandle` and `showPolicyLinks`. */
  readonly footer: { readonly note: LocalizedText; readonly showSocial: boolean };
  /** Part 3 types the sections; Part 1 accepts only `[]` on write and never renders them. */
  readonly homepage: { readonly sections: readonly unknown[] };
}

export type BrandStyle = Pick<ThemeBrand, "colors" | "typography" | "corners">;
export type ValidationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ContentIssue[] };

const light = designColors.light;
const hex = (value: string): HexColor => {
  const parsed = normalizeHex(value);
  if (parsed === null) throw new Error(`design palette value is not 6-digit hex: ${value}`);
  return parsed;
};

/** The current light palette, Plex for both fonts, medium, rounded, no logo: today's storefront. */
export const DEFAULT_THEME_DOCUMENT: ThemeDocument = Object.freeze({
  schemaVersion: 1,
  brand: {
    logo: { imageRef: null, widthPx: LOGO_WIDTH.default },
    favicon: { imageRef: null },
    colors: {
      background: hex(light.background),
      foreground: hex(light.foreground),
      primary: hex(light.primary),
      primaryForeground: hex(light.primaryForeground),
      accent: hex(light.accent),
      accentForeground: hex(light.accentForeground),
    },
    typography: {
      headingFont: "ibm-plex-sans-arabic",
      bodyFont: "ibm-plex-sans-arabic",
      baseSize: "medium",
    },
    corners: "rounded",
    social: {},
  },
  header: { sticky: false },
  footer: { note: {}, showSocial: true },
  homepage: { sections: [] },
}) as ThemeDocument;

type Raw = Record<string, unknown>;

/** Reads an object with exactly `keys`; reports unknown and missing keys. `null` when not an object. */
function objectAt(
  raw: unknown,
  path: string,
  keys: readonly string[],
  issues: ContentIssue[],
): Raw | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    issues.push({ path, code: "INVALID_VALUE" });
    return null;
  }
  const join = (key: string) => (path === "" ? key : `${path}.${key}`);
  for (const key of Object.keys(raw)) {
    if (!keys.includes(key)) issues.push({ path: join(key), code: "UNKNOWN_KEY" });
  }
  for (const key of keys) {
    if (!(key in raw)) issues.push({ path: join(key), code: "MISSING" });
  }
  return raw as Raw;
}

function enumAt<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: ContentIssue[],
): T | null {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value))
    return value as T;
  if (value !== undefined) issues.push({ path, code: "INVALID_VALUE" });
  return null;
}

function booleanAt(value: unknown, path: string, issues: ContentIssue[]): boolean {
  if (typeof value === "boolean") return value;
  if (value !== undefined) issues.push({ path, code: "INVALID_VALUE" });
  return false;
}

function imageRefAt(value: unknown, path: string, issues: ContentIssue[]): string | null {
  if (value === null) return null;
  if (typeof value === "string" && IMAGE_REF.test(value)) return value;
  if (value !== undefined) issues.push({ path, code: "INVALID_VALUE" });
  return null;
}

function socialUrlAt(value: unknown, path: string, issues: ContentIssue[]): string | null {
  if (typeof value !== "string") {
    issues.push({ path, code: "INVALID_VALUE" });
    return null;
  }
  if (value.length > SOCIAL_URL_MAX) {
    issues.push({ path, code: "TOO_LONG" });
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push({ path, code: "INVALID_URL" });
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    issues.push({ path, code: "INVALID_URL" });
    return null;
  }
  return value;
}

function section<T>(read: (issues: ContentIssue[]) => T, issues: ContentIssue[]): T | null {
  const before = issues.length;
  const value = read(issues);
  return issues.length === before ? value : null;
}

function readColors(raw: unknown, path: string, issues: ContentIssue[]): BrandColors | null {
  return section((found) => {
    const obj = objectAt(raw, path, COLOR_KEYS, found);
    if (obj === null) return null;
    const result: Partial<Record<ColorKey, HexColor>> = {};
    for (const key of COLOR_KEYS) {
      if (!(key in obj)) continue;
      const parsed = normalizeHex(obj[key]);
      if (parsed === null) found.push({ path: `${path}.${key}`, code: "INVALID_COLOR" });
      else result[key] = parsed;
    }
    return result as BrandColors;
  }, issues);
}

function readTypography(
  raw: unknown,
  path: string,
  issues: ContentIssue[],
): ThemeBrand["typography"] | null {
  return section((found) => {
    const obj = objectAt(raw, path, ["headingFont", "bodyFont", "baseSize"], found);
    if (obj === null) return null;
    const font = (key: string): FontKey | null => {
      const value = obj[key];
      if (isFontKey(value)) return value;
      if (value !== undefined) found.push({ path: `${path}.${key}`, code: "INVALID_VALUE" });
      return null;
    };
    const headingFont = font("headingFont");
    const bodyFont = font("bodyFont");
    const baseSize = enumAt(obj["baseSize"], BASE_SIZES, `${path}.baseSize`, found);
    return {
      headingFont: headingFont ?? "ibm-plex-sans-arabic",
      bodyFont: bodyFont ?? "ibm-plex-sans-arabic",
      baseSize: baseSize ?? "medium",
    };
  }, issues);
}

/** A missing `corners` is reported once, by the enclosing `objectAt` (MISSING); callers default it. */
function readCorners(raw: unknown, path: string, issues: ContentIssue[]): CornerStyle | null {
  return enumAt(raw, CORNER_STYLES, path, issues);
}

function readSocialAt(
  raw: unknown,
  path: string,
  issues: ContentIssue[],
): ThemeBrand["social"] | null {
  return section((found) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      found.push({ path, code: "INVALID_VALUE" });
      return null;
    }
    const result: Partial<Record<SocialNetwork, string>> = {};
    for (const [key, value] of Object.entries(raw as Raw)) {
      if (!(SOCIAL_NETWORKS as readonly string[]).includes(key)) {
        found.push({ path: `${path}.${key}`, code: "UNKNOWN_KEY" });
        continue;
      }
      const url = socialUrlAt(value, `${path}.${key}`, found);
      if (url !== null) result[key as SocialNetwork] = url;
    }
    return result;
  }, issues);
}

function readBrandAt(raw: unknown, path: string, issues: ContentIssue[]): ThemeBrand | null {
  return section((found) => {
    const obj = objectAt(
      raw,
      path,
      ["logo", "favicon", "colors", "typography", "corners", "social"],
      found,
    );
    if (obj === null) return null;
    let logo: ThemeBrand["logo"] = DEFAULT_THEME_DOCUMENT.brand.logo;
    const logoRaw = objectAt(obj["logo"], `${path}.logo`, ["imageRef", "widthPx"], found);
    if (logoRaw !== null) {
      const width = logoRaw["widthPx"];
      const widthOk =
        typeof width === "number" &&
        Number.isInteger(width) &&
        width >= LOGO_WIDTH.min &&
        width <= LOGO_WIDTH.max;
      if (!widthOk && width !== undefined)
        found.push({ path: `${path}.logo.widthPx`, code: "OUT_OF_RANGE" });
      logo = {
        imageRef: imageRefAt(logoRaw["imageRef"], `${path}.logo.imageRef`, found),
        widthPx: widthOk ? width : LOGO_WIDTH.default,
      };
    }
    const faviconRaw = objectAt(obj["favicon"], `${path}.favicon`, ["imageRef"], found);
    const favicon = {
      imageRef:
        faviconRaw === null
          ? null
          : imageRefAt(faviconRaw["imageRef"], `${path}.favicon.imageRef`, found),
    };
    const colors = readColors(obj["colors"], `${path}.colors`, found);
    const typography = readTypography(obj["typography"], `${path}.typography`, found);
    const corners = readCorners(obj["corners"], `${path}.corners`, found);
    const social = readSocialAt(obj["social"], `${path}.social`, found);
    return {
      logo,
      favicon,
      colors: colors ?? DEFAULT_THEME_DOCUMENT.brand.colors,
      typography: typography ?? DEFAULT_THEME_DOCUMENT.brand.typography,
      corners: corners ?? DEFAULT_THEME_DOCUMENT.brand.corners,
      social: social ?? {},
    };
  }, issues);
}

function readHeaderAt(raw: unknown, issues: ContentIssue[]): ThemeDocument["header"] | null {
  return section((found) => {
    const obj = objectAt(raw, "header", ["sticky"], found);
    return obj === null ? null : { sticky: booleanAt(obj["sticky"], "header.sticky", found) };
  }, issues);
}

function readFooterAt(raw: unknown, issues: ContentIssue[]): ThemeDocument["footer"] | null {
  return section((found) => {
    const obj = objectAt(raw, "footer", ["note", "showSocial"], found);
    if (obj === null) return null;
    const note =
      obj["note"] === undefined
        ? {}
        : normalizeLocalizedText(
            obj["note"],
            { path: "footer.note", max: FOOTER_NOTE_MAX, multiline: true },
            found,
          );
    return { note, showSocial: booleanAt(obj["showSocial"], "footer.showSocial", found) };
  }, issues);
}

function byteLength(raw: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(raw) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** The write-path validator (API, editor): strict, every issue reported with a path and a code. */
export function validateThemeDocument(raw: unknown): ValidationOutcome<ThemeDocument> {
  if (byteLength(raw) > MAX_DOCUMENT_BYTES)
    return { ok: false, issues: [{ path: "", code: "DOCUMENT_TOO_LARGE" }] };
  const issues: ContentIssue[] = [];
  const obj = objectAt(raw, "", ["schemaVersion", "brand", "header", "footer", "homepage"], issues);
  if (obj === null) return { ok: false, issues };
  if (obj["schemaVersion"] !== 1 && "schemaVersion" in obj)
    issues.push({ path: "schemaVersion", code: "UNSUPPORTED_SCHEMA_VERSION" });
  const brand = readBrandAt(obj["brand"], "brand", issues);
  const header = readHeaderAt(obj["header"], issues);
  const footer = readFooterAt(obj["footer"], issues);
  const homepage = objectAt(obj["homepage"], "homepage", ["sections"], issues);
  if (homepage !== null) {
    const sections = homepage["sections"];
    if (!Array.isArray(sections)) issues.push({ path: "homepage.sections", code: "INVALID_VALUE" });
    else if (sections.length > 0)
      issues.push({ path: "homepage.sections", code: "SECTIONS_NOT_SUPPORTED" });
  }
  // Issues are reported in document order: top-level unknown keys first (objectAt above), then fields.
  issues.sort((a, b) => order(a.path) - order(b.path));
  if (issues.length > 0 || brand === null || header === null || footer === null)
    return { ok: false, issues };
  return {
    ok: true,
    value: { schemaVersion: 1, brand, header, footer, homepage: { sections: [] } },
  };
}

const TOP_ORDER = ["", "schemaVersion", "brand", "header", "footer", "homepage"];
function order(path: string): number {
  const top = path.split(".")[0] ?? "";
  const index = TOP_ORDER.indexOf(top);
  return index === -1 ? -1 : index;
}

/** The read-path reader (storefront, admin reads, upcasting): never throws, falls back per section. */
export function readThemeDocument(raw: unknown): ThemeDocument {
  const ignored: ContentIssue[] = [];
  const obj = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Raw) : {};
  const homepage = obj["homepage"];
  const sections =
    typeof homepage === "object" &&
    homepage !== null &&
    Array.isArray((homepage as Raw)["sections"])
      ? ((homepage as Raw)["sections"] as unknown[])
      : [];
  return {
    schemaVersion: 1,
    brand: readBrandAt(obj["brand"], "brand", ignored) ?? readPartialBrand(obj["brand"]),
    header: readHeaderAt(obj["header"], ignored) ?? DEFAULT_THEME_DOCUMENT.header,
    footer: readFooterAt(obj["footer"], ignored) ?? DEFAULT_THEME_DOCUMENT.footer,
    homepage: { sections },
  };
}

/** A brand that failed validation as a whole: the default brand (a broken palette never half-applies). */
function readPartialBrand(_raw: unknown): ThemeBrand {
  return DEFAULT_THEME_DOCUMENT.brand;
}

/** For the storefront's defence in depth: each group falls back to its default independently. */
export function readBrandStyle(raw: unknown): BrandStyle {
  const obj = typeof raw === "object" && raw !== null ? (raw as Raw) : {};
  const ignored: ContentIssue[] = [];
  return {
    colors: readColors(obj["colors"], "colors", ignored) ?? DEFAULT_THEME_DOCUMENT.brand.colors,
    typography:
      readTypography(obj["typography"], "typography", ignored) ??
      DEFAULT_THEME_DOCUMENT.brand.typography,
    corners:
      readCorners(obj["corners"], "corners", ignored) ?? DEFAULT_THEME_DOCUMENT.brand.corners,
  };
}

export function readSocial(raw: unknown): ThemeBrand["social"] {
  const result: Partial<Record<SocialNetwork, string>> = {};
  if (typeof raw !== "object" || raw === null) return result;
  for (const network of SOCIAL_NETWORKS) {
    const url = socialUrlAt((raw as Raw)[network], network, []);
    if (url !== null && (raw as Raw)[network] !== undefined) result[network] = url;
  }
  return result;
}

export function imageRefsOf(doc: ThemeDocument): string[] {
  return [doc.brand.logo.imageRef, doc.brand.favicon.imageRef].filter(
    (id): id is string => id !== null,
  );
}

/** Stable JSON for equality: the reader rebuilds keys in one order whatever the storage did. */
export function canonicalDocumentJson(raw: unknown): string {
  return JSON.stringify(readThemeDocument(raw));
}
