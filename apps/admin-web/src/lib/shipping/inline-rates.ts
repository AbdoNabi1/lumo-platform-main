import { PROVINCES } from "@platform/regions";
import { toMinorUnits } from "@/lib/products/money";
import { remainingProvinces } from "./quick-setup";
import type { RateConditionDto, Selection, ZoneDto } from "./zones";

/**
 * Plan 3E — the rate a merchant types into the "Create zone" dialog, as it travels to the server: amounts
 * stay as typed text, because only the server action knows the store currency to read them in.
 */
export interface InlineRate {
  readonly name: string;
  readonly description: string;
  readonly price: string;
  /** Orders at or above this total (inclusive). */
  readonly min?: string;
  /** Orders below this total (exclusive). */
  readonly max?: string;
}

export interface InlineRateFields {
  readonly name: string;
  readonly description: string;
  readonly price: string;
}

/** The rates the dialog posts: none without a price, one as typed, or two around a free-over amount. */
export function buildInlineRates(
  fields: InlineRateFields,
  freeOver: string | null,
  freeName: string,
): InlineRate[] {
  if (fields.price.trim().length === 0) return [];
  const threshold = freeOver?.trim() ?? "";
  if (threshold.length === 0) return [fields];
  return [
    { ...fields, max: threshold },
    { name: freeName, description: fields.description, price: "0", min: threshold },
  ];
}

export interface InlineRateInput {
  readonly name: string;
  readonly priceMinor: number;
  readonly condition: RateConditionDto;
  readonly description: string | null;
}

export type ParsedInlineRates =
  | { readonly ok: true; readonly rates: InlineRateInput[] }
  /** `field` is the form field to show the error under. */
  | { readonly ok: false; readonly field: "rates" | "rateName" | "ratePrice" };

const MAX_INLINE_RATES = 20;

function isText(value: unknown): value is string {
  return typeof value === "string";
}

/** Validates the posted JSON and reads its amounts in the store currency (never as floats). */
export function parseInlineRates(raw: string, currency: string): ParsedInlineRates {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, field: "rates" };
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_INLINE_RATES) {
    return { ok: false, field: "rates" };
  }
  const rates: InlineRateInput[] = [];
  for (const entry of parsed as unknown[]) {
    const candidate = entry as Record<string, unknown> | null;
    if (typeof candidate !== "object" || candidate === null) return { ok: false, field: "rates" };
    const { name, description, price, min, max } = candidate;
    if (!isText(name) || !isText(description) || !isText(price)) {
      return { ok: false, field: "rates" };
    }
    if ((min !== undefined && !isText(min)) || (max !== undefined && !isText(max))) {
      return { ok: false, field: "rates" };
    }
    if (name.trim().length === 0) return { ok: false, field: "rateName" };
    const priceMinor = toMinorUnits(price, currency);
    const minMinor = min === undefined ? undefined : toMinorUnits(min, currency);
    const maxMinor = max === undefined ? undefined : toMinorUnits(max, currency);
    if (priceMinor === null || minMinor === null || maxMinor === null) {
      return { ok: false, field: "ratePrice" };
    }
    const bounded = minMinor !== undefined || maxMinor !== undefined;
    rates.push({
      name: name.trim(),
      priceMinor,
      description: description.trim().length === 0 ? null : description.trim(),
      condition: bounded
        ? {
            type: "orderPrice",
            ...(minMinor === undefined ? {} : { minMinor }),
            ...(maxMinor === undefined ? {} : { maxMinor }),
          }
        : { type: "none" },
    });
  }
  return { ok: true, rates };
}

/** The provinces of a shortcut that no other zone holds, so the chip never selects what is taken. */
export function chipProvinces(
  shortcut: readonly string[],
  country: string,
  zones: readonly ZoneDto[],
  exceptZoneId: string | null,
): string[] {
  const free = remainingProvinces(country, zones, exceptZoneId);
  return shortcut.filter((code) => free.includes(code));
}

/** A selection of just these provinces of `country`; every province is the whole country. */
export function selectionOfProvinces(country: string, provinces: readonly string[]): Selection {
  const total = (PROVINCES[country] ?? []).length;
  return { [country]: total > 0 && provinces.length === total ? "all" : new Set(provinces) };
}
