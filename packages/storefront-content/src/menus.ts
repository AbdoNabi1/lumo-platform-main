import { MAX_ISSUES, pathSegment } from "./issues";
import { LINK_URL_MAX, normalizeExternalUrl, safeHref } from "./links";
import { normalizeLocalizedText, type ContentIssue, type LocalizedText } from "./locale";
import { isPolicyType, type PolicyType } from "./policies";
import type { ValidationOutcome } from "./theme-document";

export const MENU_HANDLE_MAX = 60;
export const MENU_TITLE_MAX = 100;
export const MENU_LABEL_MAX = 60;
export const MENU_LIMITS = { topLevel: 30, children: 30, total: 150 } as const;
export const MENU_MAX_BYTES = 524_288;
export const DEFAULT_MENU_HANDLES = ["main-menu", "footer"] as const;
export type DefaultMenuHandle = (typeof DEFAULT_MENU_HANDLES)[number];
export const RESERVED_MENU_HANDLES = ["new"] as const;

export type LinkRef =
  | { readonly type: "home" }
  | { readonly type: "search" }
  | { readonly type: "collection" | "product" | "page"; readonly id: string }
  | { readonly type: "policy"; readonly policy: PolicyType }
  | { readonly type: "url"; readonly url: string };

export interface MenuItem {
  readonly id: string;
  readonly label: LocalizedText;
  readonly link: LinkRef;
  readonly children: readonly MenuItem[];
}

export interface ResolvedMenuItem {
  readonly label: LocalizedText;
  readonly href: string;
  readonly external: boolean;
  readonly children: readonly ResolvedMenuItem[];
}

const HANDLE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_TARGET_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Format and length only; whether the handle is reserved or taken is the use case's call. */
export function isMenuHandle(value: unknown): value is string {
  return typeof value === "string" && value.length <= MENU_HANDLE_MAX && HANDLE.test(value);
}

