import type { AnalyticsReadStore, AnalyticsReadStoreFetchParams } from "../domain/ports";

/**
 * Fixture-backed `AnalyticsReadStore` — offline engine tests seed rows per read model id.
 * `tenantId` is accepted to satisfy the `AnalyticsReadStore` contract (ADR-0014) but otherwise
 * ignored: seeded rows are test fixtures, not tenant-scoped persisted data.
 */
export class InMemoryAnalyticsReadStore implements AnalyticsReadStore {
  private readonly tables = new Map<string, readonly Record<string, unknown>[]>();

  seed(readModelId: string, rows: readonly Record<string, unknown>[]): void {
    this.tables.set(readModelId, rows);
  }

  async fetch(
    readModelId: string,
    _tenantId: string,
    params: AnalyticsReadStoreFetchParams,
  ): Promise<readonly Record<string, unknown>[]> {
    const rows = this.tables.get(readModelId) ?? [];
    // Narrowed into a local `const` first: a property access (`params.filters`) doesn't stay
    // narrowed inside a closure, but a `const` binding does, since it can never be reassigned.
    const { filters } = params;
    const matching = filters
      ? rows.filter((row) =>
          Object.entries(filters).every(([field, value]) => String(row[field]) === value),
        )
      : rows;
    return matching.map((row) => project(row, params.fields));
  }
}

function project(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of fields) projected[field] = row[field];
  return projected;
}
