import { describe, expect, it } from "vitest";
import type { Database, TransactionClient } from "@platform/db";
import type { OutboxWriter } from "@platform/messaging";
import { PrismaJournalRepository } from "./prisma-finance-repositories";

const fakeOutbox = { write: async () => {} } as unknown as OutboxWriter<TransactionClient>;

/**
 * Phase A.15 (Task 8) - `findBySourceRef` used to call `ledgerEntry.findMany` once PER journal row
 * (N+1: found by static reading, A.14 Section 13). This proves the fixed implementation issues
 * exactly one batched `ledgerEntry.findMany` call regardless of how many journal rows are returned,
 * instead of one call per row. Asserting `ledgerEntryFindManyCalls === 1` for N=5 rows is the
 * query-count proof the pre-fix implementation could not have passed (it would have recorded 5
 * calls, one per row).
 */
function buildFakeDb(journalCount: number): {
  db: Database;
  ledgerEntryFindManyCalls: () => number;
} {
  const journalRows = Array.from({ length: journalCount }, (_, i) => ({
    id: `journal-${i}`,
    sourceRef: "order-123",
    currency: "USD",
    reversalOfJournalId: null,
    postedAt: new Date("2026-08-12T00:00:00.000Z"),
  }));
  const ledgerRows = journalRows.map((row) => ({
    id: `line-${row.id}`,
    journalId: row.id,
    sourceRef: row.sourceRef,
    accountRef: "revenue",
    direction: "credit",
    amountMinor: 1000,
    currency: "USD",
    memo: null,
    postedAt: new Date("2026-08-12T00:00:00.000Z"),
  }));

  let calls = 0;
  const db = {
    journal: {
      findMany: async () => journalRows,
    },
    ledgerEntry: {
      findMany: async (args: { where: { journalId: { in: readonly string[] } } }) => {
        calls += 1;
        const ids = new Set(args.where.journalId.in);
        return ledgerRows.filter((line) => ids.has(line.journalId));
      },
    },
  } as unknown as Database;

  return { db, ledgerEntryFindManyCalls: () => calls };
}

describe("Task 8 - PrismaJournalRepository.findBySourceRef N+1 elimination", () => {
  it("issues exactly one batched ledgerEntry.findMany call for N journal rows, not one per row", async () => {
    const { db, ledgerEntryFindManyCalls } = buildFakeDb(5);
    const repo = new PrismaJournalRepository({
      prisma: db,
      outbox: fakeOutbox,
      context: {} as never,
    });

    // A fake `tx` (the fake db itself) bypasses `readWith`'s `runReadScoped` fallback, which would
    // otherwise call the fake client's nonexistent `$transaction` — this test is about the N+1
    // batching logic, not about tenant-scoped-read wrapping.
    const journals = await repo.findBySourceRef("order-123", "tenant-a", db);

    expect(journals).toHaveLength(5);
    expect(ledgerEntryFindManyCalls()).toBe(1);
  });

  it("each returned journal carries only its own ledger lines after batching", async () => {
    const { db } = buildFakeDb(3);
    const repo = new PrismaJournalRepository({
      prisma: db,
      outbox: fakeOutbox,
      context: {} as never,
    });

    const journals = await repo.findBySourceRef("order-123", "tenant-a", db);

    for (const [i, journal] of journals.entries()) {
      expect(journal.id.toString()).toBe(`journal-${i}`);
      expect(journal.lines).toHaveLength(1);
    }
  });

  it("returns an empty array without querying ledger entries when no journals match", async () => {
    const { db, ledgerEntryFindManyCalls } = buildFakeDb(0);
    const repo = new PrismaJournalRepository({
      prisma: db,
      outbox: fakeOutbox,
      context: {} as never,
    });

    const journals = await repo.findBySourceRef("order-none", "tenant-a", db);

    expect(journals).toHaveLength(0);
    expect(ledgerEntryFindManyCalls()).toBe(0);
  });
});
