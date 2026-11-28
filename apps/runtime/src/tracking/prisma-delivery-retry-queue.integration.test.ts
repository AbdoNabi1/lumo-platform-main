import type { IdGenerator } from "@platform/contracts";
import { runReadScoped, runInTenantTransaction } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import type { DeliveryRetryEntry } from "@platform/tracking";
import { describe, expect, it } from "vitest";
import { PrismaDeliveryRetryQueue } from "./prisma-delivery-retry-queue";

/**
 * Tracking P1-D2 against a real PostgreSQL: the claim is `FOR UPDATE SKIP LOCKED` + a lease, so sweepers
 * that claim at the same instant take DISJOINT rows — no row is sent twice because two workers raced.
 * Needs a migrated test database (including `20261205000000_tracking_delivery_retry`); skipped otherwise:
 *
 *   DATABASE_URL_TEST=postgresql://user:***@localhost:5432/lumo_test pnpm --filter @platform/runtime test
 *
 * NOTE: written against the migration, not yet executed against a database (none is reachable from the
 * authoring environment) — the first run on a real database is the proof.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() };
const T0 = new Date("2026-11-27T10:00:00.000Z");
const MINUTE = 60_000;

function entry(
  tenantId: string,
  n: number,
  overrides: Partial<DeliveryRetryEntry> = {},
): DeliveryRetryEntry {
  return {
    tenantId,
    eventId: `evt-${String(n).padStart(3, "0")}`,
    destination: "ga4.mp.shop",
    platform: "ga4",
    attempts: 1,
    eventTimestamp: new Date(T0.getTime() - 5 * MINUTE),
    windowExpiresAt: new Date(T0.getTime() + 72 * 60 * MINUTE),
    // staggered, all already due at T0
    nextRetryAt: new Date(T0.getTime() - (100 - n) * 1_000),
    lastError: "status 503",
    ...overrides,
  };
}

describe.runIf(Boolean(databaseUrl))("tracking.delivery_retries (integration)", () => {
  it("two (or more) sweepers claiming at once never take the same row", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const tenantA = `tenant-itest-retry-a-${suffix}`;
    const tenantB = `tenant-itest-retry-b-${suffix}`;
    try {
      const queue = new PrismaDeliveryRetryQueue(prisma, idGenerator);
      for (let n = 0; n < 40; n += 1) await queue.schedule(entry(tenantA, n), T0);
      for (let n = 0; n < 10; n += 1) await queue.schedule(entry(tenantB, n), T0);

      const seen = new Map<string, number>();
      for (let round = 0; round < 10; round += 1) {
        const batches = await Promise.all(
          [1, 2, 3, 4].map(() => queue.claimDue({ limit: 20, now: T0, leaseMs: 10 * MINUTE })),
        );
        const claimedThisRound = batches.flat();
        if (claimedThisRound.length === 0) break;
        for (const claimed of claimedThisRound) {
          const key = `${claimed.tenantId}|${claimed.eventId}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }

      const mine = [...seen.entries()].filter(([key]) => key.includes(suffix));
      expect(mine).toHaveLength(50);
      expect(mine.filter(([, times]) => times !== 1)).toEqual([]);
    } finally {
      await prisma.$disconnect();
    }
  }, 60_000);

  it("a claimed row stays reserved until its lease runs out, then comes due again", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-retry-lease-${crypto.randomUUID()}`;
    try {
      const queue = new PrismaDeliveryRetryQueue(prisma, idGenerator);
      await queue.schedule(entry(tenantId, 1), T0);

      // The claim is global (oldest due rows of ANY tenant first, capped at `limit`) and the database is
      // shared with the test above, whose 50 rows come due again at T0 + 10 min with the very same lease
      // time as this row. A small limit would let them take every slot, so the limit leaves room for all.
      const limit = 1_000;
      const first = await queue.claimDue({ limit, now: T0, leaseMs: 10 * MINUTE });
      expect(first.filter((claimed) => claimed.tenantId === tenantId)).toHaveLength(1);

      const during = await queue.claimDue({
        limit,
        now: new Date(T0.getTime() + 5 * MINUTE),
        leaseMs: 10 * MINUTE,
      });
      expect(during.filter((claimed) => claimed.tenantId === tenantId)).toHaveLength(0);

      const after = await queue.claimDue({
        limit,
        now: new Date(T0.getTime() + 11 * MINUTE),
        leaseMs: 10 * MINUTE,
      });
      expect(after.filter((claimed) => claimed.tenantId === tenantId)).toHaveLength(1);
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  it("does not claim rows that are not yet due, or already settled", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-retry-settle-${crypto.randomUUID()}`;
    try {
      const queue = new PrismaDeliveryRetryQueue(prisma, idGenerator);
      await queue.schedule(entry(tenantId, 1), T0);
      await queue.schedule(entry(tenantId, 2), T0);
      await queue.schedule(
        entry(tenantId, 3, { nextRetryAt: new Date(T0.getTime() + 30 * MINUTE) }),
        T0,
      );
      await queue.markDelivered({ tenantId, eventId: "evt-001", destination: "ga4.mp.shop" }, T0);
      await queue.markDeadLettered(
        { tenantId, eventId: "evt-002", destination: "ga4.mp.shop" },
        "window_expired",
        T0,
      );

      const claimed = await queue.claimDue({ limit: 10, now: T0, leaseMs: MINUTE });
      expect(claimed.filter((row) => row.tenantId === tenantId)).toEqual([]);

      const rows = await runReadScoped(prisma, tenantId, (tx) =>
        tx.trackingDeliveryRetry.findMany({ where: { tenantId }, orderBy: { eventId: "asc" } }),
      );
      expect(rows.map((row) => [row.eventId, row.status, row.deadLetterReason])).toEqual([
        ["evt-001", "delivered", null],
        ["evt-002", "dead_lettered", "window_expired"],
        ["evt-003", "pending", null],
      ]);
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  it("parking the same delivery again keeps the existing schedule; reschedule moves it", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-retry-idem-${crypto.randomUUID()}`;
    try {
      const queue = new PrismaDeliveryRetryQueue(prisma, idGenerator);
      const key = { tenantId, eventId: "evt-001", destination: "ga4.mp.shop" };
      await queue.schedule(entry(tenantId, 1), T0);
      await queue.schedule(
        entry(tenantId, 1, { nextRetryAt: new Date(T0.getTime() + 99 * MINUTE), attempts: 7 }),
        T0,
      );
      const later = new Date(T0.getTime() + 5 * MINUTE);
      await queue.reschedule(key, { attempts: 2, nextRetryAt: later, lastError: "status 502" }, T0);

      const rows = await runInTenantTransaction(prisma, tenantId, (tx) =>
        tx.trackingDeliveryRetry.findMany({ where: { tenantId } }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ attempts: 2, lastError: "status 502", status: "pending" });
      expect(rows[0]?.nextRetryAt.getTime()).toBe(later.getTime());
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);
});
