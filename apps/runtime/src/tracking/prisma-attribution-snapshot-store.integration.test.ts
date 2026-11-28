import { createTestPrismaClient, runWithRlsEnforced } from "@platform/db/testing";
import type { Database } from "@platform/db";
import { runTrackingRetention, type BusinessAttributionSnapshot } from "@platform/tracking";
import { InMemoryTrackingProfileStore } from "@platform/tracking";
import { describe, expect, it } from "vitest";

import { PrismaAttributionSnapshotStore } from "./prisma-attribution-snapshot-store";

/**
 * Tracking P2-D8 against a real PostgreSQL. Needs a database migrated through
 * `20261209000000_tracking_attribution_snapshots`; skipped otherwise:
 *
 *   DATABASE_URL_TEST=postgresql://user:***@localhost:5432/lumo_test pnpm --filter @platform/runtime test
 *
 * NOTE: written against the migration, not yet executed against a database (none is reachable from the authoring
 * environment) — the first run on a real database is the proof. Watch the `skipDuplicates` insert (first write
 * wins), the RLS refusal and the `app.retention_scan` read first.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();
const VISITOR = "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b";

const snapshot = (
  overrides: Partial<BusinessAttributionSnapshot> = {},
): BusinessAttributionSnapshot => ({
  visitorId: VISITOR,
  sessionId: "sess-1",
  ip: "203.0.113.9",
  userAgent: "Mozilla/5.0",
  pageUrl: "https://shop.example/checkout",
  cookies: { fbp: "fb.1.1.2", ga: "GA1.1.123.456" },
  clickIds: [{ name: "gclid", value: "Cj0KCQ-abc", capturedAt: NOW.toISOString() }],
  utm: { source: "facebook" },
  ...overrides,
});

const write = (
  tenantId: string,
  subjectRef: string,
  body: BusinessAttributionSnapshot = snapshot(),
  capturedAt: Date = NOW,
) => ({
  tenantId,
  subjectKind: "checkout" as const,
  subjectRef,
  snapshot: body,
  capturedAt: capturedAt.toISOString(),
});

async function cleanup(prisma: Database, tenantIds: readonly string[]): Promise<void> {
  for (const tenantId of tenantIds) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.trackingAttributionSnapshot.deleteMany({ where: { tenantId } });
    });
  }
}

describe.runIf(Boolean(databaseUrl))("tracking.attribution_snapshots (integration)", () => {
  it("stores a snapshot and reads it back field for field; no row is null", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-snap-${crypto.randomUUID()}`;
    try {
      const store = new PrismaAttributionSnapshotStore(prisma);
      expect(await store.find(tenantId, "checkout", "chk-1")).toBeNull();
      expect(await store.putIfAbsent(write(tenantId, "chk-1"))).toBe("created");
      expect(await store.find(tenantId, "checkout", "chk-1")).toEqual(snapshot());
      expect(await store.find(tenantId, "lead", "chk-1")).toBeNull();
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("first write wins: a second write (even a racing one) is 'exists' and changes nothing", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-snap-first-${crypto.randomUUID()}`;
    try {
      const store = new PrismaAttributionSnapshotStore(prisma);
      const racers = await Promise.all(
        ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"].map((ip) =>
          store.putIfAbsent(write(tenantId, "chk-race", snapshot({ ip }))),
        ),
      );
      expect(racers.filter((outcome) => outcome === "created")).toHaveLength(1);
      expect(racers.filter((outcome) => outcome === "exists")).toHaveLength(3);
      const kept = await store.find(tenantId, "checkout", "chk-race");

      expect(
        await store.putIfAbsent(write(tenantId, "chk-race", snapshot({ ip: "198.51.100.7" }))),
      ).toBe("exists");
      expect(await store.find(tenantId, "checkout", "chk-race")).toEqual(kept);
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("the table refuses a subject kind outside checkout / lead", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-snap-check-${crypto.randomUUID()}`;
    try {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx.trackingAttributionSnapshot.create({
            data: { tenantId, subjectKind: "order", subjectRef: "x", capturedAt: NOW },
          });
        }),
      ).rejects.toThrow(/subject_kind_check|violates check constraint/iu);
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("RLS really applies: another tenant's row is refused, invisible, and the retention switch is the only cross-tenant read", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const a = `tenant-itest-snap-rls-a-${suffix}`;
    const b = `tenant-itest-snap-rls-b-${suffix}`;
    const table = [{ schema: "tracking", table: "attribution_snapshots" }] as const;
    const data = (tenantId: string) => ({
      tenantId,
      subjectKind: "checkout",
      subjectRef: "chk-1",
      capturedAt: NOW,
    });
    try {
      // the connection role of the test database is a superuser, which RLS never applies to: the checks below run
      // under a NOBYPASSRLS role so the policies alone decide
      await expect(
        runWithRlsEnforced(prisma, a, table, (tx) =>
          tx.trackingAttributionSnapshot.create({ data: data(a) }),
        ),
      ).resolves.toBeDefined();
      await expect(
        runWithRlsEnforced(prisma, a, table, (tx) =>
          tx.trackingAttributionSnapshot.create({ data: data(b) }),
        ),
      ).rejects.toThrow(/row-level security/iu);
      await runWithRlsEnforced(prisma, b, table, (tx) =>
        tx.trackingAttributionSnapshot.create({ data: data(b) }),
      );

      const seen = await runWithRlsEnforced(
        prisma,
        a,
        table,
        (tx) =>
          tx.$queryRaw<
            { tenant_id: string }[]
          >`SELECT tenant_id FROM "tracking"."attribution_snapshots"`,
      );
      expect(seen.filter((r) => r.tenant_id === b)).toEqual([]);
      expect(seen.filter((r) => r.tenant_id === a)).toHaveLength(1);

      // an update or a delete scoped to tenant A can never reach tenant B's row
      const touched = await runWithRlsEnforced(prisma, a, table, (tx) =>
        tx.trackingAttributionSnapshot.updateMany({ where: { tenantId: b }, data: { ip: null } }),
      );
      expect(touched.count).toBe(0);
      const removed = await runWithRlsEnforced(prisma, a, table, (tx) =>
        tx.trackingAttributionSnapshot.deleteMany({ where: { tenantId: b } }),
      );
      expect(removed.count).toBe(0);

      // the scan sees other tenants only with the explicit switch on
      const scanned = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a}, true)`;
        await tx.$executeRawUnsafe("SET LOCAL ROLE rls_probe");
        const without = await tx.$queryRaw<
          { tenant_id: string }[]
        >`SELECT DISTINCT tenant_id FROM "tracking"."attribution_snapshots"`;
        await tx.$executeRaw`SELECT set_config('app.retention_scan', 'on', true)`;
        const withScan = await tx.$queryRaw<
          { tenant_id: string }[]
        >`SELECT DISTINCT tenant_id FROM "tracking"."attribution_snapshots"`;
        return { without, withScan };
      });
      expect(scanned.without.map((r) => r.tenant_id)).not.toContain(b);
      expect(scanned.withScan.map((r) => r.tenant_id)).toContain(b);
    } finally {
      await cleanup(prisma, [a, b]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("the store never reads or erases another tenant's snapshot, even for the same subject ref", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const a = `tenant-itest-snap-iso-a-${suffix}`;
    const b = `tenant-itest-snap-iso-b-${suffix}`;
    try {
      const store = new PrismaAttributionSnapshotStore(prisma);
      await store.putIfAbsent(write(a, "same-ref", snapshot({ ip: "203.0.113.1" })));
      await store.putIfAbsent(write(b, "same-ref", snapshot({ ip: "203.0.113.2" })));
      expect((await store.find(a, "checkout", "same-ref"))?.ip).toBe("203.0.113.1");
      expect((await store.find(b, "checkout", "same-ref"))?.ip).toBe("203.0.113.2");
      expect(await store.deleteSubjects(a, "checkout", ["same-ref"])).toBe(1);
      expect(await store.find(a, "checkout", "same-ref")).toBeNull();
      expect((await store.find(b, "checkout", "same-ref"))?.ip).toBe("203.0.113.2");
    } finally {
      await cleanup(prisma, [a, b]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("retention end to end: IP and user agent nulled after 90 days, row removed after 400, fresh rows untouched", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-snap-ret-${crypto.randomUUID()}`;
    try {
      const store = new PrismaAttributionSnapshotStore(prisma);
      await store.putIfAbsent(write(tenantId, "fresh", snapshot(), NOW));
      await store.putIfAbsent(
        write(tenantId, "old", snapshot(), new Date(NOW.getTime() - 120 * DAY)),
      );
      await store.putIfAbsent(
        write(tenantId, "ancient", snapshot(), new Date(NOW.getTime() - 450 * DAY)),
      );

      const report = await runTrackingRetention({
        profiles: new InMemoryTrackingProfileStore(),
        events: {
          tenantsWithUnredactedEvents: () => Promise.resolve([]),
          redactBatch: () => Promise.resolve(0),
        },
        snapshots: store,
        clock: { now: () => NOW },
        batchSize: 1,
      });
      // other test tenants may also be due in a shared database: assert at least ours
      expect(report.snapshotsRedacted).toBeGreaterThanOrEqual(1);
      expect(report.snapshotsDeleted).toBeGreaterThanOrEqual(1);

      expect(await store.find(tenantId, "checkout", "ancient")).toBeNull();
      const old = await store.find(tenantId, "checkout", "old");
      expect(old?.ip).toBeUndefined();
      expect(old?.userAgent).toBeUndefined();
      expect(old?.visitorId).toBe(VISITOR);
      expect(old?.clickIds).toHaveLength(1);
      expect(await store.find(tenantId, "checkout", "fresh")).toEqual(snapshot());

      const again = await runTrackingRetention({
        profiles: new InMemoryTrackingProfileStore(),
        events: {
          tenantsWithUnredactedEvents: () => Promise.resolve([]),
          redactBatch: () => Promise.resolve(0),
        },
        snapshots: store,
        clock: { now: () => NOW },
      });
      expect(
        await store.tenantsWithSnapshotWork(
          new Date(NOW.getTime() - 90 * DAY),
          new Date(NOW.getTime() - 400 * DAY),
        ),
      ).not.toContain(tenantId);
      expect(again.errored).toBe(0);
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);
});
