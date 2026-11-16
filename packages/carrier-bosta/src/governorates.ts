import { PROVINCES } from "@platform/regions";

export interface BostaCity {
  readonly _id: string;
  readonly name: string;
  readonly nameAr?: string;
  readonly alias?: string;
  readonly code?: string;
  readonly dropOffAvailability?: boolean;
}

export const BOSTA_ENGLISH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "EG-KFS": ["kafr alsheikh", "kafr el-sheikh"],
  "EG-MNF": ["menofia", "monofia"],
  "EG-SHR": ["sharkia", "sharqia", "el sharqia"],
  "EG-KB": ["qalyubia", "kalyubia"],
  "EG-BH": ["behira", "beheira"],
  "EG-BNS": ["bani suif", "beni suef"],
  "EG-FYM": ["fayoum", "faiyum"],
  "EG-PTS": ["port said"],
  "EG-JS": ["south sinai"],
  "EG-SIN": ["north sinai"],
  "EG-WAD": ["new valley", "el wadi el gedid"],
};

export function normalizeArabic(value: string): string {
  return value.replace(/[ـ\s]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
}

export function matchBostaCity(
  provinceIso: string,
  cities: readonly BostaCity[],
): BostaCity | null {
  const province = PROVINCES.EG?.find((candidate) => candidate.code === provinceIso);
  if (!province) return null;
  const available = cities.filter((city) => city.dropOffAvailability !== false);
  const arabic = normalizeArabic(province.ar);
  const match = available.find(
    (city) => city.nameAr !== undefined && normalizeArabic(city.nameAr) === arabic,
  );
  if (match) return match;
  const candidates = new Set([
    province.en.toLowerCase(),
    ...(BOSTA_ENGLISH_ALIASES[provinceIso] ?? []),
  ]);
  return (
    available.find(
      (city) =>
        candidates.has(city.name.toLowerCase()) ||
        (city.alias !== undefined && candidates.has(city.alias.toLowerCase())),
    ) ?? null
  );
}
