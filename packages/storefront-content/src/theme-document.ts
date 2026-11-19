import { colors as designColors } from "@platform/design";
import { normalizeHex, type HexColor } from "./color";
import { isFontKey, type FontKey } from "./fonts";
import { MAX_ISSUES, pathSegment } from "./issues";
import { normalizeLocalizedText, type ContentIssue, type LocalizedText } from "./locale";
import { URL_CONTROLS, URL_INVISIBLES } from "./links";
import { IMAGE_REF_PATTERN } from "./limits";
import { isMenuHandle } from "./menus";
import {
  DEFAULT_HOMEPAGE_SECTIONS,
  HOMEPAGE_SECTIONS_MAX,
  readSection,
  sectionDefinition,
  sectionRefsOf,
  validateSection,
  type AnnouncementSection,
  type Section,
} from "./sections";
import { collectFieldRefs, emptySectionRefs, type SectionRefs } from "./section-fields";
import type { ValidationOutcome } from "./validation";

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
export const THEME_SCHEMA_VERSION = 2;
const HTTPS_PREFIX = /^https:\/\//i;

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
  readonly schemaVersion: 2;
  readonly brand: ThemeBrand;
  readonly header: {
    readonly sticky: boolean;
    readonly menuHandle: string;
    readonly announcement: AnnouncementSection | null;
  };
  readonly footer: {
    readonly note: LocalizedText;
    readonly showSocial: boolean;
    readonly menuHandle: string;
    readonly showPolicyLinks: boolean;
  };
  /** Version 1 documents read as the default sections; version 2 stores them literally. */
  readonly homepage: { readonly sections: readonly Section[] };
}

export type BrandStyle = Pick<ThemeBrand, "colors" | "typography" | "corners">;
export type { ValidationOutcome };

const light = designColors.light;
const hex = (value: string): HexColor => {
  const parsed = normalizeHex(value);
  if (parsed === null) throw new Error(`design palette value is not 6-digit hex: ${value}`);
  return parsed;
};

/** Freezes `value` and everything reachable from it: the default is shared by every shop. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** The current light palette, Plex for both fonts, medium, rounded, no logo: today's storefront. */
export const DEFAULT_THEME_DOCUMENT: ThemeDocument = deepFreeze({
  schemaVersion: 2,
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
  header: { sticky: false, menuHandle: "main-menu", announcement: null },
  footer: { note: {}, showSocial: true, menuHandle: "footer", showPolicyLinks: true },
  homepage: { sections: DEFAULT_HOMEPAGE_SECTIONS },
});

type Raw = Record<string, unknown>;

/**
 * Reads an object with exactly `keys`; reports unknown and missing keys. `null` when not an object.
 * A key whose value is `undefined` counts as missing, unless it is in `optional`
 * (Part 2 fields). A nested object that is absent was already
 * reported MISSING by its parent, so it returns `null` without a second issue.
 */
