import { PROVINCES } from "@platform/regions";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BOSTA_ENGLISH_ALIASES,
  matchBostaCity,
  normalizeArabic,
  type BostaCity,
} from "./governorates";

beforeEach(() => {
  expect.hasAssertions();
});

describe("Bosta governorates", () => {
  it("normalizes Arabic variants, tatweel and whitespace", () => {
    expect(normalizeArabic(" إ  أآـة ى ")).toBe("اااهي");
  });
  it("matches by Arabic first, then English alias and skips unavailable cities", () => {
    const cities: BostaCity[] = [
      { _id: "english", name: "Cairo" },
      {
        _id: "FceDyHXwpSYYF9zGW",
        name: "Cairo",
        nameAr: "القاهرة",
        code: "EG-01",
        dropOffAvailability: true,
      },
      {
        _id: "Jrb6X6ucjiYgMP4T7",
        name: "Alexandria",
        nameAr: "الإسكندرية",
        code: "EG-02",
        dropOffAvailability: true,
      },
      {
        _id: "modelled-kfs",
        name: "Kafr Alsheikh",
        nameAr: "كفر الشيخ",
        dropOffAvailability: true,
      },
      { _id: "modelled-red", name: "Red Sea", nameAr: "البحر الاحمر", dropOffAvailability: false },
    ];
    expect(matchBostaCity("EG-C", cities)?._id).toBe("FceDyHXwpSYYF9zGW");
    expect(matchBostaCity("EG-ALX", cities)?._id).toBe("Jrb6X6ucjiYgMP4T7");
    expect(matchBostaCity("EG-KFS", cities)?._id).toBe("modelled-kfs");
    expect(matchBostaCity("EG-BA", cities)).toBeNull();
    expect(matchBostaCity("EG-SUZ", cities)).toBeNull();
    expect(matchBostaCity("EG-unknown", cities)).toBeNull();
    expect(matchBostaCity("EG-MNF", [{ _id: "alias", name: "Other", alias: "Monofia" }])?._id).toBe(
      "alias",
    );
  });
  it("every one of the 27 EG provinces has Arabic and English candidates", () => {
    expect(PROVINCES.EG).toHaveLength(27);
    for (const province of PROVINCES.EG ?? []) {
      expect(
        matchBostaCity(province.code, [
          { _id: province.code, name: "unmatched", nameAr: province.ar },
        ])?._id,
      ).toBe(province.code);
      expect(
        matchBostaCity(province.code, [{ _id: province.code, name: province.en.toUpperCase() }])
          ?._id,
      ).toBe(province.code);
      for (const alias of BOSTA_ENGLISH_ALIASES[province.code] ?? []) {
        expect(matchBostaCity(province.code, [{ _id: alias, name: alias }])?._id).toBe(alias);
      }
    }
  });
});
