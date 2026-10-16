import type { ClickHouseClient } from "@clickhouse/client";
import { BusinessRuleError } from "@platform/utils";
import type { AnalyticsReadStore, AnalyticsReadStoreFetchParams } from "../domain/ports";

export interface ClickHouseAnalyticsReadStoreDeps {
  readonly client: ClickHouseClient;
  /** Canonical read-model id -> physical table name. Defaults to `.` -> `_`. */
  readonly tableFor?: (readModelId: string) => string;
}

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateIdentifier(name: string): string {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new BusinessRuleError(`Unsafe ClickHouse identifier: ${name}`);
  }
  return name;
}

/**
 * Production `AnalyticsReadStore` on ClickHouse (reuses the shared `@platform/clickhouse`
 * client). SELECT-only; every table/column identifier is validated against a strict allowlist
 * pattern before being spliced into SQL (ClickHouse has no parameterized-identifier syntax), and
 * every filter *value* is bound as a query parameter — so there is no SQL-injection surface.
 * Built once, as a process-wide singleton (ADR-0014, WP-10 T10.3): `tenantId` is a `fetch`
 * per-call parameter, never captured at construction — no code path can omit it, since it is a
 * required argument of every call. Honestly gated: never exercised against a live ClickHouse
 * instance this session (offline environment, no tables exist yet — WP-3) — written to the
 * described shape, not integration-verified.
 */
export class ClickHouseAnalyticsReadStore implements AnalyticsReadStore {
  private readonly client: ClickHouseClient;
  private readonly tableFor: (readModelId: string) => string;

  constructor(deps: ClickHouseAnalyticsReadStoreDeps) {
    this.client = deps.client;
    this.tableFor = deps.tableFor ?? ((readModelId) => readModelId.replace(/\./g, "_"));
  }

  async fetch(
    readModelId: string,
    tenantId: string,
    params: AnalyticsReadStoreFetchParams,
  ): Promise<readonly Record<string, unknown>[]> {
    if (!tenantId) {
      throw new BusinessRuleError(
        "ClickHouseAnalyticsReadStore.fetch: tenantId is required (ADR-0014) — never query " +
          "without a resolved tenant.",
      );
    }
    const table = validateIdentifier(this.tableFor(readModelId));
    const fields = params.fields.map(validateIdentifier);

    const filterClauses: string[] = [];
    const filterParams: Record<string, string> = {};
    Object.entries(params.filters ?? {}).forEach(([field, value], index) => {
      const column = validateIdentifier(field);
      filterClauses.push(`${column} = {filterValue${index}:String}`);
      filterParams[`filterValue${index}`] = value;
    });

    const result = await this.client.query({
      query: `
        SELECT ${fields.join(", ")}
        FROM ${table}
        WHERE tenant_id = {tenantId:String}
        ${filterClauses.length > 0 ? `AND ${filterClauses.join(" AND ")}` : ""}
      `,
      query_params: { tenantId, ...filterParams },
      format: "JSONEachRow",
    });
    return result.json<Record<string, unknown>>();
  }
}
