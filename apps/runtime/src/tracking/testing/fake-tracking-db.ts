/**
 * A Prisma-shaped fake for the tracking registry (and, for wiring tests, the ad platform connections), faithful
 * where the code under test relies on it: a transaction commits or rolls back as one, `pg_advisory_xact_lock`
 * blocks a second transaction on the same key until the first one ends, and the `(tenantId, kind, key,
 * version)` unique key rejects a duplicate version.
 */

import type { Database } from "@platform/db";

export interface FakeEntry {
  id: string;
  tenantId: string;
  kind: string;
  key: string;
  version: number;
  status: string;
  value: unknown;
  registeredAt: Date;
}

type Row = Record<string, unknown>;

export interface FakeTrackingDb {
  readonly prisma: Database;
  /** Committed registry rows, in registry read order (kind, key, version) like `loadAll`. */
  readonly entries: FakeEntry[];
  /** Every raw statement run on a transaction client, with its bound values. */
  readonly statements: { readonly sql: string; readonly values: readonly unknown[] }[];
  /** Ad platform connection rows (wiring tests). */
  readonly connections: Row[];
  /** `tenantId → site type` for the settings reader; absent ⇒ no settings row. */
  readonly siteTypes: Map<string, string>;
  /** Make the nth registry `create` (1-based, counted across the run) throw. */
  failCreateNumber: number | null;
  /** Number of registry `create` calls made. */
  creates: number;
}

export function fakeTrackingDb(): FakeTrackingDb {
  const entries: FakeEntry[] = [];
  const statements: { sql: string; values: readonly unknown[] }[] = [];
  const connections: Row[] = [];
  const siteTypes = new Map<string, string>();
  const locks = new Map<string, Promise<void>>();
  const state = { failCreateNumber: null as number | null, creates: 0 };

  const matches = (row: Row, where: Row | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => row[k] === v);

  // The registry's own read order (`orderBy kind, key, version`), as `loadAll` asks Prisma for it.
  const read = (rows: readonly FakeEntry[], where: Row | undefined): FakeEntry[] =>
    rows
      .filter((entry) => matches(entry as unknown as Row, where))
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key) || a.version - b.version,
      );

  const prisma = {
    // The real root client exposes every model delegate too: `loadTrackingRegistry` reads through it (only
    // committed rows are visible outside a transaction), while the sync's writes go through `$transaction`.
    trackingRegistryEntry: {
      findMany: ({ where }: { where: Row }) => Promise.resolve(read(entries, where)),
      count: ({ where }: { where: Row }) => Promise.resolve(read(entries, where).length),
      // `PrismaTrackingRegistryStore.signal` asks for the newest row's `registeredAt`.
      findFirst: ({ where }: { where: Row }) => {
        const newest = [...read(entries, where)].sort(
          (a, b) => b.registeredAt.getTime() - a.registeredAt.getTime(),
        )[0];
        return Promise.resolve(newest === undefined ? null : { registeredAt: newest.registeredAt });
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const staged: FakeEntry[] = [];
      const releases: (() => void)[] = [];
      const tx = {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join("?");
          statements.push({ sql, values });
          if (sql.includes("pg_advisory_xact_lock")) {
            const key = String(values[0]);
            const previous = locks.get(key) ?? Promise.resolve();
            let release!: () => void;
            const mine = new Promise<void>((resolve) => {
              release = resolve;
            });
            locks.set(
              key,
              previous.then(() => mine),
            );
            await previous;
            releases.push(release);
          }
          return 1;
        },
        trackingRegistryEntry: {
          findMany: ({ where }: { where: Row }) =>
            Promise.resolve(read([...entries, ...staged], where)),
          create: ({ data }: { data: FakeEntry }) => {
            state.creates += 1;
            if (state.failCreateNumber === state.creates) {
              return Promise.reject(new Error("registry write failed"));
            }
            const duplicate = [...entries, ...staged].some(
              (entry) =>
                entry.tenantId === data.tenantId &&
                entry.kind === data.kind &&
                entry.key === data.key &&
                entry.version === data.version,
            );
            if (duplicate) return Promise.reject(new Error("unique constraint failed"));
            staged.push({ ...data });
            return Promise.resolve(data);
          },
        },
        adPlatformConnection: {
          findMany: ({ where }: { where: Row }) =>
            Promise.resolve(connections.filter((row) => matches(row, where))),
          findFirst: ({ where }: { where: Row }) =>
            Promise.resolve(connections.find((row) => matches(row, where)) ?? null),
          create: ({ data }: { data: Row }) => {
            connections.push({ ...data });
            return Promise.resolve(data);
          },
          updateMany: ({ where, data }: { where: Row; data: Row }) => {
            const hits = connections.filter((row) => matches(row, where));
            for (const row of hits) Object.assign(row, data);
            return Promise.resolve({ count: hits.length });
          },
        },
        storeSettings: {
          findFirst: ({ where }: { where: { tenantId: string } }) => {
            const siteType = siteTypes.get(where.tenantId);
            return Promise.resolve(siteType === undefined ? null : { siteType });
          },
        },
      };
      try {
        const result = await fn(tx);
        // `entries` is the table in registry read order, whatever order the rows were written in.
        entries.push(...staged);
        entries.sort(
          (a, b) =>
            a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key) || a.version - b.version,
        );
        return result;
      } finally {
        for (const release of releases) release();
      }
    },
  };

  return {
    prisma: prisma as unknown as Database,
    entries,
    statements,
    connections,
    siteTypes,
    get failCreateNumber() {
      return state.failCreateNumber;
    },
    set failCreateNumber(value) {
      state.failCreateNumber = value;
    },
    get creates() {
      return state.creates;
    },
    set creates(value) {
      state.creates = value;
    },
  };
}
