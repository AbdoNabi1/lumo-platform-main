import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import { colors, type SemanticColors } from "./semantic";

/**
 * The Morbeh palette's accessibility guarantees, asserted rather than claimed.
 *
 * Every pair below is one a real Morbeh surface puts on screen. If a token value changes and
 * a pair drops under its WCAG 2.1 AA threshold, this fails — which is the point: the
 * palette is not free to drift.
 */

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

interface Pair {
  readonly name: string;
  readonly fg: (t: SemanticColors) => string;
  readonly bg: (t: SemanticColors) => string;
  readonly min: number;
}

/** Text pairs — WCAG 1.4.3, 4.5:1. */
const textPairs: readonly Pair[] = [
  { name: "body text on canvas", fg: (t) => t.foreground, bg: (t) => t.background, min: AA_TEXT },
  { name: "body text on card", fg: (t) => t.cardForeground, bg: (t) => t.card, min: AA_TEXT },
  {
    name: "body text on popover",
    fg: (t) => t.popoverForeground,
    bg: (t) => t.popover,
    min: AA_TEXT,
  },
  {
    name: "body text on recessed surface",
    fg: (t) => t.surfaceForeground,
    bg: (t) => t.surface,
    min: AA_TEXT,
  },
  { name: "muted text on card", fg: (t) => t.mutedForeground, bg: (t) => t.card, min: AA_TEXT },
  {
    name: "muted text on canvas",
    fg: (t) => t.mutedForeground,
    bg: (t) => t.background,
    min: AA_TEXT,
  },
  {
    name: "secondary text on secondary fill",
    fg: (t) => t.secondaryForeground,
    bg: (t) => t.secondary,
    min: AA_TEXT,
  },
  {
    name: "accent text on accent wash (nav hover, table row hover)",
    fg: (t) => t.accentForeground,
    bg: (t) => t.accent,
    min: AA_TEXT,
  },
  {
    name: "primary button label",
    fg: (t) => t.primaryForeground,
    bg: (t) => t.primary,
    min: AA_TEXT,
  },
  {
    name: "primary button label (hover)",
    fg: (t) => t.primaryForeground,
    bg: (t) => t.primaryHover,
    min: AA_TEXT,
  },
  {
    name: "primary button label (active)",
    fg: (t) => t.primaryForeground,
    bg: (t) => t.primaryActive,
    min: AA_TEXT,
  },
  {
    name: "primary text on primary wash (active nav item, accent badge)",
    fg: (t) => t.primarySubtleForeground,
    bg: (t) => t.primarySubtle,
    min: AA_TEXT,
  },
  {
    name: "destructive button label",
    fg: (t) => t.destructiveForeground,
    bg: (t) => t.destructive,
    min: AA_TEXT,
  },
  {
    name: "success badge",
    fg: (t) => t.successForeground,
    bg: (t) => t.successSubtle,
    min: AA_TEXT,
  },
  {
    name: "warning badge",
    fg: (t) => t.warningForeground,
    bg: (t) => t.warningSubtle,
    min: AA_TEXT,
  },
  {
    name: "destructive badge",
    fg: (t) => t.destructiveSubtleForeground,
    bg: (t) => t.destructiveSubtle,
    min: AA_TEXT,
  },
  { name: "info badge", fg: (t) => t.infoForeground, bg: (t) => t.infoSubtle, min: AA_TEXT },
];

/** Non-text pairs — WCAG 1.4.11, 3:1: control boundaries, focus, chart marks. */
const nonTextPairs: readonly Pair[] = [
  {
    name: "input border on card",
    fg: (t) => t.input,
    bg: (t) => t.card,
    min: AA_NON_TEXT,
  },
  {
    name: "input border on canvas",
    fg: (t) => t.input,
    bg: (t) => t.background,
    min: AA_NON_TEXT,
  },
  { name: "focus ring on card", fg: (t) => t.ring, bg: (t) => t.card, min: AA_NON_TEXT },
  { name: "focus ring on canvas", fg: (t) => t.ring, bg: (t) => t.background, min: AA_NON_TEXT },
  { name: "chart series 1 on card", fg: (t) => t.chart1, bg: (t) => t.card, min: AA_NON_TEXT },
  { name: "chart series 2 on card", fg: (t) => t.chart2, bg: (t) => t.card, min: AA_NON_TEXT },
  { name: "chart series 3 on card", fg: (t) => t.chart3, bg: (t) => t.card, min: AA_NON_TEXT },
  { name: "chart series 4 on card", fg: (t) => t.chart4, bg: (t) => t.card, min: AA_NON_TEXT },
  { name: "chart series 5 on card", fg: (t) => t.chart5, bg: (t) => t.card, min: AA_NON_TEXT },
];

describe.each([
  ["light", colors.light],
  ["dark", colors.dark],
] as const)("Morbeh %s theme", (_theme, tokens) => {
  it.each(textPairs)("$name clears WCAG AA for text", ({ fg, bg, min }) => {
    expect(contrastRatio(fg(tokens), bg(tokens))).toBeGreaterThanOrEqual(min);
  });

  it.each(nonTextPairs)("$name clears WCAG AA for non-text", ({ fg, bg, min }) => {
    expect(contrastRatio(fg(tokens), bg(tokens))).toBeGreaterThanOrEqual(min);
  });

  it("keeps chart series distinguishable from one another", () => {
    const series = [tokens.chart1, tokens.chart2, tokens.chart3, tokens.chart4, tokens.chart5];
    expect(new Set(series).size).toBe(series.length);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for a colour against itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#635bff", "#635bff")).toBeCloseTo(1, 5);
  });

  it("is symmetric and accepts shorthand hex", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(contrastRatio("#000", "#fff"), 10);
  });

  it("rejects values that are not hex colours", () => {
    expect(() => contrastRatio("rebeccapurple", "#ffffff")).toThrow(/hex colour/);
  });
});
