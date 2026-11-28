import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaEventNetworkRedaction } from "./prisma-event-network-redaction";

beforeEach(() => {
  expect.hasAssertions();
});

interface RecordRow {
  id: string;
  tenantId: string;
  eventId: string;
  capturedAt: Date;
  networkRedactedAt: Date | null;
  envelope: unknown;
  destinationHistory: unknown;
}
interface RevisionRow {
  id: string;
  tenantId: string;
  eventId: string;
  destinations: unknown;
}

const CUTOFF = new Date("2026-08-29T10:00:00.000Z");
const AT = new Date("2026-11-27T10:00:00.000Z");

const envelope = (ip: string) => ({
  eventId: "e",
  context: {
    page: { url: "https://shop.example/" },
    technical: { clientIpAddress: ip, clientUserAgent: "UA", deviceType: "mobile" },
  },
});
const rendered = (ip: string) => [
  {
    destination: "meta.capi",
    status: "delivered",
    renderedPayload: {
      data: [{ user_data: { em: ["h"], client_ip_address: ip, client_user_agent: "UA" } }],
    },
  },
];

function world(records: RecordRow[], revisions: RevisionRow[]) {
  const writes: { model: string; where: Record<string, unknown>; data: Record<string, unknown> }[] =
    [];
  const reads: { model: string; where: Record<string, unknown> }[] = [];
  const tx = {
    $executeRaw: () => Promise.resolve(1),
    trackingEventRecord: {
      findMany: (args: { where: Record<string, unknown>; take: number }) => {
        reads.push({ model: "record", where: args.where });
        const tenant = args.where["tenantId"];
        return Promise.resolve(
          records
            .filter(
              (r) => r.tenantId === tenant && r.networkRedactedAt === null && r.capturedAt < CUTOFF,
            )
            .slice(0, args.take),
        );
      },
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        writes.push({ model: "record", ...args });
        const row = records.find(
          (r) => r.id === args.where["id"] && r.tenantId === args.where["tenantId"],
        );
        if (row !== undefined) Object.assign(row, args.data);
        return Promise.resolve({ count: row === undefined ? 0 : 1 });
      },
    },
    trackingEventRevision: {
      findMany: (args: { where: { tenantId: string; eventId: { in: string[] } } }) => {
        reads.push({ model: "revision", where: args.where });
        return Promise.resolve(
          revisions.filter(
            (r) => r.tenantId === args.where.tenantId && args.where.eventId.in.includes(r.eventId),
          ),
        );
      },
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        writes.push({ model: "revision", ...args });
        const row = revisions.find(
          (r) => r.id === args.where["id"] && r.tenantId === args.where["tenantId"],
        );
        if (row !== undefined) Object.assign(row, args.data);
        return Promise.resolve({ count: row === undefined ? 0 : 1 });
      },
    },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    $queryRaw: () => Promise.resolve([{ tenant_id: "t-1" }]),
  } as unknown as Database;
  return { db, writes, reads };
}

describe("PrismaEventNetworkRedaction", () => {
  it("removes IP and user agent from the envelope, the rendered payloads and the revisions of old records — and nothing else", async () => {
    const records: RecordRow[] = [
      {
        id: "r-1",
        tenantId: "t-1",
        eventId: "e-1",
        capturedAt: new Date("2026-08-01T00:00:00.000Z"),
        networkRedactedAt: null,
        envelope: envelope("203.0.113.7"),
        destinationHistory: rendered("203.0.113.7"),
      },
    ];
    const revisions: RevisionRow[] = [
      { id: "v-1", tenantId: "t-1", eventId: "e-1", destinations: rendered("203.0.113.7") },
    ];
    const { db } = world(records, revisions);

    const redacted = await new PrismaEventNetworkRedaction(db).redactBatch("t-1", CUTOFF, 100, AT);

    expect(redacted).toBe(1);
    const row = records[0];
    expect(row?.networkRedactedAt).toEqual(AT);
    expect(row?.envelope).toEqual({
      eventId: "e",
      context: { page: { url: "https://shop.example/" }, technical: { deviceType: "mobile" } },
    });
    expect(JSON.stringify(row?.destinationHistory)).not.toContain("203.0.113.7");
    expect(JSON.stringify(row?.destinationHistory)).toContain('"em":["h"]');
    expect(JSON.stringify(revisions[0]?.destinations)).not.toContain("203.0.113.7");
    expect(JSON.stringify(revisions[0]?.destinations)).not.toContain("client_user_agent");
  });

  it("names the tenant in every read and write, and never touches another tenant's records", async () => {
    const mk = (id: string, tenantId: string): RecordRow => ({
      id,
      tenantId,
      eventId: `e-${id}`,
      capturedAt: new Date("2026-08-01T00:00:00.000Z"),
      networkRedactedAt: null,
      envelope: envelope("203.0.113.7"),
      destinationHistory: [],
    });
    const records = [mk("r-1", "t-1"), mk("r-2", "t-2")];
    const { db, writes, reads } = world(records, []);

    await new PrismaEventNetworkRedaction(db).redactBatch("t-1", CUTOFF, 100, AT);

    for (const read of reads) expect(read.where["tenantId"]).toBe("t-1");
    for (const write of writes) expect(write.where["tenantId"]).toBe("t-1");
    expect(records[1]?.networkRedactedAt).toBeNull();
    expect(JSON.stringify(records[1]?.envelope)).toContain("203.0.113.7");
  });

  it("marks records that held nothing to remove (so they are never revisited) without rewriting their JSON", async () => {
    const records: RecordRow[] = [
      {
        id: "r-1",
        tenantId: "t-1",
        eventId: "e-1",
        capturedAt: new Date("2026-08-01T00:00:00.000Z"),
        networkRedactedAt: null,
        envelope: { context: { technical: { deviceType: "mobile" } } },
        destinationHistory: [],
      },
    ];
    const { db, writes } = world(records, []);
    await new PrismaEventNetworkRedaction(db).redactBatch("t-1", CUTOFF, 100, AT);

    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0]?.data ?? {})).toEqual(["networkRedactedAt"]);
  });

  it("leaves records newer than the cutoff alone, and honours the batch size", async () => {
    const mk = (n: number, capturedAt: string): RecordRow => ({
      id: `r-${String(n)}`,
      tenantId: "t-1",
      eventId: `e-${String(n)}`,
      capturedAt: new Date(capturedAt),
      networkRedactedAt: null,
      envelope: envelope("203.0.113.7"),
      destinationHistory: [],
    });
    const records = [
      mk(1, "2026-08-01T00:00:00.000Z"),
      mk(2, "2026-08-02T00:00:00.000Z"),
      mk(3, "2026-08-03T00:00:00.000Z"),
      mk(4, "2026-11-01T00:00:00.000Z"), // 26 days old: inside the retention
    ];
    const { db } = world(records, []);
    const job = new PrismaEventNetworkRedaction(db);

    expect(await job.redactBatch("t-1", CUTOFF, 2, AT)).toBe(2);
    expect(await job.redactBatch("t-1", CUTOFF, 2, AT)).toBe(1);
    expect(await job.redactBatch("t-1", CUTOFF, 2, AT)).toBe(0);
    expect(records[3]?.networkRedactedAt).toBeNull();
    expect(JSON.stringify(records[3]?.envelope)).toContain("203.0.113.7");
  });

  it("finds the tenants with work through a read that returns tenant ids only", async () => {
    const { db } = world([], []);
    expect(await new PrismaEventNetworkRedaction(db).tenantsWithUnredactedEvents(CUTOFF)).toEqual([
      "t-1",
    ]);
  });
});
