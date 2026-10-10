import { describe, expect, it } from "vitest";
import {
  addressLines,
  addressForClipboard,
  countryName,
  mapSearchUrl,
  type AddressParts,
} from "./order-address";

const address: AddressParts = {
  recipientName: "Mona Ali",
  phone: "+201012345678",
  line1: "12 Tahrir St",
  line2: "Flat 4",
  city: "Cairo",
  postalCode: "11511",
  country: "EG",
};

describe("countryName", () => {
  it("turns a region code into a name in the page locale", () => {
    expect(countryName("EG", "en")).toBe("Egypt");
    expect(countryName("EG", "ar")).toBe("مصر");
  });

  it("accepts a lower-case code", () => {
    expect(countryName("eg", "en")).toBe("Egypt");
  });

  it("falls back to the raw value for something that is not a region code", () => {
    expect(countryName("Atlantis", "en")).toBe("Atlantis");
    expect(countryName("", "en")).toBe("");
    expect(countryName("XX9", "en")).toBe("XX9");
  });
});

describe("addressLines", () => {
  it("lists the name, street, second line, city with postcode, country name and phone", () => {
    expect(addressLines(address, "en")).toEqual([
      "Mona Ali",
      "12 Tahrir St",
      "Flat 4",
      "Cairo, 11511",
      "Egypt",
      "+201012345678",
    ]);
  });

  it("leaves out what is absent: no blank lines for a missing name, second line, postcode or phone", () => {
    expect(
      addressLines(
        {
          recipientName: null,
          phone: null,
          line1: "12 Tahrir St",
          line2: null,
          city: "Cairo",
          postalCode: "",
          country: "EG",
        },
        "en",
      ),
    ).toEqual(["12 Tahrir St", "Cairo", "Egypt"]);
  });
});

describe("addressForClipboard", () => {
  it("is the same lines, one per row", () => {
    expect(addressForClipboard(address, "en")).toBe(
      "Mona Ali\n12 Tahrir St\nFlat 4\nCairo, 11511\nEgypt\n+201012345678",
    );
  });

  it("uses the Arabic country name on an Arabic page", () => {
    expect(addressForClipboard(address, "ar")).toContain("مصر");
  });
});

describe("mapSearchUrl", () => {
  it("is a Google Maps search for the delivery address — without the person's name or phone", () => {
    const url = new URL(mapSearchUrl(address));

    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/search/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("query")).toBe("12 Tahrir St, Flat 4, Cairo, 11511, Egypt");
    expect(mapSearchUrl(address)).not.toContain("Mona");
    expect(mapSearchUrl(address)).not.toContain("2010");
  });

  it("encodes the query so a street with symbols cannot change the URL", () => {
    const url = new URL(mapSearchUrl({ ...address, line1: "1 A&B St #5?x=1", line2: null }));

    expect(url.searchParams.get("query")).toContain("1 A&B St #5?x=1");
    expect([...url.searchParams.keys()].sort()).toEqual(["api", "query"]);
  });

  it("searches by the English country name whatever the page language, so the map can place it", () => {
    expect(new URL(mapSearchUrl(address)).searchParams.get("query")).toContain("Egypt");
  });
});
