import type { IdGenerator } from "@platform/contracts";
import { runInTenantTransaction } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import {
  TrackingProfileService,
  createProfile,
  runTrackingRetention,
  type TrackingProfile,
} from "@platform/tracking";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PrismaEventNetworkRedaction } from "./prisma-event-network-redaction";
import { PrismaTrackingProfileStore } from "./prisma-tracking-profile-store";

/**
 * Tracking P1-D4 / D10 against a real PostgreSQL. Needs a database migrated through
 * `20261206000000_tracking_profiles`; skipped otherwise:
 *
 *   DATABASE_URL_TEST=postgresql://user:***@localhost:5432/lumo_test pnpm --filter @platform/runtime test
 *
 * NOTE: written against the migration, not yet executed against a database (none is reachable from the
 * authoring environment) — the first run on a real database is the proof. Watch `app.retention_scan`, the
 * `TEXT[]` columns and the conditional `updateMany` (version) first.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() };
const sha = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const T0 = "2026-11-01T10:00:00.000Z";
const NOW = new Date("2026-11-27T10:00:00.000Z");

function profile(
  tenantId: string,
  visitorId: string,
  extra: Partial<TrackingProfile> = {},
): TrackingProfile {
  return { ...createProfile({ tenantId, visitorId, at: T0, now: T0 }), ...extra };
}

describe.runIf(Boolean(databaseUrl))("tracking.tracking_profiles (integration)", () => {
  it("creates, reads by every key, and keeps two tenants apart", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const a = `tenant-itest-profile-a-${suffix}`;
    const b = `tenant-itest-profile-b-${suffix}`;
    try {
      const store = new PrismaTrackingProfileStore(prisma, idGenerator);
      const created = profile(a, "v-1", {
        customerId: "c-1",
        hashes: {
          emailStd: sha("e"),
          phoneE164: sha("+201012345678"),
          phoneDigits: sha("201012345678"),
        },
        clickIds: { ttclid: { value: "x".repeat(900), capturedAt: T0 } },
        browser: { fbp: "fb.1.1.1", fbc: "fb.1.1.2", fbcCapturedAt: T0 },
        leadIds: ["l-1"],
        landing: { utmSource: "meta", at: T0 },
      });
      expect(await store.persist({ profile: created, aliases: ["v-alias"], absorbed: [] })).toBe(
        true,
      );

      for (const found of [
        await store.findByVisitorId(a, "v-1"),
        await store.findByVisitorId(a, "v-alias"),
        await store.findByCustomerId(a, "c-1"),
        await store.findByEmailHash(a, sha("e")),
        await store.findByPhoneHash(a, sha("+201012345678")),
      ]) {
        expect(found?.visitorId).toBe("v-1");
      }
      const read = await store.findByVisitorId(a, "v-1");
      expect(read?.clickIds.ttclid?.value).toHaveLength(900); // untruncated
      expect(read?.landing?.utmSource).toBe("meta");
      expect(read?.leadIds).toEqual(["l-1"]);
      expect(read?.version).toBe(1);

      // the same keys in another tenant find nothing
      expect(await store.findByVisitorId(b, "v-1")).toBeNull();
      expect(await store.findByCustomerId(b, "c-1")).toBeNull();
      expect(await store.findByEmailHash(b, sha("e"))).toBeNull();
      expect(await store.findByPhoneHash(b, sha("+201012345678"))).toBeNull();
    } finally {
      await cleanup(prisma, [a, b]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("two writers that read the same version: exactly one wins", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-profile-race-${crypto.randomUUID()}`;
    try {
      const store = new PrismaTrackingProfileStore(prisma, idGenerator);
      await store.persist({ profile: profile(tenantId, "v-1"), aliases: [], absorbed: [] });
      const read = await store.findByVisitorId(tenantId, "v-1");
      if (read === null) throw new Error("expected a profile");

      const results = await Promise.all(
        ["203.0.113.1", "198.51.100.1", "192.0.2.1", "203.0.113.99"].map((ip) =>
          store.persist({ profile: { ...read, lastIp: ip }, aliases: [], absorbed: [] }),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await store.findByVisitorId(tenantId, "v-1"))?.version).toBe(read.version + 1);

      // creating what exists is a lost race too
      expect(
        await store.persist({ profile: profile(tenantId, "v-1"), aliases: [], absorbed: [] }),
      ).toBe(false);
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("the service folds two cookies of one person into one profile, tombstones and all", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-profile-merge-${crypto.randomUUID()}`;
    try {
      const store = new PrismaTrackingProfileStore(prisma, idGenerator);
      let now = new Date("2026-11-20T10:00:00.000Z");
      const service = new TrackingProfileService({
        store,
        hasher: { sha256Hex: (value) => Promise.resolve(sha(value)) },
        clock: { now: () => now },
      });
      const event = (visitorId: string, extra: Record<string, unknown>) =>
        ({
          eventId: `e-${crypto.randomUUID()}`,
          eventName: "page_viewed",
          eventVersion: 1,
          dedupId: `mb_${crypto.randomUUID()}`,
          timestamp: now.toISOString(),
          receivedAt: now.toISOString(),
          eventTimestampMs: now.getTime(),
          source: "web",
          environment: "production",
          consent: { analytics: true, marketing: true, personalization: true },
          tenancy: { tenantId },
          properties: {},
          context: { session: { visitorId, sessionId: "s" }, ...extra },
        }) as never;

      await service.enrich(
        event("v-phone", { identity: { phone: "+201012345678", hashStatus: "raw" } }),
      );
      now = new Date("2026-11-22T10:00:00.000Z");
      await service.enrich(
        event("v-other", {
          attribution: {
            clickIds: [{ name: "gclid", value: "g-1", capturedAt: now.toISOString() }],
          },
        }),
      );
      now = new Date("2026-11-24T10:00:00.000Z");
      await service.enrich(
        event("v-other", { identity: { phone: "+201012345678", hashStatus: "raw" } }),
      );

      const survivor = await store.findByVisitorId(tenantId, "v-other");
      expect(survivor?.visitorId).toBe("v-phone");
      expect(survivor?.clickIds.gclid?.value).toBe("g-1");
      expect((await store.findByPhoneHash(tenantId, sha("+201012345678")))?.visitorId).toBe(
        "v-phone",
      );

      const rows = await runInTenantTransaction(prisma, tenantId, (tx) =>
        tx.trackingProfile.findMany({ where: { tenantId }, orderBy: { visitorId: "asc" } }),
      );
      expect(rows.map((r) => [r.visitorId, r.mergedInto])).toEqual([
        ["v-other", "v-phone"],
        ["v-phone", null],
      ]);
      const tombstone = rows.find((r) => r.visitorId === "v-other");
      expect([
        tombstone?.phoneE164,
        tombstone?.emailStd,
        tombstone?.lastIp,
        tombstone?.customerId,
      ]).toEqual([null, null, null, null]);
      expect(tombstone?.clickIds).toEqual({});
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("erases a customer with their cookies; deletes only expired ANONYMOUS profiles; the scan finds the tenants", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const a = `tenant-itest-profile-erase-a-${suffix}`;
    const b = `tenant-itest-profile-erase-b-${suffix}`;
    try {
      const store = new PrismaTrackingProfileStore(prisma, idGenerator);
      const expired = { expiresAt: "2026-01-01T00:00:00.000Z" };
      await store.persist({
        profile: profile(a, "v-c1", { customerId: "c-1", ...expired }),
        aliases: ["v-c1-b"],
        absorbed: [],
      });
      await store.persist({ profile: profile(a, "v-anon", expired), aliases: [], absorbed: [] });
      await store.persist({ profile: profile(a, "v-live"), aliases: [], absorbed: [] });
      await store.persist({ profile: profile(b, "v-anon", expired), aliases: [], absorbed: [] });

      expect(await store.tenantsWithExpiredProfiles(NOW)).toEqual(expect.arrayContaining([a, b]));

      expect(await store.deleteExpiredAnonymous(a, NOW)).toBeGreaterThanOrEqual(1);
      expect(await store.findByVisitorId(a, "v-anon")).toBeNull();
      expect(await store.findByVisitorId(a, "v-live")).not.toBeNull();
      expect(await store.findByCustomerId(a, "c-1")).not.toBeNull(); // a customer's profile outlives its date
      expect(await store.findByVisitorId(b, "v-anon")).not.toBeNull(); // another tenant is not this call's business

      expect(await store.eraseCustomer(a, "c-1")).toBe(2);
      expect(await store.findByCustomerId(a, "c-1")).toBeNull();
      expect(await store.findByVisitorId(a, "v-c1-b")).toBeNull();
    } finally {
      await cleanup(prisma, [a, b]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("redacts IP and user agent from old event records only, and the retention pass runs end to end", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-redact-${crypto.randomUUID()}`;
    try {
      const old = new Date(NOW.getTime() - 100 * 24 * 60 * 60 * 1000);
      const recent = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
      const make = (eventId: string, capturedAt: Date) => ({
        id: crypto.randomUUID(),
        tenantId,
        eventId,
        dedupId: `d-${eventId}`,
        eventName: "form_submitted",
        capturedAt,
        envelope: {
          context: {
            technical: {
              clientIpAddress: "203.0.113.7",
              clientUserAgent: "UA",
              deviceType: "mobile",
            },
          },
        },
        consent: {},
        identity: {},
        versions: {},
        stageHistory: [],
        destinationHistory: [
          {
            destination: "meta.capi",
            renderedPayload: {
              data: [{ user_data: { client_ip_address: "203.0.113.7", em: ["h"] } }],
            },
          },
        ],
        state: "delivered",
      });
      await prisma.trackingEventRecord.createMany({
        data: [make("e-old", old), make("e-recent", recent)],
      });
      await prisma.trackingEventRevision.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          eventId: "e-old",
          revisionSeq: 1,
          destinations: [
            {
              destination: "meta.capi",
              renderedPayload: { data: [{ user_data: { client_ip_address: "203.0.113.7" } }] },
            },
          ],
          state: "delivered",
          at: old,
        },
      });

      const report = await runTrackingRetention({
        profiles: new PrismaTrackingProfileStore(prisma, idGenerator),
        events: new PrismaEventNetworkRedaction(prisma),
        clock: { now: () => NOW },
      });
      expect(report.errored).toBe(0);
      expect(report.eventsRedacted).toBeGreaterThanOrEqual(1);

      const rows = await prisma.trackingEventRecord.findMany({
        where: { tenantId },
        orderBy: { eventId: "asc" },
      });
      const [oldRow, recentRow] = rows;
      expect(oldRow?.eventId).toBe("e-old");
      expect(JSON.stringify(oldRow?.envelope)).not.toContain("203.0.113.7");
      expect(JSON.stringify(oldRow?.envelope)).toContain("mobile"); // the rest is kept
      expect(JSON.stringify(oldRow?.destinationHistory)).not.toContain("203.0.113.7");
      expect(JSON.stringify(oldRow?.destinationHistory)).toContain('"em":["h"]');
      expect(oldRow?.networkRedactedAt).not.toBeNull();
      expect(JSON.stringify(recentRow?.envelope)).toContain("203.0.113.7");
      expect(recentRow?.networkRedactedAt).toBeNull();
      const revision = await prisma.trackingEventRevision.findFirst({
        where: { tenantId, eventId: "e-old" },
      });
      expect(JSON.stringify(revision?.destinations)).not.toContain("203.0.113.7");
    } finally {
      await prisma.trackingEventRevision.deleteMany({ where: { tenantId } });
      await prisma.trackingEventRecord.deleteMany({ where: { tenantId } });
      await prisma.$disconnect();
    }
  }, 60_000);
});

async function cleanup(
  prisma: ReturnType<typeof createTestPrismaClient>,
  tenantIds: string[],
): Promise<void> {
  for (const tenantId of tenantIds) {
    await runInTenantTransaction(prisma, tenantId, (tx) =>
      tx.trackingProfile.deleteMany({ where: { tenantId } }),
    );
  }
}
