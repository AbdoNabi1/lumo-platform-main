import { describe, expect, it } from "vitest";
import { checkBrandContrast } from "./contrast-rules";
import { DEFAULT_THEME_DOCUMENT } from "./theme-document";

const base = DEFAULT_THEME_DOCUMENT.brand.colors;

describe("checkBrandContrast", () => {
  it("passes the default palette with no warnings", () => {
    expect(checkBrandContrast(base)).toEqual({ blocking: [], warnings: [] });
  });

  it("blocks body text below 3:1 and only warns between 3:1 and 4.5:1", () => {
    const blocked = checkBrandContrast({ ...base, background: "#ffffff", foreground: "#cccccc" });
    expect(blocked.blocking).toEqual([
      { path: "brand.colors.foreground", code: "CONTRAST_TOO_LOW" },
    ]);
    const warned = checkBrandContrast({ ...base, background: "#ffffff", foreground: "#888888" });
    expect(warned.blocking).toEqual([]);
    expect(warned.warnings).toEqual([{ pair: "foreground", ratio: 3.54, minimum: 4.5 }]);
  });

  it("only warns for button and accent pairs, never blocks", () => {
    const result = checkBrandContrast({
      ...base,
      primary: "#ffff00",
      primaryForeground: "#ffffff",
      accent: "#000000",
      accentForeground: "#111111",
    });
    expect(result.blocking).toEqual([]);
    expect(result.warnings.map((w) => w.pair)).toEqual(["primaryForeground", "accentForeground"]);
  });
});
