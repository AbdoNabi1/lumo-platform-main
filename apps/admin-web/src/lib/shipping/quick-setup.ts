import { PROVINCES, provinceName } from "@platform/regions";
import { dictionaryFor, type Locale } from "@/lib/i18n";
import { countryName } from "./display";
import {
  REST_OF_WORLD,
  countriesFromSelection,
  countryState,
  takenBy,
  type RateConditionDto,
  type Selection,
  type ZoneCountryDto,
  type ZoneDto,
} from "./zones";

/** Plan 3E — the shortcuts and suggestions that let a merchant set up shipping in seconds. */

export const CAIRO_GIZA: readonly string[] = ["EG-C", "EG-GZ"];
export const GREATER_CAIRO: readonly string[] = ["EG-C", "EG-GZ", "EG-KB"];

/** The provinces of `country` that no zone other than `exceptZoneId` holds. */
export function remainingProvinces(
  country: string,
  zones: readonly ZoneDto[],
  exceptZoneId: string | null,
): string[] {
  const taken = takenBy(zones, exceptZoneId).get(country);
  if (taken?.whole !== undefined) return [];
  return (PROVINCES[country] ?? [])
    .map((province) => province.code)
    .filter((code) => taken?.provinces.has(code) !== true);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((code) => b.includes(code));
}

function joinNames(names: readonly string[], locale: Locale): string {
  const t = dictionaryFor(locale).shippingSettings;
  const last = names[names.length - 1] ?? "";
  if (names.length === 1) return last;
  return t.nameJoinLast
    .replace("{list}", names.slice(0, -1).join(t.nameSeparator))
    .replace("{last}", last);
}

function restOfCountryLabel(country: string, locale: Locale): string | null {
  const t = dictionaryFor(locale).shippingSettings;
  const labels: Readonly<Record<string, string>> = {
    EG: t.restOfEG,
    SA: t.restOfSA,
    AE: t.restOfAE,
  };
  return labels[country] ?? null;
}

/** The name a zone gets until the merchant types their own (see the rules in Plan 3E, Task 2). */
export function suggestZoneName(
  selection: Selection,
  zones: readonly ZoneDto[],
  exceptZoneId: string | null,
  locale: Locale,
): string {
  const codes = Object.keys(selection).sort();
  if (codes.length === 0) return "";
  if (codes.includes(REST_OF_WORLD)) return dictionaryFor(locale).shippingSettings.restOfWorld;
  if (codes.length > 1) {
    const shown = codes.slice(0, 2).map((code) => countryName(code, locale));
    const more = codes.length - shown.length;
    const names = shown.join(dictionaryFor(locale).shippingSettings.nameSeparator);
    return more > 0 ? `${names} +${more}` : names;
  }

  const code = codes[0] ?? "";
  if (countryState(selection, code) === "all") return countryName(code, locale);
  const chosen = (PROVINCES[code] ?? [])
    .map((province) => province.code)
    .filter((province) => {
      const picked = selection[code];
      return picked === "all" || picked?.has(province) === true;
    });
  const left = remainingProvinces(code, zones, exceptZoneId);
  const othersHoldSome = left.length < (PROVINCES[code] ?? []).length;
  const rest = restOfCountryLabel(code, locale);
  if (othersHoldSome && rest !== null && sameSet(chosen, left)) return rest;
  if (chosen.length >= 1 && chosen.length <= 3) {
    return joinNames(
      chosen.map((province) => provinceName(province, locale)),
      locale,
    );
  }
  return countryName(code, locale);
}

export const RATE_PRESETS = ["standard", "express", "custom"] as const;
export type RatePresetId = (typeof RATE_PRESETS)[number];

/** What a preset fills into the rate form, in the admin's locale. Editable text, not keys. */
export function ratePreset(
  id: RatePresetId,
  locale: Locale,
): { readonly name: string; readonly description: string } {
  const t = dictionaryFor(locale).shippingSettings;
  switch (id) {
    case "standard":
      return { name: t.presetStandard, description: t.presetStandardDescription };
    case "express":
      return { name: t.presetExpress, description: t.presetExpressDescription };
    case "custom":
      return { name: "", description: "" };
  }
}

