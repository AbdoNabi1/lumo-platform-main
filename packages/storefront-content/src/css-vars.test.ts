import { describe, expect, it } from "vitest";
import { brandStyleSheet, brandToCssVars } from "./css-vars";
import { FONT_KEYS, fontStack, type FontKey } from "./fonts";
import {
  COLOR_KEYS,
  DEFAULT_THEME_DOCUMENT,
  readBrandStyle,
  type BrandStyle,
} from "./theme-document";

const defaults = readBrandStyle(DEFAULT_THEME_DOCUMENT.brand);

describe("brandToCssVars", () => {
  it("maps the default brand onto the design system's own values", () => {
    const vars = brandToCssVars(defaults);
    expect(vars["--background"]).toBe("#fcf8f3");
    expect(vars["--foreground"]).toBe("#212529");
    expect(vars["--primary"]).toBe("#b8451d");
    expect(vars["--primary-foreground"]).toBe("#ffffff");
    expect(vars["--brand-accent"]).toBe("#f3e9de");
    expect(vars["--ring"]).toBe("#b8451d");
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

const HOSTILE = [
  "red;}",
  "#000000;}</style><script>alert(1)</script>",
  "url(javascript:alert(1))",
  "expression(1)",
  "#ff0000\n",
  "var(--x)",
  "＃ffffff",
  "#fff",
  "#12345g",
  "__proto__",
  "constructor",
  "x;}body{display:none",
  "</style>",
  42,
  null,
];
const FIXED_STACKS = FONT_KEYS.map(fontStack);
const isSafeValue = (value: string): boolean =>
  /^#[0-9a-f]{6}$/.test(value) || /^[0-9]+px$/.test(value) || FIXED_STACKS.includes(value);

/** Every declaration of the sheet must be `--name:value` with a value from the fixed grammar. */
function assertSafeSheet(css: string): void {
  expect(css.startsWith(":root:root:root{")).toBe(true);
  expect(css.endsWith("}")).toBe(true);
  const declarations = css.slice(":root:root:root{".length, -1).split(";");
  expect(declarations.length).toBeGreaterThan(30);
  for (const declaration of declarations) {
    const [, name, value] = /^(--[a-z0-9-]+):(.*)$/.exec(declaration) ?? [];
    expect(name, declaration).toBeDefined();
    expect(isSafeValue(value ?? ""), declaration).toBe(true);
  }
}

describe("brandStyleSheet", () => {
  const valid = DEFAULT_THEME_DOCUMENT.brand;
  const rows: [string, unknown][] = [];
  for (const key of COLOR_KEYS)
    for (const value of HOSTILE)
      rows.push([
        `colors.${key}=${JSON.stringify(value)}`,
        { ...valid, colors: { ...valid.colors, [key]: value } },
      ]);
  for (const key of ["headingFont", "bodyFont", "baseSize"])
    for (const value of HOSTILE)
      rows.push([
        `typography.${key}=${JSON.stringify(value)}`,
        { ...valid, typography: { ...valid.typography, [key]: value } },
      ]);
  for (const value of HOSTILE)
    rows.push([`corners=${JSON.stringify(value)}`, { ...valid, corners: value }]);
  for (const value of ["garbage", null, undefined, 7, [], {}])
    rows.push([`brand=${JSON.stringify(value)}`, value]);

  it.each(rows)(
    "a full valid brand with one hostile field (%s) emits only fixed-grammar values",
    (_label, raw) => {
      const css = brandStyleSheet(raw);
      assertSafeSheet(css);
      for (const bad of ["<", ">", ";}", "script", "display:none", "url(", "expression"])
        expect(css).not.toContain(bad);
      // The hostile field's whole group falls back to the defaults.
      expect(css).toContain("--ring:#b8451d");
      expect(css).toContain("--background:#fcf8f3");
    },
  );

  it("keeps a valid brand's own values", () => {
    const css = brandStyleSheet({ ...valid, colors: { ...valid.colors, primary: "#AA00FF" } });
    assertSafeSheet(css);
    expect(css).toContain("--primary:#aa00ff");
  });
});

describe("brandToCssVars called directly with unvalidated input", () => {
  it("still emits only fixed-grammar values", () => {
    const vars = brandToCssVars({
      colors: { ...defaults.colors, primary: "red;}" },
      typography: { headingFont: "constructor", bodyFont: "cairo", baseSize: "huge" },
      corners: "</style>",
    } as unknown as BrandStyle);
    for (const [name, value] of Object.entries(vars)) expect(isSafeValue(value), name).toBe(true);
  });

  it("fontStack never reads inherited properties", () => {
    expect(fontStack("constructor" as FontKey)).toBe(fontStack("ibm-plex-sans-arabic"));
  });
});
