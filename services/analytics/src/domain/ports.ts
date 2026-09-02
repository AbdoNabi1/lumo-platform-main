export interface AnalyticsReadStoreFetchParams {
  /** Physical field names `QueryCompiler` needs back (measure fields + the dimension key). */
  readonly fields: readonly string[];
  /** Exact-match filters, physical field name -> value. */
  readonly filters?: Readonly<Record<string, string>>;
}

/**
 * Read-only access to one business-owned read model's rows, by canonical read-model id.
 * Analytics never imports a business context; every implementation of this port is the one place
 * that actually reads (ClickHouse, or an in-memory fixture) — `SemanticEngine` never touches
 * storage directly.
 */
export interface AnalyticsReadStore {
  fetch(
    readModelId: string,
    params: AnalyticsReadStoreFetchParams,
  ): Promise<readonly Record<string, unknown>[]>;
}
