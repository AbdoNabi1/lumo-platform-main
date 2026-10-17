import { describe, expect, it } from "vitest";
import { deriveSlugBase } from "./slug";

const rnd = () => "k3x9qa";
describe("deriveSlugBase", () => {
  it("lower-cases and hyphenates Latin names", () => {
    expect(deriveSlugBase("  My Cool Shop!! ", rnd)).toBe("my-cool-shop");
  });
  it("strips accents", () => {
    expect(deriveSlugBase("Café Délice", rnd)).toBe("cafe-delice");
  });
  it("falls back to store-<random> for Arabic or symbol-only names", () => {
    expect(deriveSlugBase("متجر الأمل", rnd)).toBe("store-k3x9qa");
    expect(deriveSlugBase("!!!", rnd)).toBe("store-k3x9qa");
  });
  it("keeps Latin parts of a mixed name", () => {
    expect(deriveSlugBase("Nour نور Store", rnd)).toBe("nour-store");
  });
  it("caps the length at 40 without a trailing hyphen", () => {
    const slug = deriveSlugBase("a".repeat(30) + " " + "b".repeat(30), rnd);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});
