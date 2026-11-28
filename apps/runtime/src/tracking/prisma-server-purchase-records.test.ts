import type { Database } from "@platform/db";
import { businessMessageId } from "@platform/tracking";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaServerPurchaseRecords } from "./prisma-server-purchase-records";

beforeEach(() => {
  expect.hasAssertions();
});

function fakeDb(row: { eventId: string } | null) {
  const calls: unknown[] = [];
  const raw: unknown[] = [];
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      raw.push({ sql: strings.join("?"), values });
      return Promise.resolve(1);
    },
    trackingEventRecord: {
      findFirst: (args: unknown) => {
        calls.push(args);
        return Promise.resolve(row);
      },
    },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { db, calls, raw };
}

describe("PrismaServerPurchaseRecords", () => {
  it("asks for the SERVER-origin purchase record of ord_<orderId>, under the tenant, nothing else", async () => {
    const { db, calls, raw } = fakeDb({ eventId: "x" });
    await expect(
      new PrismaServerPurchaseRecords(db).hasServerPurchase("t-1", "order-9"),
    ).resolves.toBe(true);
    expect(calls).toEqual([
      {
        where: {
          tenantId: "t-1",
          eventId: businessMessageId("t-1", "ord_order-9"),
          eventName: "purchase",
          // a browser may claim `ord_order-9`; only an envelope the server built counts
          envelope: { path: ["eventOrigin"], equals: "server" },
        },
        select: { eventId: true },
      },
    ]);
    expect(JSON.stringify(raw)).toContain("t-1");
  });

  it("is false when there is no such record", async () => {
    const { db } = fakeDb(null);
    await expect(
      new PrismaServerPurchaseRecords(db).hasServerPurchase("t-1", "order-9"),
    ).resolves.toBe(false);
  });

  it("the id looked up is tenant-specific: the same order under another tenant is another event id", async () => {
    const a = fakeDb(null);
    const b = fakeDb(null);
    await new PrismaServerPurchaseRecords(a.db).hasServerPurchase("t-1", "order-9");
    await new PrismaServerPurchaseRecords(b.db).hasServerPurchase("t-2", "order-9");
    const idOf = (calls: unknown[]) => (calls[0] as { where: { eventId: string } }).where.eventId;
    expect(idOf(a.calls)).not.toBe(idOf(b.calls));
  });
});
