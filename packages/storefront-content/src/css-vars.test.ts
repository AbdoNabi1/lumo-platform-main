import { describe, expect, it } from "vitest";
import { brandStyleSheet, brandToCssVars } from "./css-vars";
import { DEFAULT_THEME_DOCUMENT, readBrandStyle } from "./theme-document";

const defaults = readBrandStyle(DEFAULT_THEME_DOCUMENT.brand);

describe("brandToCssVars", () => {
  it("maps the default brand onto the design system's own values", () => {
    const vars = brandToCssVars(defaults);
    expect(vars["--background"]).toBe("#f8fafc");
    expect(vars["--foreground"]).toBe("#0f172a");
    expect(vars["--primary"]).toBe("#635bff");
    expect(vars["--primary-foreground"]).toBe("#ffffff");
    expect(vars["--brand-accent"]).toBe("#f1f5f9");
    expect(vars["--ring"]).toBe("#635bff");
    expect(vars["--shop-radius-xl"]).toBe("16px");
    expect(vars["--shop-base-size"]).toBe("15px");
    expect(vars).toMatchSnapshot();
  });

  it("derives sensible neighbours for pure black and pure white", () => {
    const dark = brandToCssVars({
      ...defaults,
      colors: { ...defaults.colors, background: "#000000", foreground: "#ffffff" },
    });
    expect(dark["--card"]).not.toBe("#000000");
    expect(dark["--border"]).not.toBe("#000000");
    const light = brandToCssVars({
      ...defaults,
      colors: { ...defaults.colors, background: "#ffffff", foreground: "#000000" },
    });
    expect(light["--card"]).toBe("#ffffff");
    expect(light["--muted-foreground"]).not.toBe("#000000");
  });

  it("square corners zero every radius; pill rounds more", () => {
    expect(brandToCssVars({ ...defaults, corners: "square" })["--shop-radius-3xl"]).toBe("0px");
    expect(brandToCssVars({ ...defaults, corners: "pill" })["--shop-radius-md"]).toBe("16px");
  });

  it("sets heading and body fonts from the key map", () => {
    const vars = brandToCssVars({
      ...defaults,
      typography: { headingFont: "amiri", bodyFont: "cairo", baseSize: "small" },
    });
    expect(vars["--font-heading"]).toMatch(/^"Amiri"/);
    expect(vars["--font-sans"]).toMatch(/^"Cairo"/);
    expect(vars["--font-arabic"]).toBe(vars["--font-sans"]);
    expect(vars["--shop-base-size"]).toBe("14px");
  });
});

describe("brandStyleSheet", () => {
  it.each([
    { colors: { background: "#000000;}</style><script>alert(1)</script>" } },
    { typography: { headingFont: "x;}body{display:none" } },
    "garbage",
    null,
    { corners: "</style>" },
  ])("never lets hostile input through: %j", (raw) => {
    const css = brandStyleSheet(raw);
    expect(css.startsWith(":root:root:root{")).toBe(true);
    expect(css).not.toMatch(/[<]|;\}|script|display:none/);
    expect(css).toContain("--background:#f8fafc");
  });
});
