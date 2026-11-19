import type { Locale } from "@platform/storefront-content";

export type CountedNoun = "day" | "businessDay";

const ARABIC = new Intl.PluralRules("ar");
const ENGLISH = new Intl.PluralRules("en");

/**
 * Modern Standard Arabic number-noun agreement, keyed by the CLDR category. Every template uses
 * these phrases after a preposition ("within ..."), so the dual is the genitive form.
 */
const AR: Readonly<
  Record<
    CountedNoun,
    Readonly<{ one: string; two: string; few: string; many: string; other: string }>
  >
> = {
  day: { one: "يوم واحد", two: "يومين", few: "أيام", many: "يوماً", other: "يوم" },
  businessDay: {
    one: "يوم عمل واحد",
    two: "يومي عمل",
    few: "أيام عمل",
    many: "يوم عمل",
    other: "يوم عمل",
  },
};

const EN: Readonly<Record<CountedNoun, { one: string; other: string }>> = {
  day: { one: "day", other: "days" },
  businessDay: { one: "business day", other: "business days" },
};

/** "1 day", "7 days", "11 يوماً": the number and its noun, agreeing. */
export function countPhrase(locale: Locale, noun: CountedNoun, n: number): string {
  if (locale === "en") {
    return `${n} ${EN[noun][ENGLISH.select(n) === "one" ? "one" : "other"]}`;
  }
  const category = ARABIC.select(n);
  if (category === "one" || category === "two") return AR[noun][category];
  // zero is "other" in the table: "0 يوم".
  const word = category === "zero" ? AR[noun].other : AR[noun][category];
  return `${n} ${word}`;
}

/** "2 to 5 business days": the noun agrees with the last number. */
export function rangePhrase(locale: Locale, min: number, max: number): string {
  if (min === max) return countPhrase(locale, "businessDay", max);
  const last = countPhrase(locale, "businessDay", max);
  return locale === "en" ? `${min} to ${last}` : `${min} إلى ${last}`;
}
