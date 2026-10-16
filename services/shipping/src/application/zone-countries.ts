import { COUNTRY_CODES, PROVINCES } from "@platform/regions";
import { ValidationError, type FieldIssue } from "@platform/utils";
import { REST_OF_WORLD, type ShippingZone, type ZoneCountry } from "../domain/shipping-zone";

const REAL_COUNTRIES: ReadonlySet<string> = new Set(COUNTRY_CODES);

/**
 * The checks that need the region data: every code is a real country (or rest of world) and every
 * province belongs to its country. A country without province data can only be held whole. Returns one
 * `countries` issue per problem; the structural rules (duplicates, empty lists) are the aggregate's.
 */
export function regionIssues(countries: readonly ZoneCountry[]): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const country of countries) {
    if (country.code === REST_OF_WORLD) continue;
    if (!REAL_COUNTRIES.has(country.code)) {
      issues.push({ field: "countries", message: `${country.code} is not a country code` });
      continue;
    }
    if (country.provinces === null) continue;
    const known = new Set((PROVINCES[country.code] ?? []).map((province) => province.code));
    for (const province of country.provinces) {
      if (!known.has(province)) {
        issues.push({
          field: "countries",
          message: `${province} is not a province of ${country.code}`,
        });
      }
    }
  }
  return issues;
}

/**
 * Shopify refuses a country in two zones ("A country can only be in one zone"). A zone holding a whole
 * country clashes with any other zone naming that country; two zones listing provinces clash only on a
 * shared province. One issue per clashing zone, naming the zone.
 */
export function overlapIssues(
  countries: readonly ZoneCountry[],
  others: readonly ShippingZone[],
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const other of others) {
    for (const mine of countries) {
      const theirs = other.countries.find((country) => country.code === mine.code);
      if (theirs === undefined) continue;
      const clash =
        mine.provinces === null || theirs.provinces === null
          ? mine.code
          : mine.provinces.find((province) => theirs.provinces?.includes(province) === true);
      if (clash === undefined) continue;
      issues.push({
        field: "countries",
        message: `${clash} is already in zone "${other.name}"; a country can only be in one zone`,
      });
      break;
    }
  }
  return issues;
}

export function invalidCountries(issues: readonly FieldIssue[]): ValidationError {
  return new ValidationError("Invalid shipping zone", issues);
}
