import { describe, expect, it } from "vitest";
import {
  buildInlineRates,
  chipProvinces,
  parseInlineRates,
  selectionOfProvinces,
} from "./inline-rates";
import type { ZoneDto } from "./zones";

const fields = { name: "Standard", description: "2–4 business days", price: "50" };

describe("buildInlineRates", () => {
  it("is empty when no price was typed, so the zone is created without a rate", () => {
    expect(buildInlineRates({ ...fields, price: "  " }, null, "Free shipping")).toEqual([]);
  });

  it("is the one rate as typed", () => {
    expect(buildInlineRates(fields, null, "Free shipping")).toEqual([fields]);
  });

  it("with a free-over amount, caps the rate there and adds a free one from it", () => {
    expect(buildInlineRates(fields, "1000", "Free shipping")).toEqual([
      { ...fields, max: "1000" },
      { name: "Free shipping", description: fields.description, price: "0", min: "1000" },
    ]);
  });

  it("treats a blank free-over amount as off", () => {
    expect(buildInlineRates(fields, " ", "Free shipping")).toEqual([fields]);
  });
});

describe("parseInlineRates", () => {
  it("reads typed amounts in the store currency into minor units and conditions", () => {
    const raw = JSON.stringify([
      { ...fields, max: "1,000" },
      { name: "Free shipping", description: "", price: "0", min: "1,000" },
    ]);

    expect(parseInlineRates(raw, "EGP")).toEqual({
      ok: true,
      rates: [
        {
          name: "Standard",
          priceMinor: 5000,
          description: "2–4 business days",
          condition: { type: "orderPrice", maxMinor: 100_000 },
        },
        {
          name: "Free shipping",
          priceMinor: 0,
          description: null,
          condition: { type: "orderPrice", minMinor: 100_000 },
        },
      ],
    });
  });

  it("gives a rate with no bounds the 'none' condition", () => {
    const parsed = parseInlineRates(JSON.stringify([fields]), "EGP");

    expect(parsed).toMatchObject({ ok: true, rates: [{ condition: { type: "none" } }] });
  });

  it("is an empty list for an empty list", () => {
    expect(parseInlineRates("[]", "EGP")).toEqual({ ok: true, rates: [] });
  });

  it.each([
    ["not json", "not json", "rates"],
    ["not a list", "{}", "rates"],
    ["an entry that is not an object", JSON.stringify(["x"]), "rates"],
    ["a price that is not a number", JSON.stringify([{ ...fields, price: "abc" }]), "ratePrice"],
    ["a negative price", JSON.stringify([{ ...fields, price: "-1" }]), "ratePrice"],
    ["a bad bound", JSON.stringify([{ ...fields, max: "x" }]), "ratePrice"],
    ["an empty name", JSON.stringify([{ ...fields, name: "  " }]), "rateName"],
    ["a name field that is not text", JSON.stringify([{ ...fields, name: 5 }]), "rates"],
    ["more than twenty rates", JSON.stringify(Array.from({ length: 21 }, () => fields)), "rates"],
  ])("refuses %s, naming the field", (_label, raw, field) => {
    expect(parseInlineRates(raw, "EGP")).toEqual({ ok: false, field });
  });
});

describe("province shortcuts", () => {
  const cairoZone: ZoneDto = {
    id: "z1",
    name: "Cairo",
    profile: "general",
    countries: [{ code: "EG", provinces: ["EG-C"] }],
    rates: [],
  };

  it("keeps the shortcut's provinces that are free", () => {
    expect(chipProvinces(["EG-C", "EG-GZ"], "EG", [], null)).toEqual(["EG-C", "EG-GZ"]);
    expect(chipProvinces(["EG-C", "EG-GZ"], "EG", [cairoZone], null)).toEqual(["EG-GZ"]);
    expect(chipProvinces(["EG-C", "EG-GZ"], "EG", [cairoZone], "z1")).toEqual(["EG-C", "EG-GZ"]);
  });

  it("turns provinces into a selection, collapsing a full set to the whole country", () => {
    const some = selectionOfProvinces("EG", ["EG-C", "EG-GZ"]);

    expect(some["EG"]).toEqual(new Set(["EG-C", "EG-GZ"]));
    expect(
      selectionOfProvinces("AE", ["AE-AZ", "AE-AJ", "AE-DU", "AE-FU", "AE-RK", "AE-SH", "AE-UQ"]),
    ).toEqual({
      AE: "all",
    });
  });
});
