import { describe, expect, it } from "vitest";
import { PrismaEventRecordStore } from "./prisma-event-record-store";

/**
 * G-75 — OPEN, held executable (the same way G-70 was before it closed). Found by WP-10's definition-of-
 * done pass, NOT fixed in it.
 *
 * The table's unique key is `(tenantId, eventId)`, and the collector accepts a client-supplied
 * `eventId`, so two tenants can legitimately hold a record with the same `eventId`. But
 * `appendHistory` and `get` address the base row by `eventId` ALONE (`findFirst({ where: { eventId } })`)
 * and then take the tenant from whatever row that returned. With two tenants sharing an id, history
 * recorded while delivering tenant B's event is written onto tenant A's record (and A's revision count
 * decides B's sequence number). The port (`EventRecordWriterPort.appendHistory`) carries no tenant, so
 * this is not a one-line filter: it needs a port change in packages/tracking.
 *
 * `it.fails` makes this a passing suite today and a RED one the day it is fixed — at which point flip it
 * to `it` and delete this note. TENANT_MODE=multi is not safe to enable while it holds.
 */
interface Row {
  id: string;
  tenantId: string;
  eventId: string;
  [k: string]: unknown;
}

function fakeDb() {
  const records: Row[] = [];
  const revisions: Row[] = [];
  const matches = (row: Row, where: Record<string, unknown> | undefined) =>
    Object.entries(where ?? {}).every(([k, v]) => row[k] === v);
  const db = {
    trackingEventRecord: {
      create: async ({ data }: { data: Row }) => void records.push(data),
      findFirst: async ({ where }: { where?: Record<string, unknown> }) =>
        records.find((r) => matches(r, where)) ?? null,
      findMany: async ({ where }: { where?: Record<string, unknown> }) =>
        records.filter((r) => matches(r, where)),
    },
    trackingEventRevision: {
      create: async ({ data }: { data: Row }) => void revisions.push(data),
      findMany: async ({ where }: { where?: Record<string, unknown> }) =>
        revisions.filter((r) => matches(r, where)),
      count: async ({ where }: { where?: Record<string, unknown> }) =>
        revisions.filter((r) => matches(r, where)).length,
    },
  };
  return { db, revisions };
}

const base = (tenantId: string) =>
  ({
    tenantId,
    eventId: "evt-shared",
    dedupId: "d",
    eventName: "page_view",
    capturedAt: "2026-09-26T00:00:00.000Z",
    envelope: {},
    consentSnapshot: {},
    identitySnapshot: {},
    versions: {},
    stageHistory: [],
    destinationHistory: [],
    state: "captured",
  }) as never;

describe("tracking event record store — one eventId, two tenants (G-75, OPEN)", () => {
  it.fails(
    "history recorded for tenant B's event lands on tenant B's record, not tenant A's",
    async () => {
      const { db, revisions } = fakeDb();
      let n = 0;
      const store = new PrismaEventRecordStore(db as never, { generate: () => `id-${(n += 1)}` });
      await store.append(base("tenant-a"));
      await store.append(base("tenant-b")); // same eventId, legitimately: the key is (tenantId, eventId)

      // tenant B's delivery runtime records the outcome of ITS event. The port names no tenant.
      await store.appendHistory({
        eventId: "evt-shared",
        state: "delivered",
        at: "2026-09-26T00:00:01.000Z",
      });

      expect(revisions.filter((r) => r.tenantId === "tenant-b")).toHaveLength(1);
      expect(revisions.filter((r) => r.tenantId === "tenant-a")).toHaveLength(0);
    },
  );
});
