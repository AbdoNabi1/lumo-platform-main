import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runInTenantTransaction, type Database } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import type { LeadRepository } from "../domain/lead-repository";
import { describeLeadUseCases } from "../testing/lead-use-case-suite";
import { leadOf } from "../testing/fixtures";
import { InMemoryLeadRepository } from "./in-memory-lead-repository";
import { PrismaLeadRepository } from "./prisma-lead-repository";

/**
 * Runs only against a throwaway database (never a real one):
 *
 *   DATABASE_URL_TEST=postgresql://lumo:***@localhost:5432/lumo_test pnpm --filter @platform/leads test
 *
 * The Task 1 use-case suite runs over the in-memory repository and over the Prisma repository on a
 * real database, so the two are proven to behave the same (search, order, cursor, version guard,
 * unique submission key, RLS). The Prisma entry is skipped unless `DATABASE_URL_TEST` is set.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

/** Tenants the shared suite uses; their rows are wiped around every case (ids and keys repeat per case). */
const SUITE_TENANTS = ["t-1", "t-2"] as const;

beforeEach(() => {
  expect.hasAssertions();
});

let prisma: Database | undefined;

function database(): Database {
  if (prisma === undefined) throw new Error("the test database client is not open");
  return prisma;
}

async function wipeSuiteTenants(): Promise<void> {
  for (const tenantId of SUITE_TENANTS) {
    await runInTenantTransaction(database(), tenantId, (tx) =>
      tx.lead.deleteMany({ where: { tenantId } }),
    );
  }
}

const targets: { name: string; needsDatabase: boolean; makeRepo: () => LeadRepository }[] = [
  { name: "in-memory", needsDatabase: false, makeRepo: () => new InMemoryLeadRepository() },
  {
    name: "Prisma",
    needsDatabase: true,
    makeRepo: () => new PrismaLeadRepository({ prisma: database() }),
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
        beforeEach(wipeSuiteTenants);
        afterAll(async () => {
          await wipeSuiteTenants();
          await database().$disconnect();
          prisma = undefined;
        });
      }
      describeLeadUseCases(makeRepo);
    });
  },
);

describe.runIf(Boolean(databaseUrl))("PrismaLeadRepository against a real database", () => {
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
    for (const tenantId of tenants) {
      await runInTenantTransaction(database(), tenantId, (tx) =>
        tx.lead.deleteMany({ where: { tenantId } }),
      );
    }
    await database().$disconnect();
    prisma = undefined;
  });

  it("round-trips every field, attribution included, and isolates tenants (RLS)", async () => {
    const repo = new PrismaLeadRepository({ prisma: database() });
    const a = tenantOf();
    const b = tenantOf();
    const lead = leadOf({
      id: crypto.randomUUID(),
      submissionKey: `it-${crypto.randomUUID()}`,
      message: "hello",
      attribution: {
        pageUrl: "https://shop.example/",
        referrer: "https://google.com/",
        ip: "203.0.113.9",
        userAgent: "ua",
        cookies: { fbp: "fb.1.2.3" },
      },
    });
    expect(await repo.insert(a, lead)).toBe("inserted");
    expect((await repo.get(a, lead.props.id))?.props).toEqual(lead.props);
    expect(await repo.get(b, lead.props.id)).toBeNull();
    expect(await repo.list(b, { first: 10 })).toHaveLength(0);
    expect(await repo.updateStatus(b, lead.withStatus("contacted", new Date()))).toBe(false);
  });

  it("refuses a second lead with the same submission key per tenant but not across tenants", async () => {
    const repo = new PrismaLeadRepository({ prisma: database() });
    const a = tenantOf();
    const b = tenantOf();
    const key = `it-${crypto.randomUUID()}`;
    expect(await repo.insert(a, leadOf({ id: crypto.randomUUID(), submissionKey: key }))).toBe(
      "inserted",
    );
    expect(await repo.insert(a, leadOf({ id: crypto.randomUUID(), submissionKey: key }))).toBe(
      "duplicate",
    );
    expect(await repo.insert(b, leadOf({ id: crypto.randomUUID(), submissionKey: key }))).toBe(
      "inserted",
    );
  });

  it("markPendingIfSuppressed upgrades only a suppressed row of that tenant, key and session", async () => {
    const repo = new PrismaLeadRepository({ prisma: database() });
    const a = tenantOf();
    const b = tenantOf();
    const key = `it-${crypto.randomUUID()}`;
    const lead = leadOf({
      id: crypto.randomUUID(),
      submissionKey: key,
      sessionId: "s-mark",
      trackingStatus: "suppressed",
    });
    expect(await repo.insert(a, lead)).toBe("inserted");
    expect(await repo.markPendingIfSuppressed(b, key, "s-mark")).toBe(false);
    expect(await repo.markPendingIfSuppressed(a, key, "s-other")).toBe(false);
    expect(await repo.markPendingIfSuppressed(a, key, "s-mark")).toBe(true);
    expect(await repo.markPendingIfSuppressed(a, key, "s-mark")).toBe(false);
    const stored = await repo.get(a, lead.props.id);
    expect(stored?.props.trackingStatus).toBe("pending");
    expect(stored?.props.version).toBe(1);
  });
});
