import { runInTenantTransaction, type Database } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Connection, type ConnectionProps } from "../domain/connection";
import type { ConnectionRepository } from "../domain/connection-repository";
import { describeConnectionUseCases } from "../testing/connection-use-case-suite";
import { InMemoryConnectionRepository } from "./in-memory-connection-repository";
import { PrismaConnectionRepository } from "./prisma-connection-repository";

/**
 * Runs only against a throwaway database (never a real one):
 *
 *   DATABASE_URL_TEST=postgresql://lumo:<password>@localhost:5432/lumo_test pnpm --filter @platform/ad-platforms test
 *
 * (the migration `20261123000000_ad_platform_connections` must be applied to it). The use-case suite runs
 * over the in-memory repository and over the Prisma repository on a real database, so the two are proven to
 * behave the same (round trip, version guard, unique row per shop and platform, RLS). The Prisma entries
 * are skipped unless `DATABASE_URL_TEST` is set.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

/** Tenants the shared suite uses; their rows are wiped around every case (ids repeat per case). */
const SUITE_TENANTS = ["t-1", "t-2"] as const;

beforeEach(() => {
  expect.hasAssertions();
});

let prisma: Database | undefined;

function database(): Database {
  if (prisma === undefined) throw new Error("the test database client is not open");
  return prisma;
}

async function wipe(tenantIds: readonly string[]): Promise<void> {
  for (const tenantId of tenantIds) {
    await runInTenantTransaction(database(), tenantId, (tx) =>
      tx.adPlatformConnection.deleteMany({ where: { tenantId } }),
    );
  }
}

const targets: { name: string; needsDatabase: boolean; makeRepo: () => ConnectionRepository }[] = [
  { name: "in-memory", needsDatabase: false, makeRepo: () => new InMemoryConnectionRepository() },
  {
    name: "Prisma",
    needsDatabase: true,
    makeRepo: () => new PrismaConnectionRepository({ prisma: database() }),
  },
];

describe.each(targets)(
  "use cases over the $name repository (integration)",
  ({ needsDatabase, makeRepo }) => {
    describe.runIf(!needsDatabase || Boolean(databaseUrl))("suite", () => {
      if (needsDatabase) {
        beforeAll(() => {
          prisma = createTestPrismaClient(databaseUrl);
        });
        beforeEach(() => wipe(SUITE_TENANTS));
        afterAll(async () => {
          await wipe(SUITE_TENANTS);
          await database().$disconnect();
          prisma = undefined;
        });
      }
      describeConnectionUseCases(makeRepo);
    });
  },
);

const NOW = new Date("2026-11-23T10:00:00.000Z");

function connectionOf(over: Partial<ConnectionProps> = {}): Connection {
  return Connection.restore({
    id: crypto.randomUUID(),
    platform: "meta",
    enabled: true,
    publicConfig: { platform: "meta", pixelId: "123456789012345" },
    sealedSecret: '{"v":1,"alias":"a","wrappedDek":"w","ciphertext":"c"}',
    secretLast4: "abcd",
    testEventCode: "TEST1",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });
}

describe.runIf(Boolean(databaseUrl))("PrismaConnectionRepository against a real database", () => {
  beforeAll(() => {
    prisma = createTestPrismaClient(databaseUrl);
  });
  const tenants: string[] = [];
  const tenantOf = (): string => {
    const tenantId = `it-${crypto.randomUUID()}`;
    tenants.push(tenantId);
    return tenantId;
  };
  afterAll(async () => {
    await wipe(tenants);
    await database().$disconnect();
    prisma = undefined;
  });

  it("round-trips every column and isolates tenants (RLS)", async () => {
    const repo = new PrismaConnectionRepository({ prisma: database() });
    const a = tenantOf();
    const b = tenantOf();
    const connection = connectionOf();
    expect(await repo.save(a, connection, null)).toBe(true);
    expect((await repo.get(a, "meta"))?.props).toEqual(connection.props);
    expect(await repo.get(b, "meta")).toBeNull();
    expect(await repo.list(b)).toHaveLength(0);
    expect(await repo.save(b, connectionOf({ version: 2 }), 1)).toBe(false);
  });

  it("refuses a second row for the same shop and platform, but not for another shop", async () => {
    const repo = new PrismaConnectionRepository({ prisma: database() });
    const a = tenantOf();
    const b = tenantOf();
    expect(await repo.save(a, connectionOf(), null)).toBe(true);
    expect(await repo.save(a, connectionOf(), null)).toBe(false);
    expect(await repo.save(b, connectionOf(), null)).toBe(true);
  });

  it("updates only at the expected version and stores SQL NULLs for cleared columns", async () => {
    const repo = new PrismaConnectionRepository({ prisma: database() });
    const a = tenantOf();
    const row = connectionOf();
    expect(await repo.save(a, row, null)).toBe(true);
    const next = connectionOf({
      id: row.props.id,
      version: 2,
      enabled: false,
      publicConfig: null,
      sealedSecret: null,
      secretLast4: null,
      testEventCode: null,
    });
    expect(await repo.save(a, next, 5)).toBe(false);
    expect(await repo.save(a, next, 1)).toBe(true);
    expect((await repo.get(a, "meta"))?.props).toEqual(next.props);
  });

  it("the database itself refuses a secret on google_ads and an unknown platform (CHECK constraints)", async () => {
    const a = tenantOf();
    const base = connectionOf();
    const create = (data: Record<string, unknown>) =>
      runInTenantTransaction(database(), a, (tx) =>
        tx.adPlatformConnection.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: a,
            platform: "meta",
            createdAt: NOW,
            updatedAt: NOW,
            ...data,
          },
        }),
      );
    await expect(
      create({ platform: "google_ads", sealedSecret: base.props.sealedSecret }),
    ).rejects.toThrow();
    await expect(create({ platform: "myspace" })).rejects.toThrow();
  });

  it("the database refuses a row written for another tenant than the one set on the transaction (RLS WITH CHECK)", async () => {
    const a = tenantOf();
    const b = tenantOf();
    await expect(
      runInTenantTransaction(database(), a, (tx) =>
        tx.adPlatformConnection.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: b,
            platform: "meta",
            createdAt: NOW,
            updatedAt: NOW,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
