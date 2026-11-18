/**
 * Day counts that agree with their number. Import-free on purpose (pure; safe for client and server
 * components alike). Arabic needs four forms — 1 "يوم واحد", 2 "يومين", 3–10 "٣ أيام", 11+ "١١ يوم" —
 * English uses the same table with singular/plural; each dictionary's `dayCount` holds the forms.
 */
export type CountForm = "one" | "two" | "few" | "many";

/** The form a count takes: 1 → one, 2 → two, 3–10 → few, everything else → many. */
export function countForm(count: number): CountForm {
  if (count === 1) return "one";
  if (count === 2) return "two";
  if (count >= 3 && count <= 10) return "few";
  return "many";
}

/** "3 days" / "٣ أيام": the form for `count`, with `{count}` set to the already-formatted number. */
export function dayCountPhrase(
  forms: Readonly<Record<CountForm, string>>,
  count: number,
  formatted: string,
): string {
  return forms[countForm(count)].replace("{count}", formatted);
}
