import { PROVINCES } from "@platform/regions";

/** Rest of world, as the API names it. */
export const REST_OF_WORLD = "*";

export interface ZoneCountryDto {
  readonly code: string;
  /** `null` is the whole country. */
  readonly provinces: readonly string[] | null;
}

export type RateConditionDto =
  | { readonly type: "none" }
  | { readonly type: "orderPrice"; readonly minMinor?: number; readonly maxMinor?: number }
  | { readonly type: "weight"; readonly minGrams?: number; readonly maxGrams?: number };

export interface RateDto {
  readonly id: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly condition: RateConditionDto;
  readonly description: string | null;
}

export interface ZoneDto {
  readonly id: string;
  readonly name: string;
  readonly profile: string;
  readonly countries: readonly ZoneCountryDto[];
  readonly rates: readonly RateDto[];
}

/**
 * What the merchant has ticked in the zone dialog. A key means the country is selected: `"all"` is
 * the whole country, a set is only those provinces. Immutable: every change returns a new selection.
 */
export type Selection = Readonly<Record<string, "all" | ReadonlySet<string>>>;

export type CountryState = "all" | "some" | "none";

function provinceCodes(country: string): readonly string[] {
  return (PROVINCES[country] ?? []).map((province) => province.code);
}

export function selectionFromCountries(countries: readonly ZoneCountryDto[]): Selection {
  const selection: Record<string, "all" | ReadonlySet<string>> = {};
  for (const country of countries) {
    selection[country.code] = country.provinces === null ? "all" : new Set(country.provinces);
  }
  return selection;
}

/** The API payload: whole countries as `provinces: null`, a full province set collapsing to the whole country. */
export function countriesFromSelection(selection: Selection): ZoneCountryDto[] {
  return Object.keys(selection)
    .sort()
    .map((code) => {
      const chosen = selection[code];
      if (chosen === undefined || chosen === "all") return { code, provinces: null };
      const all = provinceCodes(code);
      if (all.length > 0 && all.every((province) => chosen.has(province))) {
        return { code, provinces: null };
      }
      return { code, provinces: all.filter((province) => chosen.has(province)) };
    });
}

export function countryState(selection: Selection, code: string): CountryState {
  const chosen = selection[code];
  if (chosen === undefined) return "none";
  if (chosen === "all") return "all";
  const all = provinceCodes(code);
  return all.length > 0 && all.every((province) => chosen.has(province)) ? "all" : "some";
}

/** Ticks or unticks a whole country. Rest of world stands alone: ticking it clears every other country. */
export function toggleCountry(selection: Selection, code: string, checked: boolean): Selection {
  if (!checked) {
    const { [code]: _removed, ...rest } = selection;
    return rest;
  }
  if (code === REST_OF_WORLD) return { [REST_OF_WORLD]: "all" };
  const { [REST_OF_WORLD]: _world, ...rest } = selection;
  return { ...rest, [code]: "all" };
}

/** Ticks or unticks one province; the last one unticked removes the country, every one ticked is the whole country. */
export function toggleProvince(
  selection: Selection,
  code: string,
  province: string,
  checked: boolean,
): Selection {
  const all = provinceCodes(code);
  const current = selection[code];
  const chosen = new Set<string>(current === "all" ? all : (current ?? []));
  if (checked) chosen.add(province);
  else chosen.delete(province);
  const { [REST_OF_WORLD]: _world, ...rest } = selection;
  if (chosen.size === 0) {
    const { [code]: _removed, ...without } = rest;
    return without;
  }
  return { ...rest, [code]: all.length > 0 && chosen.size === all.length ? "all" : chosen };
}

export interface Taken {
  /** The zone holding the whole country (or rest of world). */
  readonly whole?: string;
  /** Provinces held by another zone, by province code. */
  readonly provinces: ReadonlyMap<string, string>;
}

/** What zones other than `exceptZoneId` already hold, so the dialog can disable it ("In {zone}"). */
export function takenBy(
  zones: readonly ZoneDto[],
  exceptZoneId: string | null,
): Map<string, Taken> {
  const taken = new Map<string, { whole?: string; provinces: Map<string, string> }>();
  for (const zone of zones) {
    if (zone.id === exceptZoneId) continue;
    for (const country of zone.countries) {
      const entry = taken.get(country.code) ?? { provinces: new Map<string, string>() };
      if (country.provinces === null) entry.whole = zone.name;
      else for (const province of country.provinces) entry.provinces.set(province, zone.name);
      taken.set(country.code, entry);
    }
  }
  return taken;
}
