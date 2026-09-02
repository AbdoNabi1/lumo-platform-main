import type { ClickHouseClient } from "@clickhouse/client";
import {
  clampLimit,
  type ReadModelPage,
  type ReadModelQueryParams,
  type ReadModelStore,
} from "../domain/read-model-store";

export interface ClickHouseReadModelStoreDeps {
  readonly client: ClickHouseClient;
  readonly tenantId: string;
  readonly table?: string;
}

interface ReadModelRow {
  readonly model: string;
  readonly key: string;
  readonly value: string;
  readonly total: string;
}

/**
 * Production `ReadModelStore` on ClickHouse (M9) — reuses the shared `@platform/clickhouse`
 * client (no bespoke client). `ReplacingMergeTree(updated_at)` for idempotent upserts (a `put` is
 * a plain insert; ClickHouse's background merge keeps only the latest `updated_at` per key);
 * reads use `FINAL` to force that de-duplication at query time. Filter/sort field names are bound
 * as query parameters (`{field:String}`), never string-concatenated, so there is no SQL-injection
 * surface. Honestly gated: never exercised against a live ClickHouse instance this session
 * (`CLICKHOUSE_URL_TEST` unset, offline environment) — `migrate()` and every query below are
 * written to the described shape but not integration-verified.
 */
export class ClickHouseReadModelStore implements ReadModelStore {
  private readonly client: ClickHouseClient;
  private readonly tenantId: string;
  private readonly table: string;

  constructor(deps: ClickHouseReadModelStoreDeps) {
    this.client = deps.client;
    this.tenantId = deps.tenantId;
    this.table = deps.table ?? "finance_read_models";
  }

  /** Provisions the read-model table. Idempotent (`CREATE TABLE IF NOT EXISTS`). */
  async migrate(): Promise<void> {
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${this.table} (
          tenant_id String,
          model String,
          key String,
          value String,
          updated_at DateTime64(3)
        )
        ENGINE = ReplacingMergeTree(updated_at)
        ORDER BY (tenant_id, model, key)
      `,
    });
  }

  async put(model: string, key: string, value: unknown): Promise<void> {
    await this.client.insert({
      table: this.table,
      values: [
        {
          tenant_id: this.tenantId,
          model,
          key,
          value: JSON.stringify(value),
          updated_at: new Date().toISOString(),
        },
      ],
      format: "JSONEachRow",
    });
  }

  async get(model: string, key: string): Promise<unknown> {
    const result = await this.client.query({
      query: `
        SELECT value FROM ${this.table} FINAL
        WHERE tenant_id = {tenantId:String} AND model = {model:String} AND key = {key:String}
        LIMIT 1
      `,
      query_params: { tenantId: this.tenantId, model, key },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ value: string }>();
    const first = rows.at(0);
    return first === undefined ? null : (JSON.parse(first.value) as unknown);
  }

  async list(model: string): Promise<readonly unknown[]> {
    const result = await this.client.query({
      query: `
        SELECT value FROM ${this.table} FINAL
        WHERE tenant_id = {tenantId:String} AND model = {model:String}
      `,
      query_params: { tenantId: this.tenantId, model },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ value: string }>();
    return rows.map((row): unknown => JSON.parse(row.value));
  }

  async query(model: string, params: ReadModelQueryParams): Promise<ReadModelPage> {
    const limit = clampLimit(params.limit);
    const order = params.order === "desc" ? "DESC" : "ASC";
    const sortExpr = params.sort ? `JSONExtractString(value, {sortField:String})` : "key";

    const filterClauses: string[] = [];
    const filterParams: Record<string, string> = {};
    if (params.filter) {
      Object.entries(params.filter).forEach(([name, expected], index) => {
        filterClauses.push(
          `JSONExtractString(value, {filterField${index}:String}) = {filterValue${index}:String}`,
        );
        filterParams[`filterField${index}`] = name;
        filterParams[`filterValue${index}`] = expected;
      });
    }
    const cursorClause = params.cursor ? `AND key > {cursor:String}` : "";

    const result = await this.client.query({
      query: `
        SELECT key, value, count() OVER () AS total
        FROM ${this.table} FINAL
        WHERE tenant_id = {tenantId:String} AND model = {model:String}
        ${filterClauses.length > 0 ? `AND ${filterClauses.join(" AND ")}` : ""}
        ${cursorClause}
        ORDER BY ${sortExpr} ${order}, key ${order}
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: this.tenantId,
        model,
        ...(params.sort ? { sortField: params.sort } : {}),
        ...filterParams,
        ...(params.cursor ? { cursor: params.cursor } : {}),
        limit,
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<ReadModelRow>();
    const items = rows.map((row): unknown => JSON.parse(row.value));
    const firstRow = rows.at(0);
    const total = firstRow === undefined ? 0 : Number(firstRow.total);
    const last = rows[rows.length - 1];
    const hasMore = rows.length === limit && total > limit;

    return { items, nextCursor: hasMore && last ? last.key : null, total };
  }
}