function objectAt(
  raw: unknown,
  path: string,
  keys: readonly string[],
  issues: ContentIssue[],
  optional: readonly string[] = [],
): Raw | null {
  if (raw === undefined && path !== "") return null;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    issues.push({ path, code: "INVALID_VALUE" });
    return null;
  }
  const join = (key: string) => (path === "" ? key : `${path}.${key}`);
  let unknownKeys = 0;
  for (const key of Object.keys(raw)) {
    if (keys.includes(key)) continue;
    if (unknownKeys < MAX_ISSUES)
      issues.push({ path: join(pathSegment(key)), code: "UNKNOWN_KEY" });
    unknownKeys += 1;
  }
  for (const key of keys) {
    if (optional.includes(key)) continue;
    if ((raw as Raw)[key] === undefined) issues.push({ path: join(key), code: "MISSING" });
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

/** An optional menu handle: absent is the default, present must be a well-formed handle. */
function menuHandleAt(
  value: unknown,
  path: string,
  fallback: string,
  issues: ContentIssue[],
): string {
  if (value === undefined) return fallback;
  if (isMenuHandle(value)) return value;
  issues.push({ path, code: "INVALID_VALUE" });
  return fallback;
}

/** An absent or malformed `showPolicyLinks` is on (the default); a malformed one is reported. */
function policyLinksFallback(value: unknown, issues: ContentIssue[]): boolean {
  if (value !== undefined) issues.push({ path: "footer.showPolicyLinks", code: "INVALID_VALUE" });
  return true;
}

function imageRefAt(value: unknown, path: string, issues: ContentIssue[]): string | null {
  if (value === null) return null;
  if (typeof value === "string" && IMAGE_REF_PATTERN.test(value)) return value;
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
  // The URL parser silently drops whitespace, tabs and newlines and percent-encodes controls, so the
  // raw string must be clean itself: it is what a merchant sees, not what a browser would resolve.
  // The scheme must be written with its two slashes ("https:evil.example" is a relative reference).
  if (URL_CONTROLS.test(value) || URL_INVISIBLES.test(value) || !HTTPS_PREFIX.test(value)) {
    issues.push({ path, code: "INVALID_URL" });
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
  // The normalised form is what is stored (lower-case host, encoded path), never the raw input.
  if (url.href.length > SOCIAL_URL_MAX) {
    issues.push({ path, code: "TOO_LONG" });
    return null;
  }
  return url.href;
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
      if (obj[key] === undefined) continue; // reported MISSING by objectAt
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
    if (raw === undefined) return null; // reported MISSING by the parent
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      found.push({ path, code: "INVALID_VALUE" });
      return null;
    }
    let unknownKeys = 0;
    for (const key of Object.keys(raw)) {
      if ((SOCIAL_NETWORKS as readonly string[]).includes(key)) continue;
      if (unknownKeys < MAX_ISSUES)
        found.push({ path: `${path}.${pathSegment(key)}`, code: "UNKNOWN_KEY" });
      unknownKeys += 1;
    }
    // Written in network order, whatever order the input (or JSONB) had, so equal links serialise equally.
    const result: Partial<Record<SocialNetwork, string>> = {};
    for (const network of SOCIAL_NETWORKS) {
      const value = (raw as Raw)[network];
      if (!Object.hasOwn(raw, network)) continue;
      const url = socialUrlAt(value, `${path}.${network}`, found);
      if (url !== null) result[network] = url;
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

type HeaderBase = Pick<ThemeDocument["header"], "sticky" | "menuHandle">;

/**
 * `lenient` (the read path): a bad optional menu reference resets only that field, so the
 * rest of the section survives; the write path reports it. The announcement is parsed apart
 * (see `announcementWriteAt`), so a corrupt bar never resets `sticky` or `menuHandle`.
 * `announcement` is a known key in version 2 and on the read path; in a version 1 write it is unknown.
 */
function readHeaderAt(
  raw: unknown,
  issues: ContentIssue[],
  lenient = false,
  withAnnouncement = true,
): HeaderBase | null {
  return section((found) => {
    const optionalSink = lenient ? [] : found;
    const obj = objectAt(
      raw,
      "header",
      withAnnouncement ? ["sticky", "menuHandle", "announcement"] : ["sticky", "menuHandle"],
      found,
      ["menuHandle", "announcement"],
    );
    if (obj === null) return null;
    return {
      sticky: booleanAt(obj["sticky"], "header.sticky", found),
      menuHandle: menuHandleAt(obj["menuHandle"], "header.menuHandle", "main-menu", optionalSink),
    };
  }, issues);
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Write path: null or absent is no bar; anything else must be a valid announcement bar. */
function announcementWriteAt(raw: unknown, issues: ContentIssue[]): AnnouncementSection | null {
  if (!isRecord(raw) || !Object.hasOwn(raw, "announcement")) return null;
  const value = raw["announcement"];
  if (value === null || value === undefined) return null;
  const read = validateSection(value, "header.announcement", issues, "header");
  return read !== null && read.type === "announcement_bar" ? (read as AnnouncementSection) : null;
}

/** Read path: an announcement bar this build understands, else null. Never throws. */
function announcementReadAt(raw: unknown): AnnouncementSection | null {
  if (!isRecord(raw) || !Object.hasOwn(raw, "announcement")) return null;
  const read = readSection(raw["announcement"], "header");
  return read !== null && read.type === "announcement_bar" ? (read as AnnouncementSection) : null;
}

function readFooterAt(
  raw: unknown,
  issues: ContentIssue[],
  lenient = false,
): ThemeDocument["footer"] | null {
  return section((found) => {
    const optionalSink = lenient ? [] : found;
    const obj = objectAt(
      raw,
      "footer",
      ["note", "showSocial", "menuHandle", "showPolicyLinks"],
      found,
      ["menuHandle", "showPolicyLinks"],
    );
    if (obj === null) return null;
    const note =
      obj["note"] === undefined
        ? {}
        : normalizeLocalizedText(
            obj["note"],
            { path: "footer.note", max: FOOTER_NOTE_MAX, multiline: true },
            found,
          );
    return {
      note,
      showSocial: booleanAt(obj["showSocial"], "footer.showSocial", found),
      menuHandle: menuHandleAt(obj["menuHandle"], "footer.menuHandle", "footer", optionalSink),
      showPolicyLinks:
        typeof obj["showPolicyLinks"] === "boolean"
          ? obj["showPolicyLinks"]
          : policyLinksFallback(obj["showPolicyLinks"], optionalSink),
    };
  }, issues);
}

function byteLength(raw: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(raw) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Per-type caps (maxPerPage) in document order, and unique ids across the header and the page.
 * Counted from the raw entry when its type and id are well-formed, so these issues arrive in the
 * same round as a section's own.
 */
function checkPlacement(
  raws: readonly unknown[],
  announcement: AnnouncementSection | null,
  issues: ContentIssue[],
): void {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  if (announcement !== null) seen.add(announcement.id.toLowerCase());
  for (const [index, entry] of raws.entries()) {
    if (!isRecord(entry)) continue;
    const type = Object.hasOwn(entry, "type") ? entry["type"] : undefined;
    const entryId = Object.hasOwn(entry, "id") ? entry["id"] : undefined;
    const at = `homepage.sections.${index}`;
    if (typeof type === "string") {
      const max = sectionDefinition(type)?.maxPerPage ?? null;
      const count = (counts.get(type) ?? 0) + 1;
      counts.set(type, count);
      if (max !== null && count > max)
        issues.push({ path: `${at}.type`, code: "TOO_MANY_OF_TYPE" });
    }
    if (typeof entryId === "string") {
      const key = entryId.toLowerCase();
      if (seen.has(key)) issues.push({ path: `${at}.id`, code: "DUPLICATE_SECTION_ID" });
      seen.add(key);
    }
  }
}

/**
 * The write-path validator (API, editor): strict, every issue reported with a path and a code.
 * Version 1 (the Part 1 shape) is upcast to the default homepage; version 2 stores sections literally.
 */
export function validateThemeDocument(raw: unknown): ValidationOutcome<ThemeDocument> {
  if (byteLength(raw) > MAX_DOCUMENT_BYTES)
    return { ok: false, issues: [{ path: "", code: "DOCUMENT_TOO_LARGE" }] };
  const issues: ContentIssue[] = [];
  const obj = objectAt(raw, "", ["schemaVersion", "brand", "header", "footer", "homepage"], issues);
  if (obj === null) return { ok: false, issues };
  const version = obj["schemaVersion"];
  // An absent version is reported MISSING by objectAt and an unsupported one below; either way the
  // rest is checked as version 2, so a bad version adds no cascade of unknown-key issues.
  if (version !== undefined && version !== 1 && version !== 2)
    issues.push({ path: "schemaVersion", code: "UNSUPPORTED_SCHEMA_VERSION" });
  const isV1 = version === 1;
  const brand = readBrandAt(obj["brand"], "brand", issues);
  const headerBase = readHeaderAt(obj["header"], issues, false, !isV1);
  const announcement = isV1 ? null : announcementWriteAt(obj["header"], issues);
  const footer = readFooterAt(obj["footer"], issues);
  const homepage = objectAt(obj["homepage"], "homepage", ["sections"], issues);
  let sections: readonly Section[] | null = null;
  if (homepage !== null) {
    const raws = homepage["sections"];
    if (raws === undefined) {
      // reported MISSING by objectAt
    } else if (!Array.isArray(raws)) {
      issues.push({ path: "homepage.sections", code: "INVALID_VALUE" });
    } else if (isV1) {
      if (raws.length > 0)
        issues.push({ path: "homepage.sections", code: "SECTIONS_NOT_SUPPORTED" });
      else sections = readDefaultSections();
    } else if (raws.length > HOMEPAGE_SECTIONS_MAX) {
      issues.push({ path: "homepage.sections", code: "TOO_MANY_SECTIONS" });
    } else {
      const read = raws.map((entry, index) =>
        validateSection(entry, `homepage.sections.${index}`, issues, "homepage"),
      );
      checkPlacement(raws, announcement, issues);
      if (!read.includes(null)) sections = read as Section[];
    }
  }
  // Issues are reported in document order: top-level unknown keys first (objectAt above), then fields.
  issues.sort((a, b) => order(a.path) - order(b.path));
  if (
    issues.length > 0 ||
    brand === null ||
    headerBase === null ||
    footer === null ||
    sections === null
  )
    return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
  return {
    ok: true,
    value: {
      schemaVersion: THEME_SCHEMA_VERSION,
      brand,
      header: { sticky: headerBase.sticky, menuHandle: headerBase.menuHandle, announcement },
      footer,
      homepage: { sections },
    },
  };
}

/** The upcast of a version 1 document: the default sections, read like any stored section. */
function readDefaultSections(): Section[] {
  return DEFAULT_HOMEPAGE_SECTIONS.map((entry) => readSection(entry, "homepage")).filter(
    (entry): entry is Section => entry !== null,
  );
}

const TOP_ORDER = ["", "schemaVersion", "brand", "header", "footer", "homepage"];
function order(path: string): number {
  const top = path.split(".")[0] ?? "";
  const index = TOP_ORDER.indexOf(top);
  return index === -1 ? -1 : index;
}

/** Version 2 stores sections literally: skips what cannot be read, keeps the first of a repeated id. */
function readStoredSections(raw: unknown, announcementId: string | null): Section[] | null {
  if (!isRecord(raw) || !Object.hasOwn(raw, "sections")) return null;
  const list = raw["sections"];
  if (!Array.isArray(list)) return null;
  const kept: Section[] = [];
  const seen = new Set<string>(announcementId === null ? [] : [announcementId.toLowerCase()]);
  const counts = new Map<string, number>();
  for (const entry of list) {
    if (kept.length >= HOMEPAGE_SECTIONS_MAX) break;
    const read = readSection(entry, "homepage");
    if (read === null || seen.has(read.id.toLowerCase())) continue;
    // maxPerPage too, so what is read back is always saveable.
    const max = sectionDefinition(read.type)?.maxPerPage ?? null;
    const count = (counts.get(read.type) ?? 0) + 1;
    if (max !== null && count > max) continue;
    counts.set(read.type, count);
    seen.add(read.id.toLowerCase());
    kept.push(read);
  }
  return kept;
}

/** The read-path reader (storefront, admin reads, upcasting): never throws, falls back per section. */
export function readThemeDocument(raw: unknown): ThemeDocument {
  const ignored: ContentIssue[] = [];
  const obj = isRecord(raw) ? raw : {};
  const version = obj["schemaVersion"];
  const headerRaw = obj["header"];
  const announcement = announcementReadAt(headerRaw);
  const stored =
    typeof version === "number" && version >= THEME_SCHEMA_VERSION
      ? readStoredSections(obj["homepage"], announcement?.id ?? null)
      : null;
  const headerBase = readHeaderAt(headerRaw, ignored, true) ?? DEFAULT_THEME_DOCUMENT.header;
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    brand: readBrandAt(obj["brand"], "brand", ignored) ?? readPartialBrand(obj["brand"]),
    header: {
      sticky: headerBase.sticky,
      menuHandle: headerBase.menuHandle,
      announcement,
    },
    footer: readFooterAt(obj["footer"], ignored, true) ?? DEFAULT_THEME_DOCUMENT.footer,
    homepage: { sections: stored ?? readDefaultSections() },
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

/** The menu handles a document names, each once, the header's first. */
export function menuHandlesOf(doc: ThemeDocument): readonly string[] {
  return [...new Set([doc.header.menuHandle, doc.footer.menuHandle])];
}

/** Every reference a document makes, each with its dotted path (brand, header bar, sections). */
export function documentRefsOf(doc: ThemeDocument): SectionRefs {
  const refs = emptySectionRefs();
  if (doc.brand.logo.imageRef !== null)
    refs.image.push({ path: "brand.logo.imageRef", id: doc.brand.logo.imageRef });
  if (doc.brand.favicon.imageRef !== null)
    refs.image.push({ path: "brand.favicon.imageRef", id: doc.brand.favicon.imageRef });
  const bar = doc.header.announcement;
  const barDefinition = bar === null ? null : sectionDefinition(bar.type);
  if (bar !== null && barDefinition !== null)
    collectFieldRefs(
      barDefinition.fields,
      bar.settings as unknown as Readonly<Record<string, unknown>>,
      "header.announcement.settings",
      refs,
    );
  const fromSections = sectionRefsOf(doc.homepage.sections, "homepage.sections");
  refs.image.push(...fromSections.image);
  refs.collection.push(...fromSections.collection);
  refs.product.push(...fromSections.product);
  refs.page.push(...fromSections.page);
  return refs;
}

/** The distinct image ids a document names. */
export function imageRefsOf(doc: ThemeDocument): string[] {
  return [...new Set(documentRefsOf(doc).image.map((ref) => ref.id))];
}

/** Stable JSON for equality: the reader rebuilds keys in one order whatever the storage did. */
export function canonicalDocumentJson(raw: unknown): string {
  return JSON.stringify(readThemeDocument(raw));
}