export function isDefaultMenuHandle(value: string): value is DefaultMenuHandle {
  return (DEFAULT_MENU_HANDLES as readonly string[]).includes(value);
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An own property only: an inherited `constructor` or `__proto__` is never a value. */
function own(raw: Raw, key: string): unknown {
  return Object.hasOwn(raw, key) ? raw[key] : undefined;
}

function byteLength(raw: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(raw) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Reports unknown keys, and missing keys among `required`. */
function checkKeys(
  raw: Raw,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
  issues: ContentIssue[],
): void {
  let unknownKeys = 0;
  for (const key of Object.keys(raw)) {
    if (allowed.includes(key)) continue;
    if (unknownKeys < MAX_ISSUES) {
      issues.push({ path: `${path}.${pathSegment(key)}`, code: "UNKNOWN_KEY" });
    }
    unknownKeys += 1;
  }
  for (const key of required) {
    if (own(raw, key) === undefined) issues.push({ path: `${path}.${key}`, code: "MISSING" });
  }
}

// A null-prototype map: `LINK_KEYS["constructor"]` is undefined, not Object's constructor.
const LINK_KEYS: Readonly<Record<string, readonly string[]>> = Object.assign(
  Object.create(null) as Record<string, readonly string[]>,
  {
    home: ["type"],
    search: ["type"],
    collection: ["type", "id"],
    product: ["type", "id"],
    page: ["type", "id"],
    policy: ["type", "policy"],
    url: ["type", "url"],
  },
);

/** The one place a menu link is checked. Returns the stored form, or null with issues pushed. */
function validateLinkRef(raw: unknown, path: string, issues: ContentIssue[]): LinkRef | null {
  if (!isRecord(raw)) {
    issues.push({ path, code: "INVALID_VALUE" });
    return null;
  }
  const type = own(raw, "type");
  const keys = typeof type === "string" ? LINK_KEYS[type] : undefined;
  if (typeof type !== "string" || keys === undefined) {
    issues.push({ path: `${path}.type`, code: "INVALID_LINK" });
    return null;
  }
  const before = issues.length;
  checkKeys(raw, path, keys, keys, issues);
  if (issues.length > before) return null;
  switch (type) {
    case "home":
      return { type: "home" };
    case "search":
      return { type: "search" };
    case "collection":
    case "product":
    case "page": {
      const id = own(raw, "id");
      if (typeof id !== "string" || !LINK_TARGET_ID.test(id)) {
        issues.push({ path: `${path}.id`, code: "INVALID_VALUE" });
        return null;
      }
      return { type, id };
    }
    case "policy": {
      const policy = own(raw, "policy");
      if (!isPolicyType(policy)) {
        issues.push({ path: `${path}.policy`, code: "INVALID_VALUE" });
        return null;
      }
      return { type: "policy", policy };
    }
    default: {
      const url = own(raw, "url");
      if (typeof url !== "string") {
        issues.push({ path: `${path}.url`, code: "INVALID_VALUE" });
        return null;
      }
      if (url.length > LINK_URL_MAX) {
        issues.push({ path: `${path}.url`, code: "TOO_LONG" });
        return null;
      }
      const normalized = normalizeExternalUrl(url);
      if (normalized === null) {
        issues.push({ path: `${path}.url`, code: "INVALID_URL" });
        return null;
      }
      return { type: "url", url: normalized };
    }
  }
}

interface ItemContext {
  readonly issues: ContentIssue[];
  readonly seenIds: Set<string>;
}

function validateItem(raw: unknown, path: string, depth: 1 | 2, ctx: ItemContext): MenuItem | null {
  const { issues } = ctx;
  if (!isRecord(raw)) {
    issues.push({ path, code: "INVALID_VALUE" });
    return null;
  }
  const start = issues.length;
  checkKeys(raw, path, ["id", "label", "link", "children"], ["id", "label", "link"], issues);

  const id = own(raw, "id");
  if (id !== undefined) {
    if (typeof id !== "string" || !ITEM_ID.test(id)) {
      issues.push({ path: `${path}.id`, code: "INVALID_VALUE" });
    } else if (ctx.seenIds.has(id.toLowerCase())) {
      issues.push({ path: `${path}.id`, code: "DUPLICATE_ITEM_ID" });
    } else {
      ctx.seenIds.add(id.toLowerCase());
    }
  }

  let label: LocalizedText = {};
  const labelRaw = own(raw, "label");
  if (labelRaw !== undefined) {
    const before = issues.length;
    label = normalizeLocalizedText(
      labelRaw,
      { path: `${path}.label`, max: MENU_LABEL_MAX },
      issues,
    );
    if (issues.length === before && Object.keys(label).length === 0) {
      issues.push({ path: `${path}.label`, code: "LABEL_REQUIRED" });
    }
  }

  const linkRaw = own(raw, "link");
  const link = linkRaw === undefined ? null : validateLinkRef(linkRaw, `${path}.link`, issues);

  const children: MenuItem[] = [];
  const childrenRaw = own(raw, "children");
  if (childrenRaw !== undefined) {
    if (!Array.isArray(childrenRaw)) {
      issues.push({ path: `${path}.children`, code: "INVALID_VALUE" });
    } else if (childrenRaw.length > MENU_LIMITS.children) {
      issues.push({ path: `${path}.children`, code: "TOO_MANY_ITEMS" });
    } else if (depth === 2) {
      if (childrenRaw.length > 0) issues.push({ path: `${path}.children`, code: "MENU_TOO_DEEP" });
    } else {
      for (const [index, child] of childrenRaw.entries()) {
        if (issues.length >= MAX_ISSUES) break;
        const parsed = validateItem(child, `${path}.children.${index}`, 2, ctx);
        if (parsed !== null) children.push(parsed);
      }
    }
  }

  if (issues.length > start || typeof id !== "string" || link === null) return null;
  return { id, label, link, children };
}

/** The write-path validator for a menu's items; issue paths start at `items`. */
export function validateMenuItems(raw: unknown): ValidationOutcome<readonly MenuItem[]> {
  const fail = (code: string): ValidationOutcome<readonly MenuItem[]> => ({
    ok: false,
    issues: [{ path: "items", code }],
  });
  if (!Array.isArray(raw)) return fail("INVALID_VALUE");
  if (byteLength(raw) > MENU_MAX_BYTES) return fail("MENU_TOO_LARGE");
  if (raw.length > MENU_LIMITS.topLevel) return fail("TOO_MANY_ITEMS");
  let total = raw.length;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const children = own(entry, "children");
    if (Array.isArray(children)) total += children.length;
  }
  if (total > MENU_LIMITS.total) return fail("TOO_MANY_ITEMS");

  const issues: ContentIssue[] = [];
  const ctx: ItemContext = { issues, seenIds: new Set() };
  const items: MenuItem[] = [];
  for (const [index, entry] of raw.entries()) {
    if (issues.length >= MAX_ISSUES) break;
    const parsed = validateItem(entry, `items.${index}`, 1, ctx);
    if (parsed !== null) items.push(parsed);
  }
  return issues.length > 0
    ? { ok: false, issues: issues.slice(0, MAX_ISSUES) }
    : { ok: true, value: items };
}

/** Distinct link target ids per kind across both levels (for one batched existence check). */
export function linkRefTargetsOf(items: readonly MenuItem[]): {
  readonly collection: string[];
  readonly product: string[];
  readonly page: string[];
} {
  const collection = new Set<string>();
  const product = new Set<string>();
  const page = new Set<string>();
  const visit = (list: readonly MenuItem[]): void => {
    for (const item of list) {
      const { link } = item;
      if (link.type === "collection") collection.add(link.id);
      else if (link.type === "product") product.add(link.id);
      else if (link.type === "page") page.add(link.id);
      visit(item.children);
    }
  };
  visit(items);
  return { collection: [...collection], product: [...product], page: [...page] };
}

function clipLabel(text: string | undefined): string | undefined {
  if (text === undefined || text.length <= MENU_LABEL_MAX) return text;
  // Do not leave half of a surrogate pair at the cut.
  const code = text.charCodeAt(MENU_LABEL_MAX - 1);
  const cut = code >= 0xd800 && code <= 0xdbff ? MENU_LABEL_MAX - 1 : MENU_LABEL_MAX;
  return text.slice(0, cut).trimEnd();
}

function readLabel(raw: unknown): LocalizedText | null {
  const normalized = normalizeLocalizedText(raw, { path: "", max: MENU_LABEL_MAX }, []);
  const ar = clipLabel(normalized.ar);
  const en = clipLabel(normalized.en);
  const label: { ar?: string; en?: string } = {};
  if (ar !== undefined && ar.length > 0) label.ar = ar;
  if (en !== undefined && en.length > 0) label.en = en;
  return label.ar === undefined && label.en === undefined ? null : label;
}

function readResolvedItem(raw: unknown): Omit<ResolvedMenuItem, "children"> | null {
  if (!isRecord(raw)) return null;
  const href = safeHref(own(raw, "href"));
  if (href === null) return null;
  const label = readLabel(own(raw, "label"));
  return label === null ? null : { label, href: href.href, external: href.external };
}

/**
 * The storefront's tolerant reader (defence in depth): whatever the Runtime sent, only safe,
 * labelled items survive, `external` is recomputed from the href, and grandchildren are ignored.
 */
export function readResolvedMenu(raw: unknown): readonly ResolvedMenuItem[] {
  if (!Array.isArray(raw)) return [];
  const result: ResolvedMenuItem[] = [];
  let total = 0;
  for (const entry of raw.slice(0, MENU_LIMITS.topLevel)) {
    if (total >= MENU_LIMITS.total) break;
    const top = readResolvedItem(entry);
    if (top === null) continue;
    total += 1;
    const children: ResolvedMenuItem[] = [];
    const childrenRaw = isRecord(entry) ? own(entry, "children") : undefined;
    if (Array.isArray(childrenRaw)) {
      for (const childRaw of childrenRaw.slice(0, MENU_LIMITS.children)) {
        if (total >= MENU_LIMITS.total) break;
        const child = readResolvedItem(childRaw);
        if (child === null) continue;
        total += 1;
        children.push({ ...child, children: [] });
      }
    }
    result.push({ ...top, children });
  }
  return result;
}
