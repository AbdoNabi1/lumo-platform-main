import type { ClickHouseClient } from "@clickhouse/client";
import { BusinessRuleError } from "@platform/utils";
import type { AnalyticsReadStore, AnalyticsReadStoreFetchParams } from "../domain/ports";

export interface ClickHouseAnalyticsReadStoreDeps {
  readonly client: ClickHouseClient;
  readonly tenantId: string;
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
 * Tenant-scoped. Honestly gated: never exercised against a live ClickHouse instance this session
 * (offline environment) — written to the described shape, not integration-verified.
 */
export class ClickHouseAnalyticsReadStore implements AnalyticsReadStore {
  private readonly client: ClickHouseClient;
  private readonly tenantId: string;
  private readonly tableFor: (readModelId: string) => string;

  constructor(deps: ClickHouseAnalyticsReadStoreDeps) {
    this.client = deps.client;
    this.tenantId = deps.tenantId;
    this.tableFor = deps.tableFor ?? ((readModelId) => readModelId.replace(/\./g, "_"));
  }

  async fetch(
    readModelId: string,
    params: AnalyticsReadStoreFetchParams,
  ): Promise<readonly Record<string, unknown>[]> {
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
      query_params: { tenantId: this.tenantId, ...filterParams },
      format: "JSONEachRow",
    });
    return result.json<Record<string, unknown>>();
  }
}
