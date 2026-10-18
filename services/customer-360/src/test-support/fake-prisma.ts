import type { Database } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";

/**
 * Test-only: `@platform/db/testing`'s `createFakePrisma`, plus the four Prisma behaviours this
 * package's adapters rely on that the shared fake leaves out — `findUnique` on a compound unique key
 * (`tenantId_identifierType_identifierValue: {...}`), `upsert`, `orderBy`, and `select`. Every
 * `where` still goes through the shared fake's literal matcher, so an adapter that forgets
 * `tenantId` reads another tenant's row here exactly as it would in production with RLS inert.
 *
 * Lets the `*.contract.ts` suites run against the Prisma adapters without Postgres. It does not
 * replace the `DATABASE_URL_TEST`-gated `prisma-*.integration.test.ts` suites: no constraints, no
 * column types, no real transactions (`$transaction` just runs the callback).
 */
type Row = Record<string, unknown>;
type OrderBy = Readonly<Record<string, "asc" | "desc">>;

interface FindArgs {
  readonly where?: Row;
  readonly orderBy?: OrderBy | readonly OrderBy[];
  readonly take?: number;
  readonly skip?: number;
  readonly select?: Readonly<Record<string, boolean>>;
}

interface BaseDelegate {
  create(args: { data: Row }): Promise<Row>;
  findFirst(args: { where?: Row }): Promise<Row | null>;
  findMany(args: { where?: Row }): Promise<Row[]>;
  updateMany(args: { where?: Row; data: Row }): Promise<{ count: number }>;
}

/** `{ a_b: { a: 1, b: 2 } }` → `{ a: 1, b: 2 }`; every other entry is left as it is. */
function flattenCompoundKeys(where: Row | undefined): Row | undefined {
  if (where === undefined) return undefined;
  const flat: Row = {};
  for (const [field, value] of Object.entries(where)) {
    const isCompound =
      value !== null &&
      typeof value === "object" &&
      !(value instanceof Date) &&
      Object.keys(value).join("_") === field;
    if (isCompound) Object.assign(flat, value);
    else flat[field] = value;
  }
  return flat;
}

function compare(a: unknown, b: unknown): number {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  if (left === right) return 0;
  return (left as number | string) < (right as number | string) ? -1 : 1;
}

function sortRows(rows: Row[], orderBy: FindArgs["orderBy"]): Row[] {
  if (orderBy === undefined) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((entry: OrderBy) =>
    Object.entries(entry),
  );
  return [...rows].sort((x, y) => {
    for (const [field, direction] of keys) {
      const order = compare(x[field], y[field]);
      if (order !== 0) return direction === "desc" ? -order : order;
    }
    return 0;
  });
}

function project(row: Row, select: FindArgs["select"]): Row {
  if (select === undefined) return row;
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, picked]) => picked)
      .map(([field]) => [field, row[field]]),
  );
}

/** A top-level `OR: [...]` runs one literal query per branch (each AND-ed with the rest of the
 * `where`) and keeps every row once, by `id`. Nested combinators still throw in the shared fake. */
async function findMatching(base: BaseDelegate, where: Row | undefined): Promise<Row[]> {
  const flat = flattenCompoundKeys(where);
  if (flat?.["OR"] === undefined) return base.findMany({ where: flat });
  const { OR: branches, ...rest } = flat;
  const byId = new Map<unknown, Row>();
  for (const branch of branches as Row[]) {
    for (const row of await base.findMany({ where: { ...rest, ...branch } }))
      byId.set(row["id"], row);
  }
  return [...byId.values()];
}

/** Prisma omits an `undefined` field from an INSERT, so a nullable column reads back as `null`. */
function insertable(data: Row): Row {
  return Object.fromEntries(
    Object.entries(data).map(([field, value]) => [field, value === undefined ? null : value]),
  );
}

function extend(base: BaseDelegate) {
  const findMany = async (args: FindArgs = {}): Promise<Row[]> => {
    const found = await findMatching(base, args.where);
    const sorted = sortRows(found, args.orderBy).slice(args.skip ?? 0);
    const page = args.take === undefined ? sorted : sorted.slice(0, args.take);
    return page.map((row) => project(row, args.select));
  };
  return {
    ...base,
    create: (args: { data: Row }) => base.create({ data: insertable(args.data) }),
    findMany,
    findFirst: async (args: FindArgs = {}): Promise<Row | null> =>
      (await findMany({ ...args, take: 1 }))[0] ?? null,
    findUnique: async (args: FindArgs): Promise<Row | null> =>
      (await findMany({ where: args.where, select: args.select }))[0] ?? null,
    updateMany: (args: { where?: Row; data: Row }) =>
      base.updateMany({ ...args, where: flattenCompoundKeys(args.where) }),
    upsert: async (args: { where: Row; create: Row; update: Row }): Promise<Row> => {
      const where = flattenCompoundKeys(args.where);
      const existing = await base.findFirst({ where });
      if (existing === null) return base.create({ data: insertable(args.create) });
      await base.updateMany({ where, data: args.update });
      return (await base.findFirst({ where })) as Row;
    },
  };
}

export interface CustomerFakePrisma {
  readonly database: Database;
  /** Every row of a model, across ALL tenants — what was actually stored. */
  rowsOf(model: string): readonly Row[];
}

export function createCustomerFakePrisma(): CustomerFakePrisma {
  const fake = createFakePrisma();
  const raw = fake.database as unknown as Record<string, unknown>;
  const client: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        if (property === "$transaction") {
          return async (fn: (tx: unknown) => Promise<unknown>) => fn(client);
        }
        if (property.startsWith("$") || property === "then") return raw[property];
        return extend(raw[property] as BaseDelegate);
      },
    },
  );
  return { database: client as unknown as Database, rowsOf: (model) => fake.rowsOf(model) };
}
