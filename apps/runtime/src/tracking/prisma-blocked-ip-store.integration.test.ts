import type { IdGenerator } from "@platform/contracts";
import { createTestPrismaClient, runWithRlsEnforced } from "@platform/db/testing";
import type { Database } from "@platform/db";
import { BlockedIpService, createProfile, type BlockedIpEntry } from "@platform/tracking";
import { describe, expect, it } from "vitest";

import { PrismaBlockedIpStore } from "./prisma-blocked-ip-store";
import { PrismaTrackingProfileStore } from "./prisma-tracking-profile-store";

/**
 * Tracking P1-D9 against a real PostgreSQL. Needs a database migrated through
 * `20261207000000_tracking_blocked_ips`; skipped otherwise:
 *
 *   DATABASE_URL_TEST=postgresql://user:***@localhost:5432/lumo_test pnpm --filter @platform/runtime test
 *
 * NOTE: written against the migration, not yet executed against a database (none is reachable from the
 * authoring environment) — the first run on a real database is the proof. Watch the `skipDuplicates` insert
 * (`ON CONFLICT DO NOTHING` on the unique key) and the RLS refusal first.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() };
const T0 = "2026-11-28T10:00:00.000Z";

function entry(
  tenantId: string,
  cidr: string,
  extra: Partial<BlockedIpEntry> = {},
): BlockedIpEntry {
  return {
    id: crypto.randomUUID(),
    tenantId,
    cidr,
    note: null,
    createdAt: T0,
    createdBy: null,
    ...extra,
  };
}

async function cleanup(prisma: Database, tenantIds: readonly string[]): Promise<void> {
  for (const tenantId of tenantIds) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.trackingBlockedIp.deleteMany({ where: { tenantId } });
      await tx.trackingProfile.deleteMany({ where: { tenantId } });
    });
  }
}

describe.runIf(Boolean(databaseUrl))("tracking.blocked_ips (integration)", () => {
  it("adds, lists oldest first, counts, removes — and keeps two tenants apart", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const a = `tenant-itest-blocked-a-${suffix}`;
    const b = `tenant-itest-blocked-b-${suffix}`;
    try {
      const store = new PrismaBlockedIpStore(prisma);
      const first = entry(a, "203.0.113.7/32", { note: "office", createdBy: "u-1" });
      const second = entry(a, "198.51.100.0/24", { createdAt: "2026-11-28T10:00:05.000Z" });
      expect(await store.add(first)).toMatchObject({ created: true, entry: { cidr: first.cidr } });
      await store.add(second);
      await store.add(entry(b, "203.0.113.7/32"));

      const listed = await store.list(a);
      expect(listed.map((row) => row.cidr)).toEqual(["203.0.113.7/32", "198.51.100.0/24"]);
      expect(listed[0]).toMatchObject({ note: "office", createdBy: "u-1", createdAt: T0 });
      expect(await store.count(a)).toBe(2);
      expect(await store.count(b)).toBe(1);

      // another tenant cannot remove this tenant's row; the owner can, once
      expect(await store.remove(b, first.id)).toBe(false);
      expect(await store.count(a)).toBe(2);
      expect(await store.remove(a, first.id)).toBe(true);
      expect(await store.remove(a, first.id)).toBe(false);
      expect((await store.list(a)).map((row) => row.cidr)).toEqual(["198.51.100.0/24"]);
    } finally {
      await cleanup(prisma, [a, b]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("a repeat add of one range is a no-op that returns the stored row (also under a race)", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-blocked-idem-${crypto.randomUUID()}`;
    try {
      const store = new PrismaBlockedIpStore(prisma);
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => store.add(entry(tenantId, "203.0.113.50/32"))),
      );
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.entry.id)).size).toBe(1);
      expect(await store.count(tenantId)).toBe(1);
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("RLS really applies to the table: another tenant's row is refused and invisible", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const a = `tenant-itest-blocked-rls-a-${suffix}`;
    const b = `tenant-itest-blocked-rls-b-${suffix}`;
    const table = [{ schema: "tracking", table: "blocked_ips" }] as const;
    const row = (tenantId: string) => ({
      id: crypto.randomUUID(),
      tenantId,
      cidr: "203.0.113.9/32",
      createdAt: new Date(T0),
    });
    try {
      // the connection role of the test database is a superuser, which RLS never applies to: the checks
      // below run under a NOBYPASSRLS role so the policies alone decide
      await expect(
        runWithRlsEnforced(prisma, a, table, (tx) => tx.trackingBlockedIp.create({ data: row(a) })),
      ).resolves.toBeDefined();
      await expect(
        runWithRlsEnforced(prisma, a, table, (tx) => tx.trackingBlockedIp.create({ data: row(b) })),
      ).rejects.toThrow(/row-level security/iu);
      await runWithRlsEnforced(prisma, b, table, (tx) =>
        tx.trackingBlockedIp.create({ data: row(b) }),
      );

      const seen = await runWithRlsEnforced(
        prisma,
        a,
        table,
        (tx) =>
          tx.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM "tracking"."blocked_ips"`,
      );
      expect(seen.filter((r) => r.tenant_id === b)).toEqual([]);
      expect(seen.filter((r) => r.tenant_id === a)).toHaveLength(1);
    } finally {
      await cleanup(prisma, [a, b]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("the service over the real store: blocks a listed address, never its neighbour, until removed", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-blocked-svc-${crypto.randomUUID()}`;
    try {
      const service = new BlockedIpService({
        store: new PrismaBlockedIpStore(prisma),
        clock: { now: () => new Date() },
        idGenerator,
        cacheTtlMs: 0,
      });
      const added = await service.excludeDevice(tenantId, { ip: "41.32.7.9", createdBy: "u-1" });
      if (added.status !== "created") throw new Error("expected created");
      expect(await service.isBlocked(tenantId, "41.32.7.9")).toBe(true);
      expect(await service.isBlocked(tenantId, "41.32.7.10")).toBe(false);
      await service.remove(tenantId, added.entry.id);
      expect(await service.isBlocked(tenantId, "41.32.7.9")).toBe(false);
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);
});

describe.runIf(Boolean(databaseUrl))(
  "tracking.tracking_profiles fingerprint lookup (integration)",
  () => {
    it("finds at most two live, recent profiles of one tenant by fingerprint id", async () => {
      const prisma = createTestPrismaClient(databaseUrl);
      const suffix = crypto.randomUUID();
      const a = `tenant-itest-fp-a-${suffix}`;
      const b = `tenant-itest-fp-b-${suffix}`;
      const fp = "f".repeat(32);
      try {
        const store = new PrismaTrackingProfileStore(prisma, idGenerator);
        const mk = (tenantId: string, visitorId: string, at: string) => ({
          ...createProfile({ tenantId, visitorId, at, now: at }),
          fingerprintId: fp,
          lastSeenAt: at,
        });
        await store.persist({
          profile: mk(a, "v-1", "2026-11-27T10:00:00.000Z"),
          aliases: [],
          absorbed: [],
        });
        await store.persist({
          profile: mk(a, "v-old", "2026-10-01T10:00:00.000Z"),
          aliases: [],
          absorbed: [],
        });
        await store.persist({
          profile: mk(b, "v-b", "2026-11-27T10:00:00.000Z"),
          aliases: [],
          absorbed: [],
        });

        const since = new Date("2026-11-20T00:00:00.000Z");
        expect((await store.findByFingerprintId(a, fp, since)).map((p) => p.visitorId)).toEqual([
          "v-1",
        ]);
        expect((await store.findByFingerprintId(b, fp, since)).map((p) => p.visitorId)).toEqual([
          "v-b",
        ]);
        expect(await store.findByFingerprintId(a, "0".repeat(32), since)).toEqual([]);
        await store.persist({
          profile: mk(a, "v-2", "2026-11-27T11:00:00.000Z"),
          aliases: [],
          absorbed: [],
        });
        const two = await store.findByFingerprintId(a, fp, since);
        expect(two.map((p) => p.visitorId)).toEqual(["v-2", "v-1"]);
      } finally {
        await cleanup(prisma, [a, b]);
        await prisma.$disconnect();
      }
    }, 60_000);
  },
);
