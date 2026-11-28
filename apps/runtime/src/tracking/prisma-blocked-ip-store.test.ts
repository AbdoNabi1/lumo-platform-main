import type { Database } from "@platform/db";
import type { BlockedIpEntry } from "@platform/tracking";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaBlockedIpStore } from "./prisma-blocked-ip-store";

/**
 * Statement-level tests: no database is reachable from here, so what is pinned is what the adapter ASKS the
 * database — the tenant is set first and named in every `where`, an add is a skip-duplicates insert, and a
 * remove is scoped to the tenant. The behaviour on a real database is the gated integration test's.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const T0 = "2026-11-28T10:00:00.000Z";

interface Call {
  readonly op: string;
  readonly args: unknown;
}

function fakeDb(
  handlers: {
    findMany?: () => unknown[];
    findFirst?: () => unknown;
    createMany?: () => { count: number };
    deleteMany?: () => { count: number };
    count?: () => number;
  } = {},
) {
  const calls: Call[] = [];
  const record =
    <T>(op: string, handler: (() => T) | undefined, fallback: T) =>
    (args: unknown): Promise<T> => {
      calls.push({ op, args });
      return Promise.resolve(handler === undefined ? fallback : handler());
    };
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ op: "raw", args: { sql: strings.join("?"), values } });
      return Promise.resolve(1);
    },
    trackingBlockedIp: {
      findMany: record("findMany", handlers.findMany, []),
      findFirst: record("findFirst", handlers.findFirst, null),
      createMany: record("createMany", handlers.createMany, { count: 1 }),
      deleteMany: record("deleteMany", handlers.deleteMany, { count: 1 }),
      count: record("count", handlers.count, 0),
    },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { db, calls };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "id-1",
  tenantId: "t-1",
  cidr: "203.0.113.7/32",
  note: "office",
  createdAt: new Date(T0),
  createdBy: "u-1",
  ...overrides,
});

const entry: BlockedIpEntry = {
  id: "id-1",
  tenantId: "t-1",
  cidr: "203.0.113.7/32",
  note: "office",
  createdAt: T0,
  createdBy: "u-1",
};

const ops = (calls: readonly Call[]): string[] => calls.map((call) => call.op);

describe("PrismaBlockedIpStore", () => {
  it("every statement sets the tenant first and names it in the where", async () => {
    const { db, calls } = fakeDb({ findMany: () => [row()], count: () => 1 });
    const store = new PrismaBlockedIpStore(db);

    await store.list("t-1");
    await store.count("t-1");
    await store.remove("t-1", "id-1");
    await store.add(entry);

    // each call is its own transaction: the tenant switch always precedes the table statement
    expect(ops(calls)).toEqual([
      "raw",
      "findMany",
      "raw",
      "count",
      "raw",
      "deleteMany",
      "raw",
      "createMany",
      "findFirst",
    ]);
    expect(calls[0]?.args).toMatchObject({ values: expect.arrayContaining(["t-1"]) });
    expect(calls[1]?.args).toMatchObject({ where: { tenantId: "t-1" } });
    expect(calls[3]?.args).toMatchObject({ where: { tenantId: "t-1" } });
    expect(calls[5]?.args).toMatchObject({ where: { tenantId: "t-1", id: "id-1" } });
    expect(calls[8]?.args).toMatchObject({ where: { tenantId: "t-1", cidr: "203.0.113.7/32" } });
  });

  it("lists oldest first as domain entries", async () => {
    const { db, calls } = fakeDb({ findMany: () => [row()] });
    const list = await new PrismaBlockedIpStore(db).list("t-1");
    expect(list).toEqual([entry]);
    expect(calls.find((call) => call.op === "findMany")?.args).toMatchObject({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  });

  it("add is a skip-duplicates insert: a new row is `created`, a repeat returns the stored one", async () => {
    const created = fakeDb({ createMany: () => ({ count: 1 }), findFirst: () => row() });
    const first = await new PrismaBlockedIpStore(created.db).add(entry);
    expect(first).toEqual({ entry, created: true });
    expect(created.calls.find((call) => call.op === "createMany")?.args).toMatchObject({
      skipDuplicates: true,
      data: [{ id: "id-1", tenantId: "t-1", cidr: "203.0.113.7/32", note: "office" }],
    });

    const stored = row({ id: "id-older", createdAt: new Date("2026-11-01T00:00:00.000Z") });
    const repeat = fakeDb({ createMany: () => ({ count: 0 }), findFirst: () => stored });
    const again = await new PrismaBlockedIpStore(repeat.db).add(entry);
    expect(again.created).toBe(false);
    expect(again.entry.id).toBe("id-older");
  });

  it("remove answers whether a row was removed, never throws for a missing one", async () => {
    const gone = fakeDb({ deleteMany: () => ({ count: 0 }) });
    expect(await new PrismaBlockedIpStore(gone.db).remove("t-1", "nope")).toBe(false);
    const there = fakeDb({ deleteMany: () => ({ count: 1 }) });
    expect(await new PrismaBlockedIpStore(there.db).remove("t-1", "id-1")).toBe(true);
  });
});
