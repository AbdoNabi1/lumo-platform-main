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

/** In-memory `ReadModelStore` — one map per model name, upserted in place (`put` is idempotent). */
export class InMemoryReadModelStore implements ReadModelStore {
  private readonly models = new Map<string, Map<string, unknown>>();

  async put(model: string, key: string, value: unknown): Promise<void> {
    const table = this.models.get(model) ?? new Map<string, unknown>();
    table.set(key, value);
    this.models.set(model, table);
  }

  async get(model: string, key: string): Promise<unknown> {
    return this.models.get(model)?.get(key) ?? null;
  }

  async list(model: string): Promise<readonly unknown[]> {
    return [...(this.models.get(model)?.values() ?? [])];
  }

  async query(model: string, params: ReadModelQueryParams): Promise<ReadModelPage> {
    const table = this.models.get(model) ?? new Map<string, unknown>();
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
