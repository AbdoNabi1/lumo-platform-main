const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

function normalize(text: string): string {
  let out = "";
  for (const char of text.trim()) {
    const index = ARABIC_INDIC.indexOf(char);
    if (index >= 0) out += String(index);
    else if (char === "٫") out += ".";
    else if (char === "%" || char === "٪") continue;
    else out += char;
  }
  return out;
}

/**
 * A typed percent ("14", "14.5", "14.25%", "١٤٫٥") to integer basis points (1 bp = 0.01%), by string
 * arithmetic — never `Number(text) * 100`. At most 2 decimals (that is what a basis point holds), from
 * 0 to 100. `null` when the text is not such a percent.
 */
export function percentToBasisPoints(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalize(text));
  if (match === null) return null;
  const basisPoints = Number((match[1] ?? "0") + (match[2] ?? "").padEnd(2, "0"));
  return basisPoints <= 10_000 ? basisPoints : null;
}

/** Basis points to the plain text an input shows ("14", "14.5", "14.25"). */
export function basisPointsToPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return fraction.length === 0 ? String(whole) : `${whole}.${fraction}`;
}
