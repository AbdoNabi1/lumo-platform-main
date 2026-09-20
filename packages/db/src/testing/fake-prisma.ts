import type { Database } from "../client";

/**
 * T10.5 (WP-10): an in-memory stand-in for the `Database` (PrismaClient) that applies every `where`
 * LITERALLY — no row-level security, no schema knowledge. It exists so a repository's application
 * layer tenant scoping can be tested without Postgres: a repository that forgets `tenantId` in a
 * `where` reads or mutates another tenant's row here, exactly as it does in production under the
 * `postgres` role (RLS is inert there until ADR-0014 Phase 2). A test that passes against this fake
 * therefore passes because the repository scoped its own query, not because a database rescued it.
 *
 * Deliberately small: only the delegate methods the converted repositories use, only scalar
 * equality and a handful of comparison operators. Anything else throws, loudly, rather than
 * silently matching — an unsupported `where` shape must never turn into a test that "passes".
 * Not a substitute for the `DATABASE_URL_TEST`-gated integration suites; it does not model
 * constraints, defaults, relations or transactions (`$transaction` just runs the callback).
 */
type Row = Record<string, unknown>;

interface Args {
  readonly where?: Row;
  readonly data?: Row;
  readonly take?: number;
  readonly skip?: number;
  readonly orderBy?: unknown;
  readonly select?: unknown;
  readonly include?: unknown;
}

function matchesOperator(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "not":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "notIn":
      return Array.isArray(expected) && !expected.includes(actual);
    case "gt":
      return (actual as number | Date) > (expected as number | Date);
    case "gte":
      return (actual as number | Date) >= (expected as number | Date);
    case "lt":
      return (actual as number | Date) < (expected as number | Date);
    case "lte":
      return (actual as number | Date) <= (expected as number | Date);
    default:
      throw new Error(`fake-prisma: unsupported where operator "${operator}"`);
  }
}

function matches(row: Row, where: Row | undefined): boolean {
  if (where === undefined) return true;
  return Object.entries(where).every(([field, expected]) => {
    if (field === "AND" || field === "OR" || field === "NOT") {
      throw new Error(`fake-prisma: unsupported where combinator "${field}"`);
    }
    const actual = row[field];
    if (expected === undefined) return true;
    if (expected instanceof Date)
      return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected !== null && typeof expected === "object") {
      return Object.entries(expected as Row).every(([op, value]) =>
        matchesOperator(actual, op, value),
      );
    }
    return actual === expected;
  });
}

function applyData(row: Row, data: Row): void {
  for (const [field, value] of Object.entries(data)) {
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      const op = value as { increment?: number };
      if (typeof op.increment === "number") {
        row[field] = ((row[field] as number | undefined) ?? 0) + op.increment;
        continue;
      }
    }
    row[field] = value;
  }
}

function delegate(rows: Row[]) {
  const page = (found: Row[], args: Args): Row[] => {
    const skipped = found.slice(args.skip ?? 0);
    return args.take === undefined ? skipped : skipped.slice(0, args.take);
  };
  return {
    create: async ({ data }: Args): Promise<Row> => {
      const row = { ...data };
      rows.push(row);
      return { ...row };
    },
    createMany: async ({ data }: { data: Row[] }): Promise<{ count: number }> => {
      for (const row of data) rows.push({ ...row });
      return { count: data.length };
    },
    findFirst: async (args: Args = {}): Promise<Row | null> => {
      const found = rows.find((row) => matches(row, args.where));
      return found === undefined ? null : { ...found };
    },
    findMany: async (args: Args = {}): Promise<Row[]> =>
      page(
        rows.filter((row) => matches(row, args.where)),
        args,
      ).map((row) => ({ ...row })),
    count: async (args: Args = {}): Promise<number> =>
      rows.filter((row) => matches(row, args.where)).length,
    updateMany: async ({ where, data }: Args): Promise<{ count: number }> => {
      const targets = rows.filter((row) => matches(row, where));
      for (const row of targets) applyData(row, data ?? {});
      return { count: targets.length };
    },
    deleteMany: async ({ where }: Args = {}): Promise<{ count: number }> => {
      const targets = rows.filter((row) => matches(row, where));
      for (const row of targets) rows.splice(rows.indexOf(row), 1);
      return { count: targets.length };
    },
  };
}

/** Every row of a model, across ALL tenants — for a test to assert what actually got stored. */
export interface FakePrisma {
  readonly database: Database;
  rowsOf(model: string): readonly Row[];
}

export function createFakePrisma(): FakePrisma {
  const tables = new Map<string, Row[]>();
  const tableOf = (model: string): Row[] => {
    let rows = tables.get(model);
    if (rows === undefined) {
      rows = [];
      tables.set(model, rows);
    }
    return rows;
  };

  const client: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        if (property === "$transaction") {
          return async (fn: (tx: unknown) => Promise<unknown>) => fn(client);
        }
        if (property === "$executeRaw") return async () => 0; // `set_config('app.tenant_id', …)`
        if (property === "then") return undefined; // never look like a thenable
        return delegate(tableOf(property));
      },
    },
  );

  return { database: client as unknown as Database, rowsOf: (model) => tableOf(model) };
}
