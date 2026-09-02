import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { DEFAULT_LOCALE, dictionaryFor, directionFor, isLocale, LOCALES } from "./i18n";

/**
 * Localisation guarantees. The dictionaries are structurally typed against each other, so a
 * *missing* key is already a compile error — what a test can still catch is a key that was
 * copied across without being translated, and a direction that stops following the locale.
 */

type Leaf = readonly [path: string, value: string];

function leaves(value: unknown, path: string[] = []): Leaf[] {
  if (typeof value === "string") return [[path.join("."), value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]));
}

/** Keys whose Arabic value is legitimately identical to English (keyboard glyphs, symbols). */
const SHARED_VERBATIM = new Set<string>([]);

describe("locales", () => {
  it("offers exactly the two validated locales, defaulting to English", () => {
    expect([...LOCALES]).toEqual(["en", "ar"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("recognises supported locales and rejects anything else", () => {
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("derives writing direction from the locale", () => {
    expect(directionFor("en")).toBe("ltr");
    expect(directionFor("ar")).toBe("rtl");
  });

  it("resolves each locale to its own dictionary", () => {
    expect(dictionaryFor("en")).toBe(en);
    expect(dictionaryFor("ar")).toBe(ar);
  });
});

describe("Arabic dictionary", () => {
  const englishLeaves = leaves(en);
  const arabicByPath = new Map(leaves(ar));

  it("covers every English key", () => {
    const missing = englishLeaves.filter(([path]) => !arabicByPath.has(path)).map(([p]) => p);
    expect(missing).toEqual([]);
  });

  it("is actually translated, not copied", () => {
    const untranslated = englishLeaves
      .filter(([path, value]) => !SHARED_VERBATIM.has(path) && arabicByPath.get(path) === value)
      .map(([path]) => path);
    expect(untranslated).toEqual([]);
  });

  it("preserves every interpolation placeholder", () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

    for (const [path, english] of englishLeaves) {
      const arabic = arabicByPath.get(path);
      expect(arabic, `missing Arabic for ${path}`).toBeDefined();
      expect(placeholders(arabic ?? ""), `placeholder mismatch at ${path}`).toEqual(
        placeholders(english),
      );
    }
  });
});
