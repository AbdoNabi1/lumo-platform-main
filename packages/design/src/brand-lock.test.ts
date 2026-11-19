/**
 * LOCKED BY OWNER (2026-11-19). Changing any value here requires an explicit owner order.
 * See docs/ui/BRAND_LOCK.md.
 *
 * Morbeh's brand is "Nusuj — Warm Weave". This file pins the exact primitives, the full
 * semantic map (all 45 keys, both themes), radii, font stacks, and proves `styles.css` and the
 * TypeScript tokens hold identical values. A drift in either file fails here.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import * as design from "./index";
import {
  brand,
  elevation,
  neutral,
  night,
  onPrimaryInk,
  primary,
  radius,
  status,
  typography,
} from "./primitives";
import { colors, type SemanticColors } from "./semantic";

beforeEach(() => expect.hasAssertions());

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

/* ------------------------------------------------------------------ 1. Primitives */

const PRIMITIVES: ReadonlyArray<readonly [string, string]> = [
  ["primary.50", "#fdf3ee"],
  ["primary.100", "#fae4d8"],
  ["primary.200", "#f5c9b4"],
  ["primary.300", "#f5916e"],
  ["primary.400", "#ef7b52"],
  ["primary.500", "#b8451d"],
  ["primary.600", "#9a3714"],
  ["primary.700", "#7e2d10"],
  ["primary.800", "#64240d"],
  ["primary.900", "#4c1c0b"],
  ["primary.950", "#3a1c10"],
  ["neutral.0", "#ffffff"],
  ["neutral.50", "#fcf8f3"],
  ["neutral.100", "#f3e9de"],
  ["neutral.200", "#e8ded3"],
  ["neutral.300", "#d5c8ba"],
  ["neutral.400", "#a1968b"],
  ["neutral.500", "#8a7f75"],
  ["neutral.600", "#5d636a"],
  ["neutral.700", "#3f3a36"],
  ["neutral.800", "#2b2724"],
  ["neutral.900", "#212529"],
  ["neutral.950", "#141210"],
  ["night.50", "#faf6f2"],
  ["night.300", "#d3c9bf"],
  ["night.400", "#b5aca3"],
  ["night.500", "#8c8279"],
  ["night.700", "#3f3832"],
  ["night.800", "#342e29"],
  ["night.850", "#29231e"],
  ["night.900", "#1e1b18"],
  ["night.950", "#141210"],
  ["brand.light.secondary", "#4c362e"],
  ["brand.light.iconAccent", "#f9d5c6"],
  ["brand.dark.secondary", "#dec8b4"],
  ["brand.dark.iconAccent", "#f9d5c6"],
  ["onPrimaryInk", "#1a1512"],
  ["status.light.success.primary", "#1f8a57"],
  ["status.light.success.soft", "#ebf7f0"],
  ["status.light.success.strong", "#1a6e47"],
  ["status.light.warning.primary", "#c77a0a"],
  ["status.light.warning.soft", "#fef4e5"],
  ["status.light.warning.strong", "#8e5005"],
  ["status.light.error.primary", "#c0263a"],
  ["status.light.error.soft", "#fcebec"],
  ["status.light.error.strong", "#9b1c2e"],
  ["status.light.info.primary", "#3a6ea5"],
  ["status.light.info.soft", "#edf4fa"],
  ["status.light.info.strong", "#2f5882"],
  ["status.dark.success.primary", "#2fa36b"],
  ["status.dark.success.soft", "#142b20"],
  ["status.dark.success.strong", "#5bd998"],
  ["status.dark.warning.primary", "#d9901c"],
  ["status.dark.warning.soft", "#2c2111"],
  ["status.dark.warning.strong", "#f3b753"],
  ["status.dark.error.primary", "#e5484d"],
  ["status.dark.error.soft", "#3a1518"],
  ["status.dark.error.strong", "#ff8a8f"],
  ["status.dark.info.primary", "#4a86c5"],
  ["status.dark.info.soft", "#162331"],
  ["status.dark.info.strong", "#83b5e8"],
];

const primitiveRoot = { primary, neutral, night, brand, onPrimaryInk, status } as Record<
  string,
  unknown
>;

function lookup(path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[key];
  }, primitiveRoot);
}

