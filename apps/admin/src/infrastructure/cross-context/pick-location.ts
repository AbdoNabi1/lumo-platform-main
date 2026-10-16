export interface LocationLevel {
  readonly locationId: string;
  readonly available: number;
}

/**
 * Plan 2B-3: the one rule that decides which active location serves a line — the one holding the
 * most stock of the variant (ties go to the earlier location in the input). `covers` says whether
 * that location alone can supply `quantity`; stock split across locations is not combined (a gap
 * recorded by Plan 2B-3). `null` means there is no location to choose from.
 */
export function pickLocation(
  levels: readonly LocationLevel[],
  quantity: number,
): { readonly locationId: string; readonly available: number; readonly covers: boolean } | null {
  let best: LocationLevel | undefined;
  for (const level of levels) {
    if (best === undefined || level.available > best.available) best = level;
  }
  if (best === undefined) return null;
  return {
    locationId: best.locationId,
    available: best.available,
    covers: best.available >= quantity,
  };
}
