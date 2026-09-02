import type { CanonicalId } from "../domain/value-objects/canonical-id";

interface Identified {
  readonly id: CanonicalId;
}

/**
 * Shared append-only versioning behind `MetricCatalog`/`DimensionCatalog` — canonical-id
 * uniqueness within a version, monotonic version numbers (1-based), full retained history.
 * `register` never overwrites a version; it always appends, so a prior version's definition
 * remains queryable via {@link history}.
 */
export class VersionedCatalog<T extends Identified> {
  private readonly versions = new Map<string, T[]>();

  register(entry: T): void {
    const key = entry.id.value;
    const history = this.versions.get(key) ?? [];
    this.versions.set(key, [...history, entry]);
  }

  get(id: string): T | undefined {
    const history = this.versions.get(id);
    return history?.[history.length - 1];
  }

  getVersion(id: string, version: number): T | undefined {
    return this.versions.get(id)?.[version - 1];
  }

  /** 1-based; 0 if `id` was never registered. */
  currentVersion(id: string): number {
    return this.versions.get(id)?.length ?? 0;
  }

  history(id: string): readonly T[] {
    return this.versions.get(id) ?? [];
  }

  has(id: string): boolean {
    return this.versions.has(id);
  }

  /** Latest version of every registered id. */
  list(): readonly T[] {
    // Every array stored in `versions` is non-empty: `register` only ever creates one via
    // `[...history, entry]`, never `[]` — so the last element always exists.
    return [...this.versions.values()].map((history) => history[history.length - 1]!);
  }
}
