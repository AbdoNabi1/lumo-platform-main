import type { WeightUnit } from "@/lib/api/store-settings";

/** Grams in one unit. Storage is always grams; the merchant types and reads the store's unit. */
const GRAMS_PER_UNIT: Readonly<Record<WeightUnit, number>> = {
  g: 1,
  kg: 1000,
  lb: 453.59237,
  oz: 28.349523125,
};

/** Decimals shown for a stored weight: enough that typing the shown value back gives the same grams. */
const DISPLAY_DECIMALS: Readonly<Record<WeightUnit, number>> = { g: 0, kg: 3, lb: 3, oz: 3 };

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

function normalize(text: string): string {
  let out = "";
  for (const char of text.trim()) {
    const index = ARABIC_INDIC.indexOf(char);
    if (index >= 0) out += String(index);
    else if (char === "٫") out += ".";
    else if (char === "٬" || char === "," || char === " ") continue;
    else out += char;
  }
  return out;
}

/** A typed weight in `unit` to whole grams; `null` when it is not a non-negative number. */
export function toGrams(text: string, unit: WeightUnit): number | null {
  const normalized = normalize(text);
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const grams = Math.round(Number(normalized) * GRAMS_PER_UNIT[unit]);
  return Number.isSafeInteger(grams) ? grams : null;
}

/** Stored grams to the text an input shows in `unit` ("1.5" kg), without trailing zeros; blank for no weight. */
export function fromGrams(grams: number | null, unit: WeightUnit): string {
  if (grams === null) return "";
  const decimals = DISPLAY_DECIMALS[unit];
  const value = (grams / GRAMS_PER_UNIT[unit]).toFixed(decimals);
  return decimals === 0 ? value : value.replace(/0+$/, "").replace(/\.$/, "");
}
