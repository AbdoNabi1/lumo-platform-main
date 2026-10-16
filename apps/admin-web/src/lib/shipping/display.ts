import { PROVINCES } from "@platform/regions";
import { formatCurrency } from "@/lib/format";
import type { WeightUnit } from "@/lib/api/store-settings";
import type { Locale } from "@/lib/i18n";
import { fromGrams } from "@/lib/products/weight";
import type { Dictionary } from "@/messages/en";
import { REST_OF_WORLD, type RateConditionDto, type ZoneCountryDto } from "./zones";

type ShippingCopy = Dictionary["shippingSettings"];

export interface DescribeContext {
  readonly locale: Locale;
  readonly currency: string;
  readonly weightUnit: WeightUnit;
  readonly t: ShippingCopy;
  /** The product editor's unit abbreviations (g, kg, lb, oz). */
  readonly units: Dictionary["productEditor"];
}

function unitLabel(unit: WeightUnit, units: Dictionary["productEditor"]): string {
  return { g: units.grams, kg: units.kilograms, lb: units.pounds, oz: units.ounces }[unit];
}

function range(
  min: number | undefined,
  max: number | undefined,
  show: (value: number) => string,
  t: ShippingCopy,
): string {
  if (min !== undefined && max !== undefined) {
    return t.between.replace("{min}", show(min)).replace("{max}", show(max));
  }
  if (min !== undefined) return t.andUp.replace("{amount}", show(min));
  if (max !== undefined) return t.upTo.replace("{amount}", show(max));
  return t.noCondition;
}

/** A rate's condition as the table shows it: "—", "EGP 1,000.00 and up", "0–5 kg". */
export function describeCondition(condition: RateConditionDto, ctx: DescribeContext): string {
  switch (condition.type) {
    case "none":
      return ctx.t.noCondition;
    case "orderPrice":
      return range(
        condition.minMinor,
        condition.maxMinor,
        (minor) => formatCurrency(ctx.locale, minor, ctx.currency),
        ctx.t,
      );
    case "weight": {
      const unit = unitLabel(ctx.weightUnit, ctx.units);
      const show = (grams: number) => fromGrams(grams, ctx.weightUnit);
      const { minGrams: min, maxGrams: max } = condition;
      if (min !== undefined && max !== undefined) return `${show(min)}–${show(max)} ${unit}`;
      return range(min, max, (grams) => `${show(grams)} ${unit}`, ctx.t);
    }
  }
}

export function formatRatePrice(
  priceMinor: number,
  currency: string,
  locale: Locale,
  t: Pick<ShippingCopy, "free">,
): string {
  return priceMinor === 0 ? t.free : formatCurrency(locale, priceMinor, currency);
}

export function countryName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames(locale, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function provinceNoun(code: string, t: ShippingCopy): string {
  if (code === "SA") return t.nounSA;
  if (code === "AE") return t.nounAE;
  return t.nounEG;
}

/** "Egypt (5 of 27 governorates)", "Saudi Arabia", "Rest of world". */
export function summarizeCountry(
  country: ZoneCountryDto,
  locale: Locale,
  t: Pick<ShippingCopy, "restOfWorld" | "partialSummary" | "nounEG" | "nounSA" | "nounAE">,
): string {
  if (country.code === REST_OF_WORLD) return t.restOfWorld;
  const name = countryName(country.code, locale);
  if (country.provinces === null) return name;
  return t.partialSummary
    .replace("{country}", name)
    .replace("{n}", String(country.provinces.length))
    .replace("{total}", String((PROVINCES[country.code] ?? []).length))
    .replace("{noun}", provinceNoun(country.code, t as ShippingCopy));
}
