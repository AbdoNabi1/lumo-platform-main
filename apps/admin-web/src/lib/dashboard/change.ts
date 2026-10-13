/**
 * What the badge on a KPI card says about this period against the one before it (Plan 3D).
 *
 * - `percent`: both periods have something, so the change is a fraction (0.5 = +50%).
 * - `new`: the previous period had nothing and this one has something; a percentage of zero would be
 *   infinite, so the card says "New".
 * - `none`: both are zero, there is nothing to compare, so the card shows a dash.
 */
export type Change =
  | { readonly kind: "percent"; readonly fraction: number }
  | { readonly kind: "new" }
  | { readonly kind: "none" };

export function changeBetween(current: number, previous: number): Change {
  if (previous === 0) return current === 0 ? { kind: "none" } : { kind: "new" };
  return { kind: "percent", fraction: (current - previous) / Math.abs(previous) };
}

/**
 * The daily figures as 0..1 samples for a sparkline, oldest first. Every day counts, so a range with no
 * sales is a flat line at the bottom rather than an empty card. Fewer than two days draws nothing.
 */
export function trendPoints(values: readonly number[]): readonly number[] {
  if (values.length < 2) return [];
  const max = Math.max(...values);
  return values.map((value) => (max <= 0 ? 0 : value / max));
}
