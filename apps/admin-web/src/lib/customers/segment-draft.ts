import type { SegmentCondition, SegmentField } from "@/lib/api/customer-segments";
import {
  currencyExponent,
  fromMinorUnits,
  normalizeDigits,
  toMinorUnits,
} from "@/lib/products/money";
import { mergeTags } from "./tags";

/**
 * Shopify parity Wave 1c — the segment editor's draft model. One draft row is what the merchant
 * is typing (text boxes, chips, a yes/no); `conditionFromDraft` turns it into the wire
 * `SegmentCondition` or says exactly which input is wrong. Identity stays the authority for every
 * range (orders 0..1_000_000, days 1..3650, 1..20 tags…): this only refuses what cannot even be
 * read as the right kind of value, so the preview is never called with garbage.
 */

export const MAX_SEGMENT_CONDITIONS = 10;

/** The order the filter select lists the fields in. */
export const SEGMENT_FIELDS: readonly SegmentField[] = [
  "orders_count",
  "amount_spent",
  "last_order_date",
  "email_subscribed",
  "sms_subscribed",
  "tags",
  "country",
  "created_date",
  "language",
];

const CMP = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
const DAYS_AND_DATES = [
  "within_last_days",
  "not_within_last_days",
  "on_or_after",
  "before",
] as const;

/** The operators a field offers, first = the default. Flags have none (the value is the whole condition). */
export const OPS_BY_FIELD: Readonly<Record<SegmentField, readonly string[]>> = {
  orders_count: CMP,
  amount_spent: CMP,
  last_order_date: [...DAYS_AND_DATES, "never"],
  email_subscribed: [],
  sms_subscribed: [],
  tags: ["has_any", "has_all", "has_none"],
  country: ["in", "not_in"],
  created_date: DAYS_AND_DATES,
  language: ["eq", "neq", "unset"],
};

export type ValueKind =
  "none" | "integer" | "money" | "days" | "date" | "flag" | "tags" | "countries" | "language";

export function valueKind(field: SegmentField, op: string): ValueKind {
  switch (field) {
    case "orders_count":
      return "integer";
    case "amount_spent":
      return "money";
    case "last_order_date":
    case "created_date":
      if (op === "never") return "none";
      return op === "within_last_days" || op === "not_within_last_days" ? "days" : "date";
    case "email_subscribed":
    case "sms_subscribed":
      return "flag";
    case "tags":
      return "tags";
    case "country":
      return "countries";
    case "language":
      return op === "unset" ? "none" : "language";
  }
}

export interface ConditionDraft {
  /** A client-only key, so removing a row never re-uses another row's inputs. */
  readonly id: string;
  readonly field: SegmentField;
  readonly op: string;
  /** The typed number, money, days, date or country list. */
  readonly text: string;
  readonly values: readonly string[];
  /** Email / SMS: `true` = subscribed. */
  readonly flag: boolean;
  readonly language: "en" | "ar";
}

export function newDraft(id: string, field: SegmentField = "orders_count"): ConditionDraft {
  return {
    id,
    field,
    op: OPS_BY_FIELD[field][0] ?? "",
    text: "",
    values: [],
    flag: true,
    language: "en",
  };
}

/** Switching the filter starts that filter's row afresh (nothing typed for another field carries over). */
export function withField(draft: ConditionDraft, field: SegmentField): ConditionDraft {
  return field === draft.field ? draft : newDraft(draft.id, field);
}

/** Switching the operator keeps what was typed when the new operator takes the same kind of value. */
export function withOp(draft: ConditionDraft, op: string): ConditionDraft {
  const sameKind = valueKind(draft.field, op) === valueKind(draft.field, draft.op);
  return { ...draft, op, text: sameKind ? draft.text : "" };
}

export type DraftErrorKey =
  | "required"
  | "wholeNumber"
  | "invalidAmount"
  | "tooManyDecimals"
  | "invalidDate"
  | "invalidCountries"
  | "needTags"
  | "needCountries";

/** `field` is the server path suffix the message belongs to (`conditions.<i>.<field>`). */
export type DraftResult =
  | { readonly ok: true; readonly condition: SegmentCondition }
  | { readonly ok: false; readonly field: string; readonly error: DraftErrorKey };

const WHOLE = /^\d+$/;

function wholeNumber(text: string): number | null {
  const normalized = normalizeDigits(text.trim());
  if (!WHOLE.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) ? value : null;
}

/** `YYYY-MM-DD` that is a real calendar date (rejects 2026-02-30). */
export function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** `"eg, SA،sa"` → `["EG","SA"]`, or `null` when any entry is not a two-letter code. */
export function parseCountries(text: string): readonly string[] | null {
  const codes = text
    .split(/[,\u060C]/)
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
  if (codes.some((code) => !/^[A-Z]{2}$/.test(code))) return null;
  return [...new Set(codes)];
}

