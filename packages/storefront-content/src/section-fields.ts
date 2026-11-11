import { MAX_ISSUES, pathSegment } from "./issues";
import { normalizeLocalizedText, normalizePlainText, type ContentIssue } from "./locale";
import { LINK_TARGET_ID_PATTERN, validateLinkRef } from "./menus";
import { toWhatsAppDigits } from "./phone";
import { validateRichText } from "./rich-text";
import { IMAGE_REF_PATTERN } from "./theme-document";

export type FieldDescriptor =
  | { readonly kind: "localizedText"; readonly key: string; readonly max: number }
  | { readonly kind: "richText"; readonly key: string; readonly max: number }
  | { readonly kind: "image"; readonly key: string; readonly purpose: "section_image" }
  | { readonly kind: "link"; readonly key: string }
  | { readonly kind: "collection"; readonly key: string }
  | { readonly kind: "products"; readonly key: string; readonly max: number }
  | {
      readonly kind: "number";
      readonly key: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
    }
  | { readonly kind: "select"; readonly key: string; readonly options: readonly string[] }
  | { readonly kind: "boolean"; readonly key: string }
  | { readonly kind: "phone"; readonly key: string }
  | { readonly kind: "text"; readonly key: string; readonly max: number }
  | {
      readonly kind: "items";
      readonly key: string;
      readonly min: number;
      readonly max: number;
      readonly fields: readonly FieldDescriptor[];
    };

export type FieldKind = FieldDescriptor["kind"];

export interface SectionRef {
  readonly path: string;
  readonly id: string;
}

export interface SectionRefs {
  readonly image: SectionRef[];
  readonly collection: SectionRef[];
  readonly product: SectionRef[];
  readonly page: SectionRef[];
}

export function emptySectionRefs(): SectionRefs {
  return { image: [], collection: [], product: [], page: [] };
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An own property only: an inherited `constructor` or `__proto__` is never a value. */
function own(raw: Raw, key: string): unknown {
  return Object.hasOwn(raw, key) ? raw[key] : undefined;
}

/** The value a lenient read falls back to inside an item: {} / null / [] / min / options[0] / false / "". */
export function emptyFieldValue(field: FieldDescriptor): unknown {
  switch (field.kind) {
    case "localizedText":
    case "richText":
      return {};
    case "image":
    case "link":
    case "collection":
      return null;
    case "products":
    case "items":
      return [];
    case "number":
      return field.min;
    case "select":
      return field.options[0] ?? "";
    case "boolean":
      return false;
    case "phone":
    case "text":
      return "";
  }
}

type Checked = { readonly ok: true; readonly value: unknown } | { readonly ok: false };
const FAIL: Checked = { ok: false };
const good = (value: unknown): Checked => ({ ok: true, value });

function fail(issues: ContentIssue[], path: string, code: string): Checked {
  issues.push({ path, code });
  return FAIL;
}

function checkRichText(
  field: Extract<FieldDescriptor, { kind: "richText" }>,
  raw: unknown,
  path: string,
  issues: ContentIssue[],
): Checked {
  const before = issues.length;
  const text = normalizeLocalizedText(raw, { path, max: field.max, multiline: true }, issues);
  const tooLong = new Set(
    issues
      .slice(before)
      .filter((issue) => issue.code === "TOO_LONG")
      .map((issue) => issue.path),
  );
  for (const locale of ["ar", "en"] as const) {
    const value = text[locale];
    const localePath = `${path}.${locale}`;
    if (value === undefined || tooLong.has(localePath)) continue;
    for (const issue of validateRichText(value, field.max)) {
      issues.push({ path: localePath, code: issue.code });
    }
  }
  return issues.length > before ? FAIL : good(text);
}

function checkProducts(
  field: Extract<FieldDescriptor, { kind: "products" }>,
  raw: unknown,
  path: string,
  issues: ContentIssue[],
): Checked {
  if (!Array.isArray(raw)) return fail(issues, path, "INVALID_VALUE");
  if (raw.length > field.max) return fail(issues, path, "TOO_MANY_ITEMS");
  const before = issues.length;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const [index, entry] of raw.entries()) {
    if (issues.length >= MAX_ISSUES) break;
    const entryPath = `${path}.${index}`;
    if (typeof entry !== "string" || !LINK_TARGET_ID_PATTERN.test(entry)) {
      issues.push({ path: entryPath, code: "INVALID_VALUE" });
    } else if (seen.has(entry)) {
      issues.push({ path: entryPath, code: "DUPLICATE_VALUE" });
    } else {
      seen.add(entry);
      ids.push(entry);
    }
  }
  return issues.length > before ? FAIL : good(ids);
}

