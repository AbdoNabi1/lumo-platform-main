import {
  paginateRows,
  type ReadModelPage,
  type ReadModelQueryParams,
  type ReadModelStore,
} from "../domain/read-model-store";

interface Row {
  readonly key: string;
  readonly value: unknown;
}

function field(value: unknown, name: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = (value as Record<string, unknown>)[name];
  if (raw === undefined) return undefined;
  // A field whose stored value is itself an object/array would otherwise all collapse to the
  // same "[object Object]" string (Object.prototype.toString), making sort/filter treat every
  // such row as equal — JSON.stringify keeps them distinguishable instead. `unknown` doesn't
  // narrow away on the non-matching side of a `typeof` check (unlike a real union type), so the
  // annotated declaration below (not an inline cast at the `String()` call — `String()`'s own
  // `any` parameter would make that assertion itself flagged as unnecessary) is what tells TS
  // what the guard above already guarantees at runtime: whatever reaches here is a primitive,
  // never the default-toString case this rule guards against.
  if (typeof raw === "object" && raw !== null) return JSON.stringify(raw);
  const primitive: string | number | boolean | null = raw as string | number | boolean | null;
  return String(primitive);
}

/**
 * In-memory `ReadModelStore` — one map per `(tenantId, model)`, upserted in place (`put` is
 * idempotent). `tenantId` is an explicit per-call parameter (ADR-0014, WP-10 T10.3) and is part of
 * the map key, not just accepted and ignored — an isolation test against this store must actually
 * be able to fail.
 */
export class InMemoryReadModelStore implements ReadModelStore {
  private readonly models = new Map<string, Map<string, unknown>>();

  private tableKey(tenantId: string, model: string): string {
    return `${tenantId}:${model}`;
  }

  async put(model: string, key: string, value: unknown, tenantId: string): Promise<void> {
    const tableKey = this.tableKey(tenantId, model);
    const table = this.models.get(tableKey) ?? new Map<string, unknown>();
    table.set(key, value);
    this.models.set(tableKey, table);
  }

  async get(model: string, key: string, tenantId: string): Promise<unknown> {
    return this.models.get(this.tableKey(tenantId, model))?.get(key) ?? null;
  }

  async list(model: string, tenantId: string): Promise<readonly unknown[]> {
    return [...(this.models.get(this.tableKey(tenantId, model))?.values() ?? [])];
  }

  async query(
    model: string,
    params: ReadModelQueryParams,
    tenantId: string,
  ): Promise<ReadModelPage> {
    const table = this.models.get(this.tableKey(tenantId, model)) ?? new Map<string, unknown>();
    const rows: Row[] = [...table.entries()].map(([key, value]) => ({ key, value }));

    const page = paginateRows<Row>(
      rows,
      params,
      (row) => (params.sort ? (field(row.value, params.sort) ?? row.key) : row.key),
      (row) => row.key,
      (row, filter) =>
        Object.entries(filter).every(([name, expected]) => field(row.value, name) === expected),
    );

    return {
      items: page.items.map((row) => row.value),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }
}
