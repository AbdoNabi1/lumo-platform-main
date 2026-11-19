import { describe, expect, it } from "vitest";
import { FONT_FAMILIES, FONT_KEYS, fontStack } from "./fonts";

describe("fonts", () => {
  it("maps every key to a fixed family, and nothing else", () => {
    expect([...FONT_KEYS].sort()).toEqual(Object.keys(FONT_FAMILIES).sort());
    expect(FONT_KEYS).toEqual([
      "ibm-plex-sans-arabic",
      "cairo",
      "tajawal",
      "almarai",
      "readex-pro",
      "amiri",
    ]);
  });

  it("builds a stack from the map only, with the platform fallbacks after it", () => {
    expect(fontStack("cairo")).toBe(
      '"Cairo", "IBM Plex Sans Arabic", var(--font-geist, "Geist"), ui-sans-serif, system-ui, sans-serif',
    );
    for (const key of FONT_KEYS) expect(fontStack(key)).not.toMatch(/[<>;{}]/);
  });
});