describe("locked primitives", () => {
  it.each(PRIMITIVES)("%s is %s", (path, value) => {
    expect(lookup(path)).toBe(value);
  });

  it("exports the new Nusuj scales from the package entry", () => {
    expect(design.night).toBe(night);
    expect(design.brand).toBe(brand);
    expect(design.onPrimaryInk).toBe("#1a1512");
  });

  it("locks the light elevation ink and brand-tinted card shadows", () => {
    expect(elevation.light.sm).toBe("0 1px 2px 0 rgb(33 29 26 / 0.04)");
    expect(elevation.light.md).toBe(
      "0 2px 4px -1px rgb(33 29 26 / 0.06), 0 4px 8px -2px rgb(33 29 26 / 0.06)",
    );
    expect(elevation.light.lg).toBe(
      "0 4px 8px -2px rgb(33 29 26 / 0.06), 0 12px 24px -4px rgb(33 29 26 / 0.08)",
    );
    expect(elevation.light.xl).toBe(
      "0 8px 16px -4px rgb(33 29 26 / 0.08), 0 24px 48px -8px rgb(33 29 26 / 0.12)",
    );
    expect(elevation.light.card).toBe(
      "0 1px 2px 0 rgb(184 69 29 / 0.05), 0 12px 28px -8px rgb(76 54 46 / 0.10)",
    );
    expect(elevation.light.cardHover).toBe(
      "0 2px 4px 0 rgb(184 69 29 / 0.07), 0 16px 36px -8px rgb(76 54 46 / 0.16)",
    );
  });
});

/* ------------------------------------------------------------- 2. Semantic, both themes */

const LIGHT: Record<string, string> = {
  background: "#fcf8f3",
  foreground: "#212529",
  card: "#ffffff",
  cardForeground: "#212529",
  popover: "#ffffff",
  popoverForeground: "#212529",
  surface: "#f3e9de",
  surfaceForeground: "#212529",
  muted: "#f3e9de",
  mutedForeground: "#5d636a",
  subtleForeground: "#a1968b",
  secondary: "#f3e9de",
  secondaryForeground: "#3f3a36",
  accent: "#f3e9de",
  accentForeground: "#212529",
  border: "#e8ded3",
  borderStrong: "#d5c8ba",
  input: "#8a7f75",
  ring: "#b8451d",
  primary: "#b8451d",
  primaryForeground: "#ffffff",
  primaryHover: "#9a3714",
  primaryActive: "#7e2d10",
  primarySubtle: "#fae4d8",
  primarySubtleForeground: "#7e2d10",
  success: "#1f8a57",
  successSubtle: "#ebf7f0",
  successForeground: "#1a6e47",
  warning: "#c77a0a",
  warningSubtle: "#fef4e5",
  warningForeground: "#8e5005",
  destructive: "#c0263a",
  destructiveForeground: "#ffffff",
  destructiveSubtle: "#fcebec",
  destructiveSubtleForeground: "#9b1c2e",
  info: "#3a6ea5",
  infoSubtle: "#edf4fa",
  infoForeground: "#2f5882",
  chart1: "#b8451d",
  chart2: "#8a7f75",
  chart3: "#3a6ea5",
  chart4: "#c77a0a",
  chart5: "#1f8a57",
  brandSecondary: "#4c362e",
  brandIconAccent: "#f9d5c6",
};

const DARK: Record<string, string> = {
  background: "#141210",
  foreground: "#faf6f2",
  card: "#1e1b18",
  cardForeground: "#faf6f2",
  popover: "#29231e",
  popoverForeground: "#faf6f2",
  surface: "#29231e",
  surfaceForeground: "#faf6f2",
  muted: "#29231e",
  mutedForeground: "#b5aca3",
  subtleForeground: "#8c8279",
  secondary: "#29231e",
  secondaryForeground: "#d3c9bf",
  accent: "#29231e",
  accentForeground: "#faf6f2",
  border: "#342e29",
  borderStrong: "#3f3832",
  input: "#8c8279",
  ring: "#ef7b52",
  primary: "#ef7b52",
  primaryForeground: "#1a1512",
  primaryHover: "#f5916e",
  primaryActive: "#f5c9b4",
  primarySubtle: "#3a1c10",
  primarySubtleForeground: "#f5916e",
  success: "#2fa36b",
  successSubtle: "#142b20",
  successForeground: "#5bd998",
  warning: "#d9901c",
  warningSubtle: "#2c2111",
  warningForeground: "#f3b753",
  destructive: "#e5484d",
  destructiveForeground: "#1a1512",
  destructiveSubtle: "#3a1518",
  destructiveSubtleForeground: "#ff8a8f",
  info: "#4a86c5",
  infoSubtle: "#162331",
  infoForeground: "#83b5e8",
  chart1: "#ef7b52",
  chart2: "#b5aca3",
  chart3: "#83b5e8",
  chart4: "#f3b753",
  chart5: "#5bd998",
  brandSecondary: "#dec8b4",
  brandIconAccent: "#f9d5c6",
};

