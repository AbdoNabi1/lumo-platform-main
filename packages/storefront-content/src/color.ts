import { contrastRatio } from "@platform/design";

/** Exactly `#rrggbb`, lower case. Nothing else ever reaches CSS. */
export type HexColor = `#${string}`;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** The only colour parser: 6-digit hex, no whitespace, no alpha, no names. Stored lower case. */
export function normalizeHex(value: unknown): HexColor | null {
  if (typeof value !== "string" || !HEX6.test(value)) return null;
  return value.toLowerCase() as HexColor;
}

function channels(hex: HexColor): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

const toHex = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

/** `a` moved towards `b` by `weightOfB` (0 = a, 1 = b), per channel. */
export function mixHex(a: HexColor, b: HexColor, weightOfB: number): HexColor {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const w = Math.min(1, Math.max(0, weightOfB));
  return `#${toHex(ar + (br - ar) * w)}${toHex(ag + (bg - ag) * w)}${toHex(ab + (bb - ab) * w)}`;
}

/** Black or white, whichever reads better on `background` (the editor's "Auto-fix"). */
export function bestTextOn(background: HexColor): "#000000" | "#ffffff" {
  return contrastRatio("#000000", background) >= contrastRatio("#ffffff", background)
    ? "#000000"
    : "#ffffff";
}