function moneyToMinor(
  text: string,
  currency: string,
): { readonly minor: number } | { readonly error: DraftErrorKey } {
  const normalized = normalizeDigits(text.trim());
  if (normalized === "") return { error: "required" };
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (match === null) return { error: "invalidAmount" };
  const fraction = match[2] ?? "";
  if (fraction.length > currencyExponent(currency)) return { error: "tooManyDecimals" };
  // The shared helper does the string arithmetic (never `Number(text) * 100`).
  const minor = toMinorUnits(normalized, currency);
  return minor === null ? { error: "invalidAmount" } : { minor };
}

export function conditionFromDraft(draft: ConditionDraft, currency: string): DraftResult {
  const fail = (field: string, error: DraftErrorKey): DraftResult => ({ ok: false, field, error });
  const ok = (condition: SegmentCondition): DraftResult => ({ ok: true, condition });
  const { field, op } = draft;

  switch (valueKind(field, op)) {
    case "integer": {
      if (draft.text.trim() === "") return fail("value", "required");
      const value = wholeNumber(draft.text);
      if (value === null) return fail("value", "wholeNumber");
      return ok({ field: "orders_count", op: op as (typeof CMP)[number], value });
    }
    case "money": {
      const result = moneyToMinor(draft.text, currency);
      if ("error" in result) return fail("valueMinor", result.error);
      return ok({
        field: "amount_spent",
        op: op as (typeof CMP)[number],
        valueMinor: result.minor,
      });
    }
    case "days": {
      if (draft.text.trim() === "") return fail("days", "required");
      const days = wholeNumber(draft.text);
      if (days === null) return fail("days", "wholeNumber");
      return ok({
        field: field as "last_order_date" | "created_date",
        op: op as "within_last_days" | "not_within_last_days",
        days,
      });
    }
    case "date": {
      const date = draft.text.trim();
      if (date === "") return fail("date", "required");
      if (!isCalendarDate(date)) return fail("date", "invalidDate");
      return ok({
        field: field as "last_order_date" | "created_date",
        op: op as "on_or_after" | "before",
        date,
      });
    }
    case "flag":
      return ok({ field: field as "email_subscribed" | "sms_subscribed", value: draft.flag });
    case "tags": {
      const values = mergeTags([], draft.values);
      if (values.length === 0) return fail("values", "needTags");
      return ok({ field: "tags", op: op as "has_any" | "has_all" | "has_none", values });
    }
    case "countries": {
      if (draft.text.trim() === "") return fail("values", "needCountries");
      const values = parseCountries(draft.text);
      if (values === null) return fail("values", "invalidCountries");
      if (values.length === 0) return fail("values", "needCountries");
      return ok({ field: "country", op: op as "in" | "not_in", values });
    }
    case "language":
      return ok({ field: "language", op: op as "eq" | "neq", value: draft.language });
    case "none":
      return field === "language"
        ? ok({ field: "language", op: "unset" })
        : ok({ field: "last_order_date", op: "never" });
  }
}

/** A saved condition back into an editable row (money in major units for the shop currency). */
export function draftFromCondition(
  condition: SegmentCondition,
  currency: string,
  id: string,
): ConditionDraft {
  const base = newDraft(id, condition.field);
  switch (condition.field) {
    case "orders_count":
      return { ...base, op: condition.op, text: String(condition.value) };
    case "amount_spent":
      return { ...base, op: condition.op, text: fromMinorUnits(condition.valueMinor, currency) };
    case "last_order_date":
    case "created_date":
      if (condition.op === "never") return { ...base, op: "never" };
      if ("days" in condition) return { ...base, op: condition.op, text: String(condition.days) };
      return { ...base, op: condition.op, text: condition.date };
    case "email_subscribed":
    case "sms_subscribed":
      return { ...base, flag: condition.value };
    case "tags":
      return { ...base, op: condition.op, values: [...condition.values] };
    case "country":
      return { ...base, op: condition.op, text: condition.values.join(", ") };
    case "language":
      return condition.op === "unset"
        ? { ...base, op: "unset" }
        : { ...base, op: condition.op, language: condition.value };
  }
}

/** Every row as a condition, or `null` while any row is incomplete (the preview waits for a full set). */
export function conditionsFromDrafts(
  drafts: readonly ConditionDraft[],
  currency: string,
): readonly SegmentCondition[] | null {
  const conditions: SegmentCondition[] = [];
  for (const draft of drafts) {
    const result = conditionFromDraft(draft, currency);
    if (!result.ok) return null;
    conditions.push(result.condition);
  }
  return conditions.length === 0 ? null : conditions;
}