function checkItems(
  field: Extract<FieldDescriptor, { kind: "items" }>,
  raw: unknown,
  path: string,
  issues: ContentIssue[],
): Checked {
  if (!Array.isArray(raw)) return fail(issues, path, "INVALID_VALUE");
  if (raw.length < field.min) return fail(issues, path, "TOO_FEW_ITEMS");
  if (raw.length > field.max) return fail(issues, path, "TOO_MANY_ITEMS");
  const before = issues.length;
  const items: Record<string, unknown>[] = [];
  let failed = false;
  for (const [index, entry] of raw.entries()) {
    if (issues.length >= MAX_ISSUES) break;
    const item = validateFields(field.fields, entry, `${path}.${index}`, issues);
    if (item === null) failed = true;
    else items.push(item);
  }
  // A null item is a failure even when the shared budget kept its issues from being reported.
  return failed || issues.length > before ? FAIL : good(items);
}

/** One validator per kind. Pushes issues and returns FAIL, or returns the stored value. */
function checkField(
  field: FieldDescriptor,
  raw: unknown,
  path: string,
  issues: ContentIssue[],
): Checked {
  switch (field.kind) {
    case "localizedText": {
      const before = issues.length;
      const text = normalizeLocalizedText(raw, { path, max: field.max }, issues);
      return issues.length > before ? FAIL : good(text);
    }
    case "richText":
      return checkRichText(field, raw, path, issues);
    case "image":
      return raw === null || (typeof raw === "string" && IMAGE_REF_PATTERN.test(raw))
        ? good(raw)
        : fail(issues, path, "INVALID_VALUE");
    case "collection":
      return raw === null || (typeof raw === "string" && LINK_TARGET_ID_PATTERN.test(raw))
        ? good(raw)
        : fail(issues, path, "INVALID_VALUE");
    case "products":
      return checkProducts(field, raw, path, issues);
    case "link": {
      if (raw === null) return good(null);
      const before = issues.length;
      const link = validateLinkRef(raw, path, issues);
      return link === null || issues.length > before ? FAIL : good(link);
    }
    case "number": {
      if (typeof raw !== "number") return fail(issues, path, "INVALID_VALUE");
      const onStep = Number.isInteger(raw) && raw >= field.min && raw <= field.max;
      return onStep && (raw - field.min) % field.step === 0
        ? good(raw)
        : fail(issues, path, "OUT_OF_RANGE");
    }
    case "select":
      return typeof raw === "string" && field.options.includes(raw)
        ? good(raw)
        : fail(issues, path, "INVALID_VALUE");
    case "boolean":
      return typeof raw === "boolean" ? good(raw) : fail(issues, path, "INVALID_VALUE");
    case "phone": {
      if (typeof raw !== "string") return fail(issues, path, "INVALID_VALUE");
      if (raw.trim() === "") return good("");
      const digits = toWhatsAppDigits(raw);
      return digits === null ? fail(issues, path, "INVALID_PHONE") : good(digits);
    }
    case "text": {
      if (typeof raw !== "string") return fail(issues, path, "INVALID_VALUE");
      const text = normalizePlainText(raw);
      return text.length > field.max ? fail(issues, path, "TOO_LONG") : good(text);
    }
    case "items":
      return checkItems(field, raw, path, issues);
  }
}

/**
 * Strict: an object with exactly the fields' keys; returns the stored values or null (issues pushed).
 * Validity is tracked apart from the issue list: the shared budget (MAX_ISSUES, one for the whole
 * call chain) caps only how many issues are reported, never whether a value is rejected.
 */
