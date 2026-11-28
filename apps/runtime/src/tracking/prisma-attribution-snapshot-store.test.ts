import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaAttributionSnapshotStore } from "./prisma-attribution-snapshot-store";

/**
 * Statement-level tests: no database is reachable from here, so what is pinned is what the adapter ASKS the
 * database — the tenant is set first and named in every `where`, the write is a skip-duplicates insert, the retention
 * scan sets its explicit switch. The behaviour on a real database is the gated integration test's.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const T0 = new Date("2026-12-01T10:00:00.000Z");

interface Call {
  readonly op: string;
  readonly args: unknown;
}

function fakeDb(
  handlers: {
    findFirst?: () => unknown;
    findMany?: () => unknown;
    createMany?: () => { count: number };
    updateMany?: () => { count: number };
    deleteMany?: () => { count: number };
    queryRaw?: () => unknown;
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
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ op: "query", args: { sql: strings.join("?"), values } });
      return Promise.resolve(handlers.queryRaw === undefined ? [] : handlers.queryRaw());
    },
    trackingAttributionSnapshot: {
      findFirst: record("findFirst", handlers.findFirst, null),
      findMany: record("findMany", handlers.findMany, []),
      createMany: record("createMany", handlers.createMany, { count: 1 }),
      updateMany: record("updateMany", handlers.updateMany, { count: 1 }),
      deleteMany: record("deleteMany", handlers.deleteMany, { count: 1 }),
    },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { db, calls };
}

const write = {
  tenantId: "t-1",
  subjectKind: "checkout",
  subjectRef: "chk-1",
  capturedAt: T0.toISOString(),
  snapshot: {
    visitorId: "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b",
    ip: "203.0.113.9",
    cookies: { fbp: "fb.1.1.2" },
    clickIds: [{ name: "gclid", value: "abc", capturedAt: T0.toISOString() }],
  },
} as const;

describe("PrismaAttributionSnapshotStore.putIfAbsent", () => {
  it("sets the tenant first, then inserts with skipDuplicates (first write wins)", async () => {
    const { db, calls } = fakeDb();
    const outcome = await new PrismaAttributionSnapshotStore(db).putIfAbsent(write);
    expect(outcome).toBe("created");
    expect(calls[0]?.op).toBe("raw");
    expect(JSON.stringify(calls[0]?.args)).toContain("app.tenant_id");
    expect(JSON.stringify(calls[0]?.args)).toContain("t-1");
    const insert = calls.find((call) => call.op === "createMany")?.args as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    expect(insert.skipDuplicates).toBe(true);
    expect(insert.data).toHaveLength(1);
    expect(insert.data[0]).toMatchObject({
      tenantId: "t-1",
      subjectKind: "checkout",
      subjectRef: "chk-1",
      visitorId: write.snapshot.visitorId,
      ip: "203.0.113.9",
      userAgent: null,
      cookies: { fbp: "fb.1.1.2" },
      utm: {},
    });
    expect(insert.data[0]?.["capturedAt"]).toEqual(T0);
  });

  it("a conflicting key (count 0) is 'exists'", async () => {
    const { db } = fakeDb({ createMany: () => ({ count: 0 }) });
    expect(await new PrismaAttributionSnapshotStore(db).putIfAbsent(write)).toBe("exists");
  });
});

describe("PrismaAttributionSnapshotStore.find", () => {
  it("names tenant, kind and ref, and maps the row back to the read-model snapshot", async () => {
    const { db, calls } = fakeDb({
      findFirst: () => ({
        visitorId: "v".repeat(20),
        sessionId: null,
        ip: null,
        userAgent: "UA",
        pageUrl: "https://shop.example/checkout",
        referrer: null,
        cookies: { fbp: "fb.1.1.2", junk: "x", ga: 5 },
        clickIds: [
          { name: "gclid", value: "abc", capturedAt: T0.toISOString() },
          { name: "bogus", value: "abc", capturedAt: T0.toISOString() },
          "not an object",
        ],
        utm: { source: "fb", extra: "no" },
      }),
    });
    const snapshot = await new PrismaAttributionSnapshotStore(db).find("t-1", "checkout", "chk-1");
    const query = calls.find((call) => call.op === "findFirst")?.args as {
      where: Record<string, unknown>;
    };
    expect(query.where).toEqual({ tenantId: "t-1", subjectKind: "checkout", subjectRef: "chk-1" });
    expect(snapshot).toEqual({
      visitorId: "v".repeat(20),
      userAgent: "UA",
      pageUrl: "https://shop.example/checkout",
      cookies: { fbp: "fb.1.1.2" },
      clickIds: [{ name: "gclid", value: "abc", capturedAt: T0.toISOString() }],
      utm: { source: "fb" },
    });
  });

  it("no row is null; malformed JSON columns yield fewer fields, never a throw", async () => {
    const none = fakeDb();
    expect(
      await new PrismaAttributionSnapshotStore(none.db).find("t-1", "checkout", "x"),
    ).toBeNull();
    const odd = fakeDb({
      findFirst: () => ({
        visitorId: null,
        sessionId: null,
        ip: null,
        userAgent: null,
        pageUrl: null,
        referrer: null,
        cookies: "oops",
        clickIds: { not: "an array" },
        utm: null,
      }),
    });
    expect(await new PrismaAttributionSnapshotStore(odd.db).find("t-1", "checkout", "x")).toEqual(
      {},
    );
  });
});

describe("PrismaAttributionSnapshotStore retention", () => {
  it("the scan sets the retention switch before reading and returns only tenant ids", async () => {
    const { db, calls } = fakeDb({ queryRaw: () => [{ tenant_id: "t-1" }, { tenant_id: "t-2" }] });
    const tenants = await new PrismaAttributionSnapshotStore(db).tenantsWithSnapshotWork(
      new Date("2026-09-01T00:00:00.000Z"),
      new Date("2025-11-01T00:00:00.000Z"),
    );
    expect(tenants).toEqual(["t-1", "t-2"]);
    expect(calls[0]?.op).toBe("raw");
    expect(JSON.stringify(calls[0]?.args)).toContain("app.retention_scan");
    const sql = (calls[1]?.args as { sql: string }).sql;
    expect(sql).toContain("SELECT DISTINCT tenant_id");
    expect(sql).toContain("network_redacted_at IS NULL");
  });

  it("redaction is tenant-scoped, takes a bounded batch, and only nulls ip, user agent and stamps the row", async () => {
    const { db, calls } = fakeDb({
      findMany: () => [{ subjectKind: "checkout", subjectRef: "a" }],
      updateMany: () => ({ count: 1 }),
    });
    const cutoff = new Date("2026-09-01T00:00:00.000Z");
    const count = await new PrismaAttributionSnapshotStore(db).redactNetworkBatch(
      "t-1",
      cutoff,
      50,
      T0,
    );
    expect(count).toBe(1);
    expect(JSON.stringify(calls[0]?.args)).toContain("t-1");
    const find = calls.find((call) => call.op === "findMany")?.args as {
      where: unknown;
      take: number;
    };
    expect(find.where).toEqual({
      tenantId: "t-1",
      networkRedactedAt: null,
      capturedAt: { lt: cutoff },
    });
    expect(find.take).toBe(50);
    const update = calls.find((call) => call.op === "updateMany")?.args as {
      where: { tenantId: string };
      data: unknown;
    };
    expect(update.where.tenantId).toBe("t-1");
    expect(update.data).toEqual({ ip: null, userAgent: null, networkRedactedAt: T0 });
  });

  it("nothing due is zero and issues no update or delete", async () => {
    const { db, calls } = fakeDb();
    const store = new PrismaAttributionSnapshotStore(db);
    expect(await store.redactNetworkBatch("t-1", T0, 10, T0)).toBe(0);
    expect(await store.deleteExpiredBatch("t-1", T0, 10)).toBe(0);
    expect(calls.filter((call) => call.op === "updateMany" || call.op === "deleteMany")).toEqual(
      [],
    );
  });

  it("expiry deletes only the due rows of that tenant", async () => {
    const { db, calls } = fakeDb({
      findMany: () => [
        { subjectKind: "checkout", subjectRef: "a" },
        { subjectKind: "checkout", subjectRef: "b" },
      ],
      deleteMany: () => ({ count: 2 }),
    });
    const cutoff = new Date("2025-10-01T00:00:00.000Z");
    expect(
      await new PrismaAttributionSnapshotStore(db).deleteExpiredBatch("t-1", cutoff, 200),
    ).toBe(2);
    const del = calls.find((call) => call.op === "deleteMany")?.args as {
      where: { tenantId: string; capturedAt: unknown; OR: unknown[] };
    };
    expect(del.where.tenantId).toBe("t-1");
    expect(del.where.capturedAt).toEqual({ lt: cutoff });
    expect(del.where.OR).toHaveLength(2);
  });

  it("deleteSubjects is tenant-scoped and a no-op for an empty list", async () => {
    const { db, calls } = fakeDb({ deleteMany: () => ({ count: 3 }) });
    const store = new PrismaAttributionSnapshotStore(db);
    expect(await store.deleteSubjects("t-1", "checkout", [])).toBe(0);
    expect(calls).toEqual([]);
    expect(await store.deleteSubjects("t-1", "checkout", ["a", "b", "c"])).toBe(3);
    const del = calls.find((call) => call.op === "deleteMany")?.args as { where: unknown };
    expect(del.where).toEqual({
      tenantId: "t-1",
      subjectKind: "checkout",
      subjectRef: { in: ["a", "b", "c"] },
    });
  });
});
