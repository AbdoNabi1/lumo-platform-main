import type { Database, TransactionClient } from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  PrismaProcessedUsageRecordStore,
  USAGE_RECORD_CONSUMER_GROUP,
} from "./prisma-processed-usage-record-store";

const RECORD_A = "00000000-0000-7000-8000-00000000000a";
const RECORD_B = "00000000-0000-7000-8000-00000000000b";
const NOW = new Date("2026-09-29T10:00:00.000Z");
const clock = { now: () => NOW };

interface Row {
  readonly consumerGroup: string;
  readonly messageId: string;
}

/**
 * A fake of only the `processedEvent` calls the real path makes, through `PrismaProcessedEventStore`:
 * `findUnique` (its `has`) and `create` (its `recordIfNew`). It models the real table's one relevant
 * property — a composite primary key on `(consumerGroup, messageId)` — the way Prisma reports it: a
 * duplicate `create` THROWS a `PrismaClientKnownRequestError` with `code: "P2002"`, which the kernel
 * store turns into `false`. `rows` is shared between the base client and the transaction client.
 */
function fakeClient(label: string, rows: Row[], failWith?: Error) {
  const calls: string[] = [];
  const client = {
    processedEvent: {
      findUnique: async (args: {
        where: { consumerGroup_messageId: { consumerGroup: string; messageId: string } };
      }) => {
        calls.push(`${label}:findUnique`);
        const key = args.where.consumerGroup_messageId;
        return rows.some(
          (r) => r.consumerGroup === key.consumerGroup && r.messageId === key.messageId,
        )
          ? { messageId: key.messageId }
          : null;
      },
      create: async (args: { data: Row & { processedAt: Date } }) => {
        calls.push(`${label}:create`);
        if (failWith !== undefined) throw failWith;
        const { consumerGroup, messageId } = args.data;
        if (rows.some((r) => r.consumerGroup === consumerGroup && r.messageId === messageId)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        rows.push({ consumerGroup, messageId });
        return args.data;
      },
    },
  };
  return { client, calls };
}

function setup(options: { txFailure?: Error } = {}) {
  const rows: Row[] = [];
  const base = fakeClient("base", rows);
  const tx = fakeClient("tx", rows, options.txFailure);
  const store = new PrismaProcessedUsageRecordStore(base.client as unknown as Database, clock);
  return { store, base, tx, rows, txClient: tx.client as unknown as TransactionClient };
}

describe("PrismaProcessedUsageRecordStore (durable replay safety for RecordUsage)", () => {
  it("reports a record as unprocessed until it is marked, then as processed", async () => {
    const { store, txClient } = setup();

    expect(await store.hasProcessed(RECORD_A, txClient)).toBe(false);
    await store.markProcessed(RECORD_A, txClient);
    expect(await store.hasProcessed(RECORD_A, txClient)).toBe(true);
    expect(await store.hasProcessed(RECORD_B, txClient)).toBe(false);
  });

  it("writes the marker through the caller's transaction, so it commits with the counter", async () => {
    // CHANGED from "reads and writes through the transaction": `hasProcessed` now reads through the
    // BASE client (only the advisory fast path; `PrismaProcessedEventStore.has` takes no `tx`), so
    // only the WRITE is asserted to go through `tx`, and the read is asserted to stay off it.
    const { store, base, tx, txClient } = setup();

    await store.hasProcessed(RECORD_A, txClient);
    await store.markProcessed(RECORD_A, txClient);

    expect(tx.calls).toEqual(["tx:create"]);
    expect(base.calls).toEqual(["base:findUnique"]);
  });

  it("keys the marker under its own consumer group, apart from the runtime's inbox rows", async () => {
    const { store, rows, txClient } = setup();

    await store.markProcessed(RECORD_A, txClient);

    expect(rows).toEqual([{ consumerGroup: USAGE_RECORD_CONSUMER_GROUP, messageId: RECORD_A }]);
    expect(USAGE_RECORD_CONSUMER_GROUP).toBe("licensing.usage-record");
  });

  it("refuses a second mark of the same record so the losing concurrent transaction rolls back", async () => {
    // CHANGED: the duplicate is now a thrown P2002 on `create` (which `recordIfNew` maps to `false`)
    // rather than `createMany({ skipDuplicates })` returning `count: 0`.
    const { store, txClient } = setup();
    await store.markProcessed(RECORD_A, txClient);

    await expect(store.markProcessed(RECORD_A, txClient)).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("does not turn an unrelated database failure into a duplicate", async () => {
    const { store, txClient } = setup({ txFailure: new Error("connection reset") });

    const failure = await store.markProcessed(RECORD_A, txClient).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ConcurrencyError);
  });

  it("falls back to the base client for a read made outside any transaction", async () => {
    const { store, base } = setup();

    expect(await store.hasProcessed(RECORD_A)).toBe(false);
    expect(base.calls).toEqual(["base:findUnique"]);
  });

  it("refuses to mark outside a transaction: a marker that can commit apart from its counter is the bug", async () => {
    // Strengthened: also asserts nothing was written through the base client.
    const { store, base, rows } = setup();

    await expect(store.markProcessed(RECORD_A)).rejects.toThrow(/transaction/i);

    expect(base.calls).toEqual([]);
    expect(rows).toEqual([]);
  });
});