export function validateFields(
  fields: readonly FieldDescriptor[],
  raw: unknown,
  path: string,
  issues: ContentIssue[],
): Record<string, unknown> | null {
  const found: ContentIssue[] = [];
  const values = checkObject(fields, raw, path, found);
  const room = Math.max(0, MAX_ISSUES - issues.length);
  for (const issue of found.slice(0, room)) issues.push(issue);
  return values;
}

function checkObject(
  fields: readonly FieldDescriptor[],
  raw: unknown,
  path: string,
  found: ContentIssue[],
): Record<string, unknown> | null {
  if (!isRecord(raw)) {
    found.push({ path, code: "INVALID_VALUE" });
    return null;
  }
  const known = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(raw)) {
    if (found.length >= MAX_ISSUES) break;
    if (!known.has(key)) found.push({ path: `${path}.${pathSegment(key)}`, code: "UNKNOWN_KEY" });
  }
  const values: Record<string, unknown> = {};
  let failed = found.length > 0;
  for (const field of fields) {
    if (found.length >= MAX_ISSUES) break;
    const fieldPath = `${path}.${field.key}`;
    const value = own(raw, field.key);
    if (value === undefined) {
      found.push({ path: fieldPath, code: "MISSING" });
      failed = true;
      continue;
    }
    const checked = checkField(field, value, fieldPath, found);
    if (checked.ok) values[field.key] = checked.value;
    else failed = true;
  }
  return failed || found.length > 0 ? null : values;
}

function readField(field: FieldDescriptor, raw: unknown, fallback: unknown): unknown {
  if (field.kind === "items") {
    if (!Array.isArray(raw)) return fallback;
    const itemFallback = emptyValues(field.fields);
    return raw.slice(0, field.max).map((entry) => readFields(field.fields, entry, itemFallback));
  }
  const checked = checkField(field, raw, "", []);
  return checked.ok ? checked.value : fallback;
}

function emptyValues(fields: readonly FieldDescriptor[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.key, emptyFieldValue(field)]));
}

/** Lenient (read path): never pushes; unknown keys dropped; an invalid value becomes fallback[key]. */
export function readFields(
  fields: readonly FieldDescriptor[],
  raw: unknown,
  fallback: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const fallbackValue = Object.hasOwn(fallback, field.key)
      ? fallback[field.key]
      : emptyFieldValue(field);
    const value = isRecord(raw) ? own(raw, field.key) : undefined;
    values[field.key] =
      value === undefined ? fallbackValue : readField(field, value, fallbackValue);
  }
  return values;
}

/** Appends every image, collection, product and page id the values name, with its dotted path. */
export function collectFieldRefs(
  fields: readonly FieldDescriptor[],
  values: Readonly<Record<string, unknown>>,
  path: string,
  out: SectionRefs,
): void {
  for (const field of fields) {
    const value = Object.hasOwn(values, field.key) ? values[field.key] : undefined;
    const fieldPath = `${path}.${field.key}`;
    switch (field.kind) {
      case "image":
        if (typeof value === "string") out.image.push({ path: fieldPath, id: value });
        break;
      case "collection":
        if (typeof value === "string") out.collection.push({ path: fieldPath, id: value });
        break;
      case "products":
        if (Array.isArray(value)) {
          for (const [index, id] of value.entries()) {
            if (typeof id === "string") out.product.push({ path: `${fieldPath}.${index}`, id });
          }
        }
        break;
      case "link":
        if (isRecord(value)) {
          const type = own(value, "type");
          const id = own(value, "id");
          if (typeof id === "string") {
            const idPath = `${fieldPath}.id`;
            if (type === "collection") out.collection.push({ path: idPath, id });
            else if (type === "product") out.product.push({ path: idPath, id });
            else if (type === "page") out.page.push({ path: idPath, id });
          }
        }
        break;
      case "items":
        if (Array.isArray(value)) {
          for (const [index, entry] of value.entries()) {
            if (isRecord(entry))
              collectFieldRefs(field.fields, entry, `${fieldPath}.${index}`, out);
          }
        }
        break;
      default:
        break;
    }
  }
}