describe("locked semantic tokens (TypeScript)", () => {
  it.each([
    ["light", colors.light, LIGHT],
    ["dark", colors.dark, DARK],
  ] as const)("the %s theme has exactly the 45 locked values", (_name, actual, expected) => {
    expect(Object.keys(actual as SemanticColors)).toHaveLength(45);
    expect(Object.keys(expected)).toHaveLength(45);
    expect({ ...actual }).toEqual(expected);
  });
});

/* ----------------------------------------------- 3. Radius, typography, CSS parity */

describe("locked radius and typography", () => {
  it("pins every radius step", () => {
    expect(radius).toEqual({
      xs: "4px",
      sm: "6px",
      md: "8px",
      lg: "12px",
      xl: "16px",
      "2xl": "22px",
      "3xl": "28px",
      full: "9999px",
    });
    expect(radius["2xl"]).toBe("22px");
  });

  it("pins the three font stacks exactly", () => {
    expect(typography.fontSans).toBe(
      'var(--font-latin, "Plus Jakarta Sans"), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    );
    expect(typography.fontArabic).toBe(
      'var(--font-arabic-family, "Zain"), var(--font-latin, "Plus Jakarta Sans"), ui-sans-serif, system-ui, sans-serif',
    );
    expect(typography.fontDisplay).toBe(
      'var(--font-display-family, "Baloo Bhaijaan 2"), var(--font-latin, "Plus Jakarta Sans"), ui-sans-serif, system-ui, sans-serif',
    );
    expect(typography.fontSans).toContain("Plus Jakarta Sans");
    expect(typography.fontArabic).toContain("Zain");
    expect(typography.fontDisplay).toContain("Baloo Bhaijaan 2");
  });
});

/** Strip comments so `;` / `{` inside prose never confuse the parser. */
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1]!, match[2]!.replace(/\s+/g, " ").trim());
  }
  return map;
}

function blockOf(selector: RegExp): string {
  const match = selector.exec(cssNoComments);
  if (!match) throw new Error(`styles.css has no block matching ${selector}`);
  return match[1]!;
}

const rootRaw = declarations(blockOf(/^:root\s*\{([\s\S]*?)^\}/m));
const darkRaw = declarations(blockOf(/^\.dark\s*\{([\s\S]*?)^\}/m));

function cssName(key: string): string {
  return `--${key
    .replace(/([A-Z])/g, "-$1")
    .replace(/([a-z])(\d+)/g, "$1-$2")
    .toLowerCase()}`;
}

