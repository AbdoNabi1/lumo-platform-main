import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaTrackingStoreSettingsStore } from "./prisma-tracking-store-settings";

/**
 * Statement-level tests: no database is reachable from here, so what is pinned is what the adapter ASKS the database —
 * the tenant is set first and named in every `where`, a first save is a skip-duplicates insert, a later save is a
 * version-guarded update. The behaviour on a real database is the gated integration test's.
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
    findFirst?: () => unknown;
    createMany?: () => { count: number };
    updateMany?: () => { count: number };
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
    trackingStoreSettings: {
      findFirst: record("findFirst", handlers.findFirst, null),
      createMany: record("createMany", handlers.createMany, { count: 1 }),
      updateMany: record("updateMany", handlers.updateMany, { count: 1 }),
    },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { db, calls };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  tenantId: "t-1",
  consentPolicy: "opt_in",
  cookieNoticeEnabled: false,
  version: 1,
  updatedAt: new Date(T0),
  ...overrides,
});

const ops = (calls: readonly Call[]): string[] => calls.map((call) => call.op);

describe("PrismaTrackingStoreSettingsStore", () => {
  it("get sets the tenant first, names it in the where, and maps the row", async () => {
    const { db, calls } = fakeDb({ findFirst: () => row() });
    const settings = await new PrismaTrackingStoreSettingsStore(db).get("t-1");

    expect(ops(calls)).toEqual(["raw", "findFirst"]);
    expect(calls[0]?.args).toMatchObject({ values: expect.arrayContaining(["t-1"]) });
    expect(calls[1]?.args).toMatchObject({ where: { tenantId: "t-1" } });
    expect(settings).toEqual({
      tenantId: "t-1",
      consentPolicy: "opt_in",
      cookieNoticeEnabled: false,
      version: 1,
      updatedAt: T0,
    });
  });

  it("get answers null for a store with no row", async () => {
    const { db } = fakeDb();
    expect(await new PrismaTrackingStoreSettingsStore(db).get("t-1")).toBeNull();
  });

  it("a stored policy the code does not know is an error, not a guess", async () => {
    const { db } = fakeDb({ findFirst: () => row({ consentPolicy: "banner_with_reject" }) });
    await expect(new PrismaTrackingStoreSettingsStore(db).get("t-1")).rejects.toThrow(
      /unknown consent_policy/,
    );
  });

  it("a first save (expectedVersion 0) is a skip-duplicates insert of version 1, then a read-back", async () => {
    const { db, calls } = fakeDb({ findFirst: () => row() });
    const saved = await new PrismaTrackingStoreSettingsStore(db).save({
      tenantId: "t-1",
      consentPolicy: "opt_in",
      cookieNoticeEnabled: false,
      expectedVersion: 0,
      updatedAt: T0,
    });

    expect(ops(calls)).toEqual(["raw", "createMany", "findFirst"]);
    expect(calls[1]?.args).toMatchObject({
      skipDuplicates: true,
      data: [
        {
          tenantId: "t-1",
          consentPolicy: "opt_in",
          cookieNoticeEnabled: false,
          version: 1,
          updatedAt: new Date(T0),
        },
      ],
    });
    expect(calls[2]?.args).toMatchObject({ where: { tenantId: "t-1" } });
    expect(saved?.version).toBe(1);
  });

  it("a first save that loses a race (the row exists) is a conflict: null, nothing read back", async () => {
    const { db, calls } = fakeDb({ createMany: () => ({ count: 0 }) });
    const saved = await new PrismaTrackingStoreSettingsStore(db).save({
      tenantId: "t-1",
      consentPolicy: "notice_only",
      cookieNoticeEnabled: true,
      expectedVersion: 0,
      updatedAt: T0,
    });
    expect(saved).toBeNull();
    expect(ops(calls)).toEqual(["raw", "createMany"]);
  });

  it("a later save updates only the row at the expected version, in the tenant, and bumps it", async () => {
    const { db, calls } = fakeDb({ findFirst: () => row({ version: 4 }) });
    const saved = await new PrismaTrackingStoreSettingsStore(db).save({
      tenantId: "t-1",
      consentPolicy: "notice_only",
      cookieNoticeEnabled: true,
      expectedVersion: 3,
      updatedAt: T0,
    });

    expect(ops(calls)).toEqual(["raw", "updateMany", "findFirst"]);
    expect(calls[1]?.args).toMatchObject({
      where: { tenantId: "t-1", version: 3 },
      data: {
        consentPolicy: "notice_only",
        cookieNoticeEnabled: true,
        version: 4,
        updatedAt: new Date(T0),
      },
    });
    expect(saved?.version).toBe(4);
  });

  it("a later save against a stale version updates nothing and answers null", async () => {
    const { db, calls } = fakeDb({ updateMany: () => ({ count: 0 }) });
    const saved = await new PrismaTrackingStoreSettingsStore(db).save({
      tenantId: "t-1",
      consentPolicy: "notice_only",
      cookieNoticeEnabled: true,
      expectedVersion: 2,
      updatedAt: T0,
    });
    expect(saved).toBeNull();
    expect(ops(calls)).toEqual(["raw", "updateMany"]);
  });
});
