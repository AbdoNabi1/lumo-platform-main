import type { CogsSnapshot } from "../cogs-snapshot";

/** Picks the {@link CogsSnapshot} effective at a given date (the latest one not after `at`). */
export class HistoricalCostResolver {
  static resolve(
    snapshots: readonly CogsSnapshot[],
    productRef: string,
    at: Date,
  ): CogsSnapshot | undefined {
    return snapshots
      .filter(
        (snapshot) =>
          snapshot.productRef === productRef && snapshot.effectiveAt.getTime() <= at.getTime(),
      )
      .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())[0];
  }
}
