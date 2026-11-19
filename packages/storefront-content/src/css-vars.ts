import { contrastRatio } from "@platform/design";
import { mixHex, type HexColor } from "./color";
import { fontStack } from "./fonts";
import { readBrandStyle, type BaseSize, type BrandStyle, type CornerStyle } from "./theme-document";

export const BASE_SIZE_PX: Readonly<Record<BaseSize, number>> = {
  small: 14,
  medium: 15,
  large: 16,
};

const STEPS = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;
export const RADIUS_SCALES: Readonly<Record<CornerStyle, readonly number[]>> = {
  square: [0, 0, 0, 0, 0, 0, 0],
  rounded: [4, 6, 8, 12, 16, 20, 28],
  pill: [8, 12, 16, 20, 24, 28, 32],
};

const WHITE: HexColor = "#ffffff";
const BLACK: HexColor = "#000000";

/**
 * Spec 1.3 "Derived tokens": every semantic var the storefront paints with, computed from the six
 * colours, the fonts, the size and the corners. Values are hex, px or fixed font stacks only.
 */
export function brandToCssVars(input: BrandStyle): Readonly<Record<string, string>> {
  // Re-read, so a caller that skipped validation still only ever gets hex, px and fixed font stacks.
  const style = readBrandStyle(input);
  const {
    background: bg,
    foreground: fg,
    primary,
    primaryForeground,
    accent,
    accentForeground,
  } = style.colors;
  // A light canvas lifts its cards towards white; a dark one lifts them towards the text colour.
  const darkCanvas = contrastRatio(bg, WHITE) > contrastRatio(bg, BLACK);
  const card = darkCanvas ? mixHex(bg, fg, 0.08) : mixHex(bg, WHITE, 0.75);
  const vars: Record<string, string> = {
    "--background": bg,
    "--foreground": fg,
    "--card": card,
    "--card-foreground": fg,
    "--popover": card,
    "--popover-foreground": fg,
    "--surface": mixHex(bg, fg, 0.04),
    "--surface-foreground": fg,
    "--muted": mixHex(bg, fg, 0.05),
    "--muted-foreground": mixHex(fg, bg, 0.35),
    "--subtle-foreground": mixHex(fg, bg, 0.5),
    "--secondary": mixHex(bg, fg, 0.05),
    "--secondary-foreground": fg,
    "--accent": mixHex(bg, fg, 0.06),
    "--accent-foreground": fg,
    "--border": mixHex(bg, fg, 0.12),
    "--border-strong": mixHex(bg, fg, 0.2),
    "--input": mixHex(bg, fg, 0.45),
    "--ring": primary,
    "--primary": primary,
    "--primary-foreground": primaryForeground,
    "--primary-hover": mixHex(primary, BLACK, 0.12),
    "--primary-active": mixHex(primary, BLACK, 0.22),
    "--primary-subtle": mixHex(bg, primary, 0.12),
    "--primary-subtle-foreground": mixHex(primary, BLACK, 0.3),
    "--brand-accent": accent,
    "--brand-accent-foreground": accentForeground,
    "--font-sans": fontStack(style.typography.bodyFont),
    "--font-arabic": fontStack(style.typography.bodyFont),
    "--font-heading": fontStack(style.typography.headingFont),
    "--shop-base-size": `${BASE_SIZE_PX[style.typography.baseSize]}px`,
  };
  const scale = RADIUS_SCALES[style.corners];
  STEPS.forEach((step, index) => {
    vars[`--shop-radius-${step}`] = `${scale[index] ?? 0}px`;
  });
  return vars;
}

/** The `<style id="brand">` body. Re-validates first, so a corrupt row renders the defaults. */
export function brandStyleSheet(raw: unknown): string {
  const vars = brandToCssVars(readBrandStyle(raw));
  return `:root:root:root{${Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(";")}}`;
}
