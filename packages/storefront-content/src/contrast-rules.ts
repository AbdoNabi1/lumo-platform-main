import { contrastRatio } from "@platform/design";
import type { ContentIssue } from "./locale";
import type { BrandColors } from "./theme-document";

export interface ContrastWarning {
  readonly pair: "foreground" | "primaryForeground" | "accentForeground";
  readonly ratio: number;
  readonly minimum: 4.5;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Spec 1.3: only body text under 3:1 blocks a save; every pair under 4.5:1 warns. */
export function checkBrandContrast(colors: BrandColors): {
  readonly blocking: ContentIssue[];
  readonly warnings: ContrastWarning[];
} {
  const blocking: ContentIssue[] = [];
  const warnings: ContrastWarning[] = [];
  const body = contrastRatio(colors.foreground, colors.background);
  if (body < 3) blocking.push({ path: "brand.colors.foreground", code: "CONTRAST_TOO_LOW" });
  else if (body < 4.5) warnings.push({ pair: "foreground", ratio: round2(body), minimum: 4.5 });
  const pairs = [
    ["primaryForeground", colors.primaryForeground, colors.primary],
    ["accentForeground", colors.accentForeground, colors.accent],
  ] as const;
  for (const [pair, text, fill] of pairs) {
    const ratio = contrastRatio(text, fill);
    if (ratio < 4.5) warnings.push({ pair, ratio: round2(ratio), minimum: 4.5 });
  }
  return { blocking, warnings };
}
