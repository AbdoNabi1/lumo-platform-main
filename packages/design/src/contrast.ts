/**
 * WCAG 2.1 relative-luminance and contrast maths.
 *
 * Lives in the design package rather than in a test file because the accessibility
 * guarantees of the palette are part of the design system's contract — `contrast.test.ts`
 * asserts them on every run, and product code can use `meetsContrast` when it composes a
 * colour pair the token layer does not already cover.
 */

/** WCAG success criteria this helper knows about. */
export type ContrastLevel =
  /** 1.4.3 — body text and images of text. */
  | "AA-text"
  /** 1.4.3 — text ≥18.66px bold or ≥24px. */
  | "AA-large-text"
  /** 1.4.11 — UI component boundaries, states, and meaningful graphics. */
  | "AA-non-text";

const MINIMUM_RATIO: Readonly<Record<ContrastLevel, number>> = {
  "AA-text": 4.5,
  "AA-large-text": 3,
  "AA-non-text": 3,
};

function parseHex(hex: string): readonly [number, number, number] {
  const value = hex.trim().replace("#", "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Not a 3- or 6-digit hex colour: "${hex}"`);
  }

  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

/** WCAG 2.1 relative luminance of an sRGB colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const linear = [r, g, b].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });

  const [lr, lg, lb] = linear;
  if (lr === undefined || lg === undefined || lb === undefined) {
    throw new Error("unreachable: parseHex always yields three channels");
  }

  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** Contrast ratio between two hex colours, in the range 1–21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Whether a foreground/background pair clears the given WCAG success criterion. */
export function meetsContrast(
  foreground: string,
  background: string,
  level: ContrastLevel,
): boolean {
  return contrastRatio(foreground, background) >= MINIMUM_RATIO[level];
}
