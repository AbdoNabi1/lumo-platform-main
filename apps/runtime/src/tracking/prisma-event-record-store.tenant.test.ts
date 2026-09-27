import { describe, expect, it } from "vitest";
import { PrismaEventRecordStore } from "./prisma-event-record-store";

/**
 * G-75 — CLOSED. Found by WP-10's definition-of-done pass, fixed here.
 *
 * The table's unique key is `(tenantId, eventId)`, and the collector accepts a client-supplied
 * `eventId`, so two tenants can legitimately hold a record with the same `eventId`. `appendHistory`
 * and `get` used to address the base row by `eventId` ALONE (`findFirst({ where: { eventId } })`)
 * and take the tenant from whatever row that returned. With two tenants sharing an id, history
 * recorded while delivering tenant B's event landed on tenant A's record (and A's revision count
 * decided B's sequence number). Both ports (`EventRecordStorePort.get`,
 * `EventRecordWriterPort.appendHistory`) now take the tenant explicitly, and every caller already
 * held it — no resolver or ambient lookup was needed.
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

describe("tracking event record store — one eventId, two tenants (G-75, closed)", () => {
  it("history recorded for tenant B's event lands on tenant B's record, not tenant A's", async () => {
    const { db, revisions } = fakeDb();
    let n = 0;
    const store = new PrismaEventRecordStore(db as never, { generate: () => `id-${(n += 1)}` });
    await store.append(base("tenant-a"));
    await store.append(base("tenant-b")); // same eventId, legitimately: the key is (tenantId, eventId)

    // tenant B's delivery runtime records the outcome of ITS event, naming its own tenant.
    await store.appendHistory({
      eventId: "evt-shared",
      tenantId: "tenant-b",
      state: "delivered",
      at: "2026-09-26T00:00:01.000Z",
    });

    expect(revisions.filter((r) => r.tenantId === "tenant-b")).toHaveLength(1);
    expect(revisions.filter((r) => r.tenantId === "tenant-a")).toHaveLength(0);
  });

  it("appendHistory rejects an eventId that only exists under a different tenant, rather than adopting that tenant's row", async () => {
    const { db, revisions } = fakeDb();
    let n = 0;
    const store = new PrismaEventRecordStore(db as never, { generate: () => `id-${(n += 1)}` });
    await store.append(base("tenant-a"));

    await expect(
      store.appendHistory({
        eventId: "evt-shared",
        tenantId: "tenant-b",
        state: "delivered",
        at: "2026-09-26T00:00:01.000Z",
      }),
    ).rejects.toThrow(/no event record/);

    expect(revisions).toHaveLength(0);
  });

  it("tenant B's first revision is revisionSeq 1 even when tenant A already has revisions under the same eventId", async () => {
    const { db, revisions } = fakeDb();
    let n = 0;
    const store = new PrismaEventRecordStore(db as never, { generate: () => `id-${(n += 1)}` });
    await store.append(base("tenant-a"));
    await store.append(base("tenant-b"));

    // tenant A accumulates two revisions first.
    for (const at of ["2026-09-26T00:00:01.000Z", "2026-09-26T00:00:02.000Z"]) {
      await store.appendHistory({
        eventId: "evt-shared",
        tenantId: "tenant-a",
        state: "processing",
        at,
      });
    }

    await store.appendHistory({
      eventId: "evt-shared",
      tenantId: "tenant-b",
      state: "delivered",
      at: "2026-09-26T00:00:03.000Z",
    });

    // Counting revisions across tenants would start B at 3, leaving a gap that reads as two lost
    // revisions in a sequence the record exists to make auditable.
    const forB = revisions.filter((r) => r.tenantId === "tenant-b");
    expect(forB).toHaveLength(1);
    expect(forB[0]?.revisionSeq).toBe(1);
  });

  it("get() for tenant A returns tenant A's record when both tenants share an eventId", async () => {
    const { db } = fakeDb();
    const store = new PrismaEventRecordStore(db as never, { generate: () => "id-1" });
    await store.append(base("tenant-a"));
    await store.append(base("tenant-b"));

    const recordForA = await store.get("evt-shared", "tenant-a");
    expect(recordForA?.tenantId).toBe("tenant-a");
  });

  it("get() returns null for an eventId that exists only under another tenant, not that tenant's record", async () => {
    const { db } = fakeDb();
    const store = new PrismaEventRecordStore(db as never, { generate: () => "id-1" });
    await store.append(base("tenant-a"));

    const recordForOther = await store.get("evt-shared", "tenant-b");
    expect(recordForOther).toBeNull();
  });
});
