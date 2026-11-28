import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it } from "vitest";
import { createLeadTrackingSweep } from "./lead-tracking-sweep";

beforeEach(() => {
  expect.hasAssertions();
});

const NOW = new Date("2026-11-28T12:00:00.000Z");
const clock = { now: () => NOW };

interface Recorded {
  readonly kind: string;
  readonly detail?: unknown;
}

/** A recording stand-in for the Prisma client: one tenant `t-1` with one pending lead, two minutes and a bit old. */
function fakePrisma(row: { createdAt: Date; trackingStatus: string }) {
  const calls: Recorded[] = [];
  const leadRow = {
    id: "01930000-0000-7000-8000-000000000001",
    tenantId: "t-1",
    formId: "home-form",
    name: "Mona",
    phone: "01012345678",
    phoneE164: "+" + "201012345678",
    email: null,
    message: "private words",
    status: "new",
    trackingStatus: row.trackingStatus,
    eventId: "lead_01930000-0000-7000-8000-000000000001",
    sessionId: "s-1",
    submissionKey: "key-0000001",
    spamReason: null,
    attribution: {},
    version: 0,
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
  };
  const client = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ kind: "executeRaw", detail: values.length > 0 ? values[0] : strings.join("?") });
      return Promise.resolve(1);
    },
    $queryRaw: () => {
      calls.push({ kind: "queryRaw" });
      return Promise.resolve([{ tenant_id: "t-1" }]);
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    lead: {
      findMany: () => {
        calls.push({ kind: "lead.findMany" });
        return Promise.resolve([leadRow]);
      },
      updateMany: (args: unknown) => {
        calls.push({ kind: "lead.updateMany", detail: args });
        return Promise.resolve({ count: 1 });
      },
    },
  };
  return { prisma: client as unknown as Database, calls };
}

describe("createLeadTrackingSweep (P2-D9)", () => {
  it("finds the tenant behind the sweep switch, re-sends its pending lead without the message and marks it sent", async () => {
    const { prisma, calls } = fakePrisma({
      createdAt: new Date(NOW.getTime() - 5 * 60_000),
      trackingStatus: "pending",
    });
    const emitted: unknown[] = [];
    const sweep = createLeadTrackingSweep({
      prisma,
      clock,
      tracking: {
        emit: (subject) => {
          emitted.push(subject);
          return Promise.resolve();
        },
      },
    });

    const report = await sweep();

    expect(report).toEqual({ tenants: 1, scanned: 1, sent: 1, expired: 0, errored: 0 });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      tenantId: "t-1",
      leadId: "01930000-0000-7000-8000-000000000001",
    });
    expect(JSON.stringify(emitted)).not.toContain("private words");
    expect(String(calls[0]?.detail)).toContain("app.tracking_sweep");
    const update = calls.find((call) => call.kind === "lead.updateMany")?.detail as {
      where: unknown;
      data: unknown;
    };
    expect(update.where).toEqual({
      tenantId: "t-1",
      id: "01930000-0000-7000-8000-000000000001",
      trackingStatus: "pending",
    });
    expect(update.data).toEqual({ trackingStatus: "sent", updatedAt: NOW });
  });

  it("marks a lead older than seven days failed and sends nothing", async () => {
    const { prisma, calls } = fakePrisma({
      createdAt: new Date(NOW.getTime() - 8 * 24 * 60 * 60_000),
      trackingStatus: "pending",
    });
    const emitted: unknown[] = [];
    const report = await createLeadTrackingSweep({
      prisma,
      clock,
      tracking: {
        emit: (subject) => {
          emitted.push(subject);
          return Promise.resolve();
        },
      },
    })();
    expect(report.expired).toBe(1);
    expect(emitted).toEqual([]);
    const update = calls.find((call) => call.kind === "lead.updateMany")?.detail as {
      data: { trackingStatus: string };
    };
    expect(update.data.trackingStatus).toBe("failed");
  });
});