function resolve(name: string, map: Map<string, string>): string {
  let value = map.get(name);
  if (value === undefined) throw new Error(`no CSS declaration for ${name}`);
  for (let depth = 0; depth < 5; depth += 1) {
    const ref = /^var\((--[\w-]+)\)$/.exec(value);
    if (!ref) break;
    const next = map.get(ref[1]!);
    if (next === undefined) throw new Error(`${name} -> ${ref[1]} is not declared`);
    value = next;
  }
  if (/var\(/.test(value)) throw new Error(`${name} still holds an unresolved var(): ${value}`);
  if (!/^#[0-9a-f]{6}$/.test(value)) throw new Error(`${name} did not resolve to a hex: ${value}`);
  return value;
}

describe("styles.css ↔ TypeScript parity", () => {
  const lightMap = new Map(rootRaw);
  const darkMap = new Map([...rootRaw, ...darkRaw]);

  it.each([
    ["light", lightMap, colors.light],
    ["dark", darkMap, colors.dark],
  ] as const)("every %s semantic token resolves to the same hex in CSS and TS", (_n, map, ts) => {
    const keys = Object.keys(ts);
    expect(keys).toHaveLength(45);
    const mismatches: string[] = [];
    for (const key of keys) {
      const name = cssName(key);
      let resolved: string;
      try {
        resolved = resolve(name, map);
      } catch (error) {
        mismatches.push(`${key}: ${(error as Error).message}`);
        continue;
      }
      const expected = (ts as Record<string, string>)[key]!.toLowerCase();
      if (resolved !== expected)
        mismatches.push(`${key} (${name}): css ${resolved} ≠ ts ${expected}`);
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });

  it("dark --success-subtle is inherited from :root and resolves against the .dark primitive", () => {
    expect(rootRaw.get("--success-subtle")).toBe("var(--lumo-success-soft)");
    expect(resolve("--success-subtle", darkMap)).toBe("#142b20");
  });

  it("light --chart-1 resolves to the terracotta brand colour", () => {
    expect(resolve("--chart-1", lightMap)).toBe("#b8451d");
  });

  it("the CSS primitive ramps mirror the TS ramps", () => {
    const ramps = { primary, neutral, night } as const;
    const mismatches: string[] = [];
    for (const [scale, steps] of Object.entries(ramps)) {
      for (const [step, hex] of Object.entries(steps)) {
        const name = `--lumo-${scale}-${step}`;
        if (rootRaw.get(name) !== hex)
          mismatches.push(`${name}: css ${rootRaw.get(name)} ≠ ts ${hex}`);
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
    expect(rootRaw.get("--lumo-on-primary-ink")).toBe(onPrimaryInk);
  });

  it("the CSS shadows mirror the TS light elevation", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["--lumo-shadow-sm", elevation.light.sm],
      ["--lumo-shadow-md", elevation.light.md],
      ["--lumo-shadow-lg", elevation.light.lg],
      ["--lumo-shadow-xl", elevation.light.xl],
      ["--lumo-shadow-card", elevation.light.card],
      ["--lumo-shadow-card-hover", elevation.light.cardHover],
    ];
    // `0.10` and `0.1` are the same alpha (prettier trims the zero in CSS): normalise it.
    const normalise = (value: string | undefined) =>
      (value ?? "").replace(/\s+/g, " ").replace(/\b0\.(\d)0\b/g, "0.$1");
    for (const [name, ts] of pairs) {
      expect(normalise(rootRaw.get(name)), name).toBe(normalise(ts));
    }
  });

  it("renames the canvas glows to warm/sand", () => {
    expect(rootRaw.has("--lumo-glow-warm")).toBe(true);
    expect(rootRaw.has("--lumo-glow-sand")).toBe(true);
    expect(darkRaw.has("--lumo-glow-warm")).toBe(true);
    expect(darkRaw.has("--lumo-glow-sand")).toBe(true);
    expect(css).not.toContain("--lumo-glow-purple");
    expect(css).not.toContain("--lumo-glow-blue");
  });

  it("pins every radius in @theme inline", () => {
    const themeStart = cssNoComments.indexOf("@theme inline");
    expect(themeStart).toBeGreaterThan(-1);
    const theme = cssNoComments.slice(themeStart);
    const expected: Record<string, string> = {
      xs: "4px",
      sm: "6px",
      md: "8px",
      lg: "12px",
      xl: "16px",
      "2xl": "22px",
      "3xl": "28px",
    };
    for (const [step, value] of Object.entries(expected)) {
      expect(theme, `--radius-${step}`).toContain(`--radius-${step}: ${value};`);
    }
    expect(theme).toContain("--radius-2xl: 22px;");
  });

  it("exposes the font and brand utilities in @theme inline", () => {
    const theme = cssNoComments.slice(cssNoComments.indexOf("@theme inline"));
    expect(theme).toContain("--font-display: var(--font-display);");
    expect(theme).toContain("--color-brand-secondary: var(--brand-secondary);");
    expect(theme).toContain("--color-brand-icon-accent: var(--brand-icon-accent);");
  });

  it("the CSS font tokens carry the same families and slot variables as TS", () => {
    const sans = rootRaw.get("--font-sans") ?? "";
    const arabic = rootRaw.get("--font-arabic") ?? "";
    const display = rootRaw.get("--font-display") ?? "";
    expect(sans).toContain('var(--font-latin, "Plus Jakarta Sans")');
    expect(arabic).toContain('var(--font-arabic-family, "Zain")');
    expect(arabic).toContain('var(--font-latin, "Plus Jakarta Sans")');
    expect(display).toContain('var(--font-display-family, "Baloo Bhaijaan 2")');
    // Display stays Baloo (it has Arabic glyphs): the :root:lang(ar) swap must not touch it.
    const arabicSwap = /^:root:lang\(ar\)\s*\{([\s\S]*?)^\}/m.exec(cssNoComments)?.[1] ?? "";
    expect(arabicSwap).toContain("--font-sans: var(--font-arabic);");
    expect(arabicSwap).not.toContain("--font-display");
  });
});
