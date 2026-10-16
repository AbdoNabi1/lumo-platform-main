import { describe, expect, it } from "vitest";
import { formatCurrency } from "@/lib/format";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import { describeCondition, formatRatePrice, summarizeCountry } from "./display";

const t = en.shippingSettings;
const ctx = {
  locale: "en",
  currency: "EGP",
  weightUnit: "kg",
  t,
  units: en.productEditor,
} as const;

const money = (minor: number) => formatCurrency("en", minor, "EGP");

describe("describeCondition", () => {
  it("is a dash for a rate with no condition", () => {
    expect(describeCondition({ type: "none" }, ctx)).toBe(t.noCondition);
  });

  it("reads an order price range in the store currency", () => {
    expect(describeCondition({ type: "orderPrice", minMinor: 100_000 }, ctx)).toBe(
      t.andUp.replace("{amount}", money(100_000)),
    );
    expect(describeCondition({ type: "orderPrice", maxMinor: 50_000 }, ctx)).toBe(
      t.upTo.replace("{amount}", money(50_000)),
    );
    expect(describeCondition({ type: "orderPrice", minMinor: 0, maxMinor: 50_000 }, ctx)).toBe(
      t.between.replace("{min}", money(0)).replace("{max}", money(50_000)),
    );
  });

  it("reads a weight range in the store's weight unit, grams converted", () => {
    expect(describeCondition({ type: "weight", minGrams: 0, maxGrams: 5000 }, ctx)).toBe("0–5 kg");
    expect(describeCondition({ type: "weight", minGrams: 5000 }, ctx)).toBe(
      t.andUp.replace("{amount}", "5 kg"),
    );
    expect(describeCondition({ type: "weight", maxGrams: 1500 }, ctx)).toBe(
      t.upTo.replace("{amount}", "1.5 kg"),
    );
    expect(
      describeCondition(
        { type: "weight", minGrams: 0, maxGrams: 500 },
        { ...ctx, weightUnit: "g" },
      ),
    ).toBe("0–500 g");
  });
});

describe("formatRatePrice", () => {
  it('says "Free" for a zero price and shows any other in the store currency', () => {
    expect(formatRatePrice(0, "EGP", "en", t)).toBe(t.free);
    expect(formatRatePrice(5000, "EGP", "en", t)).toBe(money(5000));
  });

  it("says Free in Arabic too", () => {
    expect(formatRatePrice(0, "EGP", "ar", ar.shippingSettings)).toBe(ar.shippingSettings.free);
  });
});

describe("summarizeCountry", () => {
  it("names a whole country, and rest of world", () => {
    expect(summarizeCountry({ code: "SA", provinces: null }, "en", t)).toBe("Saudi Arabia");
    expect(summarizeCountry({ code: "*", provinces: null }, "en", t)).toBe(t.restOfWorld);
  });

  it("counts the governorates of a partly held country", () => {
    expect(summarizeCountry({ code: "EG", provinces: ["EG-C", "EG-GZ"] }, "en", t)).toBe(
      "Egypt (2 of 27 governorates)",
    );
    expect(summarizeCountry({ code: "SA", provinces: ["SA-01"] }, "en", t)).toBe(
      "Saudi Arabia (1 of 13 regions)",
    );
    expect(summarizeCountry({ code: "AE", provinces: ["AE-DU"] }, "en", t)).toBe(
      "United Arab Emirates (1 of 7 emirates)",
    );
  });

  it("uses the interface language for the country name", () => {
    expect(summarizeCountry({ code: "EG", provinces: null }, "ar", ar.shippingSettings)).toBe(
      "مصر",
    );
  });
});
