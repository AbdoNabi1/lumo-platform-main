import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runInTenantTransaction, type Database } from "@platform/db";
import { createTestPrismaClient, runWithRlsEnforced } from "@platform/db/testing";
import { leadOf } from "../testing/fixtures";
import { PrismaLeadRepository } from "./prisma-lead-repository";

/**
 * Tracking P2-D9 against a real PostgreSQL: the pending-tracking reads and writes of `PrismaLeadRepository` and the
 * row-level security around them. Needs a database migrated through `20261210000000_leads_tracking_pending`; skipped
 * without one:
 *
 *   DATABASE_URL_TEST=postgresql://user:***@localhost:5432/lumo_test pnpm --filter @platform/leads test
 *
 * The test connection role is a superuser, to which RLS never applies; the policy checks therefore run under
 * `runWithRlsEnforced` (a NOBYPASSRLS role), which is what makes a refusal here a refusal by the policy.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

beforeEach(() => {
  expect.hasAssertions();
});

const MINUTE = 60_000;
// Far in the future on purpose: the shared use-case suite (prisma-lead-repository.integration.test.ts) runs on the same
// database in a parallel worker and its sweeper passes scan EVERY tenant's pending leads older than its own (2026) cut-offs;
// leads created here must never fall inside them, or that suite would settle this file's leads under its feet.
const BASE = new Date("2036-01-01T10:00:00.000Z");
const LEADS_TABLE = [{ schema: "leads", table: "leads" }] as const;

describe.runIf(Boolean(databaseUrl))("pending lead tracking (integration)", () => {
  let prisma: Database | undefined;
  const tenants: string[] = [];

  const db = (): Database => {
    if (prisma === undefined) throw new Error("the test database client is not open");
    return prisma;
  };
  const tenantOf = (): string => {
    const tenantId = `it-track-${crypto.randomUUID()}`;
    tenants.push(tenantId);
    return tenantId;
  };
  const leadAt = (
    minutes: number,
    over: Parameters<typeof leadOf>[0] = {},
  ): ReturnType<typeof leadOf> => {
    const createdAt = new Date(BASE.getTime() + minutes * MINUTE);
    return leadOf({
      id: crypto.randomUUID(),
      submissionKey: `it-${crypto.randomUUID()}`,
      createdAt,
      updatedAt: createdAt,
      ...over,
    });
  };

  beforeAll(() => {
    prisma = createTestPrismaClient(databaseUrl);
  });
  afterAll(async () => {
    for (const tenantId of tenants) {
      await runInTenantTransaction(db(), tenantId, (tx) =>
        tx.lead.deleteMany({ where: { tenantId } }),
      );
    }
    await db().$disconnect();
    prisma = undefined;
  });

  it("lists only pending leads of the asked tenant, oldest first, before the cutoff", async () => {
    const repo = new PrismaLeadRepository({ prisma: db() });
    const a = tenantOf();
    const b = tenantOf();
    const first = leadAt(1);
    const second = leadAt(2);
    await repo.insert(a, second);
    await repo.insert(a, first);
    await repo.insert(a, leadAt(3, { trackingStatus: "sent" }));
    await repo.insert(a, leadAt(4, { trackingStatus: "suppressed" }));
    await repo.insert(a, leadAt(50));
    await repo.insert(b, leadAt(1));

    const cutoff = new Date(BASE.getTime() + 10 * MINUTE);
    const rows = await repo.listPendingTracking(a, { createdBefore: cutoff, limit: 10 });
    expect(rows.map((lead) => lead.props.id)).toEqual([first.props.id, second.props.id]);
    expect(await repo.listPendingTracking(a, { createdBefore: cutoff, limit: 1 })).toHaveLength(1);
    expect(rows.every((lead) => lead.props.trackingStatus === "pending")).toBe(true);
  });

  it("names the tenants with something pending before the cutoff, and no one else", async () => {
    const repo = new PrismaLeadRepository({ prisma: db() });
    const withPending = tenantOf();
    const onlySent = tenantOf();
    const onlyYoung = tenantOf();
    await repo.insert(withPending, leadAt(1));
    await repo.insert(onlySent, leadAt(1, { trackingStatus: "sent" }));
    await repo.insert(onlyYoung, leadAt(30));

    const found = await repo.listTenantsWithPendingTracking(
      new Date(BASE.getTime() + 10 * MINUTE),
      1000,
    );
    expect(found).toContain(withPending);
    expect(found).not.toContain(onlySent);
    expect(found).not.toContain(onlyYoung);
  });

  it("markTracking settles a pending lead once, refuses another tenant's, and leaves the version alone", async () => {
    const repo = new PrismaLeadRepository({ prisma: db() });
    const a = tenantOf();
    const b = tenantOf();
    const lead = leadAt(1);
    await repo.insert(a, lead);
    const at = new Date(BASE.getTime() + 20 * MINUTE);

    expect(await repo.markTracking(b, lead.props.id, "sent", at)).toBe(false);
    expect((await repo.get(a, lead.props.id))?.props.trackingStatus).toBe("pending");
    expect(await repo.markTracking(a, lead.props.id, "sent", at)).toBe(true);
    expect(await repo.markTracking(a, lead.props.id, "failed", at)).toBe(false);
    const stored = await repo.get(a, lead.props.id);
    expect(stored?.props.trackingStatus).toBe("sent");
    expect(stored?.props.version).toBe(0);
    expect(stored?.props.updatedAt).toEqual(at);
  });

  it("RLS: a tenant never sees another tenant's leads, pending or not, without the sweep switch", async () => {
    const repo = new PrismaLeadRepository({ prisma: db() });
    const a = tenantOf();
    const b = tenantOf();
    await repo.insert(a, leadAt(1));

    const seenByB = await runWithRlsEnforced(
      db(),
      b,
      LEADS_TABLE,
      (tx) =>
        tx.$queryRaw<
          { tenant_id: string }[]
        >`SELECT tenant_id FROM "leads"."leads" WHERE tenant_id = ${a}`,
    );
    expect(seenByB).toEqual([]);
    const seenByA = await runWithRlsEnforced(
      db(),
      a,
      LEADS_TABLE,
      (tx) =>
        tx.$queryRaw<
          { tenant_id: string }[]
        >`SELECT tenant_id FROM "leads"."leads" WHERE tenant_id = ${a}`,
    );
    expect(seenByA).toHaveLength(1);
  });

  it("RLS: the sweep switch opens PENDING rows for reading only, in every tenant, and nothing else", async () => {
    const repo = new PrismaLeadRepository({ prisma: db() });
    const a = tenantOf();
    const b = tenantOf();
    const outsider = tenantOf();
    await repo.insert(a, leadAt(1));
    await repo.insert(a, leadAt(2, { trackingStatus: "sent" }));
    await repo.insert(b, leadAt(1));
    await repo.insert(b, leadAt(2, { trackingStatus: "suppressed" }));

    const swept = await runWithRlsEnforced(db(), outsider, LEADS_TABLE, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tracking_sweep', 'on', true)`;
      return tx.$queryRaw<{ tenant_id: string; tracking_status: string }[]>`
        SELECT tenant_id, tracking_status FROM "leads"."leads" WHERE tenant_id IN (${a}, ${b})`;
    });
    expect(swept.map((row) => row.tracking_status)).toEqual(["pending", "pending"]);
    expect(new Set(swept.map((row) => row.tenant_id))).toEqual(new Set([a, b]));

    // the switch grants no write: an update of another tenant's pending row changes nothing...
    const changed = await runWithRlsEnforced(db(), outsider, LEADS_TABLE, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tracking_sweep', 'on', true)`;
      return tx.$executeRaw`UPDATE "leads"."leads" SET tracking_status = 'sent' WHERE tenant_id = ${a}`;
    });
    expect(changed).toBe(0);
    // ...and the same query without the switch finds nothing at all
    const without = await runWithRlsEnforced(
      db(),
      outsider,
      LEADS_TABLE,
      (tx) =>
        tx.$queryRaw<
          { tenant_id: string }[]
        >`SELECT tenant_id FROM "leads"."leads" WHERE tenant_id IN (${a}, ${b})`,
    );
    expect(without).toEqual([]);
    expect(
      (
        await repo.listPendingTracking(a, {
          createdBefore: new Date(BASE.getTime() + 60 * MINUTE),
          limit: 5,
        })
      ).length,
    ).toBe(1);
  });
});
