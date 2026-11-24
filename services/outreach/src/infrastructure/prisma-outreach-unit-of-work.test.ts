import type { Database, TransactionClient } from "@platform/db";
import { describe, expect, it } from "vitest";
import { PrismaPhoneDirectory } from "./prisma-outreach-repositories";
import {
  PrismaOutreachUnitOfWork,
  tenantScopeOf,
  withPlatformScope,
} from "./prisma-outreach-unit-of-work";

interface Statement {
  sql: string;
  values: unknown[];
}

/** A fake `Database` whose `$transaction` hands `fn` one recording client, in order, with commit/rollback outcome. */
function fakeDatabase() {
  const statements: Statement[] = [];
  const outcomes: ("commit" | "rollback")[] = [];
  const clients: TransactionClient[] = [];
  const client = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({ sql: strings.join("?").replace(/\s+/g, " ").trim(), values });
      return Promise.resolve(1);
    },
    whatsAppPhoneDirectory: {
      findFirst: (args: unknown) => {
        statements.push({ sql: "findFirst", values: [args] });
        return Promise.resolve(null);
      },
    },
  } as unknown as TransactionClient;
  const prisma = {
    $transaction: async (fn: (tx: TransactionClient) => Promise<unknown>) => {
      clients.push(client);
      try {
        const result = await fn(client);
        outcomes.push("commit");
        return result;
      } catch (error) {
        outcomes.push("rollback");
        throw error;
      }
    },
  } as unknown as Database;
  return { prisma, statements, outcomes, clients };
}

const SET_CONFIG = "SELECT set_config('app.tenant_id', ?, true)";

describe("PrismaOutreachUnitOfWork (tenant scope, no database)", () => {
  it("the first statement of every transaction is set_config with the trusted tenant, before any work", async () => {
    expect.hasAssertions();
    const { prisma, statements } = fakeDatabase();
    const uow = new PrismaOutreachUnitOfWork(prisma);
    await uow.run("shop-1", (tx) => {
      expect(statements).toEqual([{ sql: SET_CONFIG, values: ["shop-1"] }]);
      expect(tenantScopeOf(tx)).toBe("shop-1");
      return Promise.resolve();
    });
    await uow.run("shop-2", () => Promise.resolve());
    expect(statements.map((s) => [s.sql, s.values[0]])).toEqual([
      [SET_CONFIG, "shop-1"],
      [SET_CONFIG, "shop-2"],
    ]);
  });

  it("refuses an empty or blank tenant before opening a transaction", async () => {
    expect.hasAssertions();
    const { prisma, clients } = fakeDatabase();
    const uow = new PrismaOutreachUnitOfWork(prisma);
    await expect(uow.run("", () => Promise.resolve())).rejects.toThrow(/non-empty tenant id/);
    await expect(uow.run("   ", () => Promise.resolve())).rejects.toThrow(/non-empty tenant id/);
    expect(clients).toHaveLength(0);
  });

  it("rolls back when the work throws, and the scope stays bound only to the opened transaction", async () => {
    expect.hasAssertions();
    const { prisma, outcomes } = fakeDatabase();
    const uow = new PrismaOutreachUnitOfWork(prisma);
    await expect(uow.run("shop-1", () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(outcomes).toEqual(["rollback"]);
    expect(tenantScopeOf({})).toBeUndefined();
    expect(tenantScopeOf(undefined)).toBeUndefined();
  });
});

describe("withPlatformScope / directory scope switching (no database)", () => {
  it("switches to the platform scope, runs, and restores the shop scope in the SAME transaction", async () => {
    expect.hasAssertions();
    const { prisma, statements, outcomes } = fakeDatabase();
    const uow = new PrismaOutreachUnitOfWork(prisma);
    const result = await uow.run("shop-1", (tx) =>
      withPlatformScope(tx as TransactionClient, "platform", "shop-1", () => {
        statements.push({ sql: "work", values: [] });
        return Promise.resolve("done");
      }),
    );
    expect(result).toBe("done");
    expect(outcomes).toEqual(["commit"]);
    expect(statements.map((s) => [s.sql, s.values[0]])).toEqual([
      [SET_CONFIG, "shop-1"],
      [SET_CONFIG, "platform"],
      ["work", undefined],
      [SET_CONFIG, "shop-1"],
    ]);
  });

  it("restores the shop scope when the directory work throws, and the error still surfaces", async () => {
    expect.hasAssertions();
    const { prisma, statements, outcomes } = fakeDatabase();
    const uow = new PrismaOutreachUnitOfWork(prisma);
    await expect(
      uow.run("shop-1", (tx) =>
        withPlatformScope(tx as TransactionClient, "platform", "shop-1", () =>
          Promise.reject(new Error("directory failed")),
        ),
      ),
    ).rejects.toThrow("directory failed");
    expect(outcomes).toEqual(["rollback"]);
    expect(statements.map((s) => s.values[0])).toEqual(["shop-1", "platform", "shop-1"]);
  });

  it("a directory call inside a unit-of-work transaction is platform-scoped between two shop-scoped statements", async () => {
    expect.hasAssertions();
    const { prisma, statements } = fakeDatabase();
    const uow = new PrismaOutreachUnitOfWork(prisma);
    const directory = new PrismaPhoneDirectory({ prisma, platformTenantId: "platform" });
    await uow.run("shop-1", (tx) => directory.find("100000000001", tx));
    expect(statements.map((s) => (s.sql === SET_CONFIG ? s.values[0] : s.sql))).toEqual([
      "shop-1",
      "platform",
      "findFirst",
      "shop-1",
    ]);
  });

  it("a standalone directory call opens its own platform-scoped transaction", async () => {
    expect.hasAssertions();
    const { prisma, statements, clients } = fakeDatabase();
    const directory = new PrismaPhoneDirectory({ prisma, platformTenantId: "platform" });
    await directory.find("100000000001");
    expect(clients).toHaveLength(1);
    expect(statements.map((s) => (s.sql === SET_CONFIG ? s.values[0] : s.sql))).toEqual([
      "platform",
      "findFirst",
    ]);
  });
});
