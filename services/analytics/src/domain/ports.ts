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
 *
 * ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter — no implementation may
 * capture it at construction. `SemanticQuery` carries no tenant/org field to thread it through
 * instead, so `SemanticEngine.execute` takes `tenantId` the same way and forwards it here.
 */
export interface AnalyticsReadStore {
  fetch(
    readModelId: string,
    tenantId: string,
    params: AnalyticsReadStoreFetchParams,
  ): Promise<readonly Record<string, unknown>[]>;
}
