import { createTestPrismaClient, runWithRlsEnforced } from "@platform/db/testing";
import type { Database } from "@platform/db";
import { TrackingSettingsService } from "@platform/tracking";
import { describe, expect, it } from "vitest";

import { PrismaTrackingStoreSettingsStore } from "./prisma-tracking-store-settings";

/**
 * Tracking P2-D1 against a real PostgreSQL. Needs a database migrated through
 * `20261208000000_tracking_store_settings`; skipped otherwise:
 *
 *   DATABASE_URL_TEST=postgresql://user:***@localhost:5432/lumo_test pnpm --filter @platform/runtime test
 *
 * NOTE: written against the migration, not yet executed against a database (none is reachable from the authoring
 * environment) — the first run on a real database is the proof. Watch the first-save `skipDuplicates` insert, the
 * version-guarded update and the RLS refusal first.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const T0 = "2026-11-28T10:00:00.000Z";

async function cleanup(prisma: Database, tenantIds: readonly string[]): Promise<void> {
  for (const tenantId of tenantIds) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.trackingStoreSettings.deleteMany({ where: { tenantId } });
    });
  }
}

const save = (
  store: PrismaTrackingStoreSettingsStore,
  tenantId: string,
  expectedVersion: number,
  extra: { consentPolicy?: "notice_only" | "opt_in"; cookieNoticeEnabled?: boolean } = {},
) =>
  store.save({
    tenantId,
    consentPolicy: extra.consentPolicy ?? "opt_in",
    cookieNoticeEnabled: extra.cookieNoticeEnabled ?? false,
    expectedVersion,
    updatedAt: T0,
  });

describe.runIf(Boolean(databaseUrl))("tracking.store_tracking_settings (integration)", () => {
  it("no row is null; a first save creates version 1; later saves bump it; two tenants stay apart", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const a = `tenant-itest-settings-a-${suffix}`;
    const b = `tenant-itest-settings-b-${suffix}`;
    try {
      const store = new PrismaTrackingStoreSettingsStore(prisma);
      expect(await store.get(a)).toBeNull();

      expect(await save(store, a, 0)).toEqual({
        tenantId: a,
        consentPolicy: "opt_in",
        cookieNoticeEnabled: false,
        version: 1,
        updatedAt: T0,
      });
      expect(await save(store, a, 1, { consentPolicy: "notice_only" })).toMatchObject({
        consentPolicy: "notice_only",
        version: 2,
      });
      expect(await store.get(b)).toBeNull();
      expect(await save(store, b, 0, { cookieNoticeEnabled: true })).toMatchObject({
        tenantId: b,
        version: 1,
      });
      expect(await store.get(a)).toMatchObject({ consentPolicy: "notice_only", version: 2 });
    } finally {
      await cleanup(prisma, [a, b]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("a stale version or a second first-save is a conflict and changes nothing (also under a race)", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-settings-cas-${crypto.randomUUID()}`;
    try {
      const store = new PrismaTrackingStoreSettingsStore(prisma);
      const racers = await Promise.all([1, 2, 3, 4].map(() => save(store, tenantId, 0)));
      expect(racers.filter((result) => result !== null)).toHaveLength(1);
      expect((await store.get(tenantId))?.version).toBe(1);

      expect(await save(store, tenantId, 5)).toBeNull();
      expect(await save(store, tenantId, 0)).toBeNull();
      expect((await store.get(tenantId))?.version).toBe(1);

      const updates = await Promise.all(
        [1, 2, 3].map(() => save(store, tenantId, 1, { consentPolicy: "notice_only" })),
      );
      expect(updates.filter((result) => result !== null)).toHaveLength(1);
      expect((await store.get(tenantId))?.version).toBe(2);
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("the table refuses a policy outside notice_only / opt_in", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-settings-check-${crypto.randomUUID()}`;
    try {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx.trackingStoreSettings.create({
            data: {
              tenantId,
              consentPolicy: "banner_with_reject",
              cookieNoticeEnabled: true,
              version: 1,
              updatedAt: new Date(T0),
            },
          });
        }),
      ).rejects.toThrow(/consent_policy_check|violates check constraint/iu);
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("RLS really applies to the table: another tenant's row is refused and invisible", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const a = `tenant-itest-settings-rls-a-${suffix}`;
    const b = `tenant-itest-settings-rls-b-${suffix}`;
    const table = [{ schema: "tracking", table: "store_tracking_settings" }] as const;
    const data = (tenantId: string) => ({
      tenantId,
      consentPolicy: "opt_in",
      cookieNoticeEnabled: true,
      version: 1,
      updatedAt: new Date(T0),
    });
    try {
      // the connection role of the test database is a superuser, which RLS never applies to: the checks below run
      // under a NOBYPASSRLS role so the policies alone decide
      await expect(
        runWithRlsEnforced(prisma, a, table, (tx) =>
          tx.trackingStoreSettings.create({ data: data(a) }),
        ),
      ).resolves.toBeDefined();
      await expect(
        runWithRlsEnforced(prisma, a, table, (tx) =>
          tx.trackingStoreSettings.create({ data: data(b) }),
        ),
      ).rejects.toThrow(/row-level security/iu);
      await runWithRlsEnforced(prisma, b, table, (tx) =>
        tx.trackingStoreSettings.create({ data: data(b) }),
      );

      const seen = await runWithRlsEnforced(
        prisma,
        a,
        table,
        (tx) =>
          tx.$queryRaw<
            { tenant_id: string }[]
          >`SELECT tenant_id FROM "tracking"."store_tracking_settings"`,
      );
      expect(seen.filter((r) => r.tenant_id === b)).toEqual([]);
      expect(seen.filter((r) => r.tenant_id === a)).toHaveLength(1);

      // and an update scoped to tenant A can never reach tenant B's row
      const touched = await runWithRlsEnforced(prisma, a, table, (tx) =>
        tx.trackingStoreSettings.updateMany({
          where: { tenantId: b },
          data: { consentPolicy: "notice_only" },
        }),
      );
      expect(touched.count).toBe(0);
    } finally {
      await cleanup(prisma, [a, b]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("the service over the real store: defaults, save, 409-style conflict, and a policy read", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-settings-svc-${crypto.randomUUID()}`;
    try {
      const service = new TrackingSettingsService({
        store: new PrismaTrackingStoreSettingsStore(prisma),
        clock: { now: () => new Date(T0) },
        cacheTtlMs: 0,
      });
      expect(await service.get(tenantId)).toMatchObject({
        version: 0,
        consentPolicy: "notice_only",
      });
      expect(await service.consentPolicyFor(tenantId)).toBe("notice_only");
      const first = await service.update(tenantId, {
        consentPolicy: "opt_in",
        cookieNoticeEnabled: false,
        expectedVersion: 0,
      });
      expect(first).toMatchObject({ status: "saved", settings: { version: 1 } });
      expect(await service.consentPolicyFor(tenantId)).toBe("opt_in");
      expect(await service.cookieNoticeEnabledFor(tenantId)).toBe(false);
      const stale = await service.update(tenantId, {
        consentPolicy: "notice_only",
        cookieNoticeEnabled: true,
        expectedVersion: 0,
      });
      expect(stale).toMatchObject({
        status: "conflict",
        current: { version: 1, consentPolicy: "opt_in" },
      });
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);
});