// What may surround the digits of a price typed as a name: currency symbols, 3-letter codes, or the
// Arabic abbreviations / words for pound, riyal and dirham (dots and spaces are stripped first).
const PRICE_WORDS = /^(?:\p{Sc}|[A-Za-z]{3}|جم|رس|دإ|جنيه|ريال|درهم)*$/u;
const DIGITS = /[\d٠-٩۰-۹]/u;

/** True when a rate name is only a number with separators or a currency, e.g. "50", "50 EGP", "٥٠". */
export function looksLikePrice(name: string): boolean {
  const trimmed = name.trim();
  if (!DIGITS.test(trimmed)) return false;
  const rest = trimmed.replace(/[\d٠-٩۰-۹.,٫٬\s]/gu, "");
  return PRICE_WORDS.test(rest);
}

export interface RatePayload {
  readonly name: string;
  readonly priceMinor: number;
  readonly condition: RateConditionDto;
  readonly description: string | null;
}

export interface ZonePayload {
  readonly name: string;
  readonly countries: ZoneCountryDto[];
  readonly rates: RatePayload[];
}

export interface QuickSetupInput {
  readonly country: string;
  readonly cityPriceMinor: number;
  readonly restPriceMinor: number;
  /** Orders at or above this total ship free; `null` for no free-shipping rate. */
  readonly freeOverMinor: number | null;
  readonly zones: readonly ZoneDto[];
  readonly locale: Locale;
}

/** The standard rate, plus a free one above the threshold. A rate's max is exclusive, so exactly one applies. */
function quickRates(
  priceMinor: number,
  freeOverMinor: number | null,
  locale: Locale,
): RatePayload[] {
  const standard = ratePreset("standard", locale);
  const base = { name: standard.name, description: standard.description };
  if (freeOverMinor === null) {
    return [{ ...base, priceMinor, condition: { type: "none" } }];
  }
  return [
    { ...base, priceMinor, condition: { type: "orderPrice", maxMinor: freeOverMinor } },
    {
      name: dictionaryFor(locale).shippingSettings.freeShipping,
      priceMinor: 0,
      condition: { type: "orderPrice", minMinor: freeOverMinor },
      description: standard.description,
    },
  ];
}

function provincesZone(
  country: string,
  provinces: readonly string[],
  zones: readonly ZoneDto[],
  priceMinor: number,
  input: QuickSetupInput,
): ZonePayload {
  const selection: Selection = { [country]: new Set(provinces) };
  return {
    name: suggestZoneName(selection, zones, null, input.locale),
    countries: countriesFromSelection(selection),
    rates: quickRates(priceMinor, input.freeOverMinor, input.locale),
  };
}

/** The zones (with their rates) one tap of "Save shipping rates" creates, skipping anything already held. */
export function quickSetupPlan(input: QuickSetupInput): ZonePayload[] {
  const left = remainingProvinces(input.country, input.zones, null);
  if (left.length === 0) return [];

  if (input.country !== "EG") {
    return [provincesZone(input.country, left, input.zones, input.cityPriceMinor, input)];
  }

  const plan: ZonePayload[] = [];
  const city = left.filter((code) => CAIRO_GIZA.includes(code));
  if (city.length > 0) {
    plan.push(provincesZone("EG", city, input.zones, input.cityPriceMinor, input));
  }
  const rest = left.filter((code) => !CAIRO_GIZA.includes(code));
  if (rest.length > 0) {
    const cityZone: ZoneDto = {
      id: "quick-setup",
      name: plan[0]?.name ?? "",
      profile: "general",
      countries: plan[0]?.countries ?? [],
      rates: [],
    };
    plan.push(provincesZone("EG", rest, [...input.zones, cityZone], input.restPriceMinor, input));
  }
  return plan;
}
