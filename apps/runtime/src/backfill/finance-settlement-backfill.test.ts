import type { Journal, JournalRepository } from "@platform/finance";
import { describe, expect, it } from "vitest";
import {
  backfillFinanceSettlement,
  type BackfillUnitOfWork,
  type CapturedPaymentRecord,
  type IssuedRefundRecord,
  type PaymentSettlementSource,
} from "./finance-settlement-backfill";

const POSTING_ACCOUNTS = {
  revenue: "4000-REVENUE",
  receivable: "1200-ACCOUNTS-RECEIVABLE",
  cogs: "5000-COGS",
  inventory: "1300-INVENTORY",
  refundContra: "4900-REFUNDS",
  expense: "6000-EXPENSES",
  cash: "1000-CASH",
  fees: "6100-FEES",
};

/** Fixture-seedable in-memory `JournalRepository` — no Prisma, no DATABASE_URL_TEST needed. */
class InMemoryJournalRepository implements JournalRepository {
  private readonly rows = new Map<string, Journal>();

  async append(journal: Journal): Promise<void> {
    this.rows.set(journal.id.toString(), journal);
  }

  async findById(id: string): Promise<Journal | null> {
    return this.rows.get(id) ?? null;
  }

  async findBySourceRef(sourceRef: string): Promise<readonly Journal[]> {
    return [...this.rows.values()].filter((journal) => journal.sourceRef === sourceRef);
  }

  get all(): readonly Journal[] {
    return [...this.rows.values()];
  }
}

/** Fixture-seedable fake of the Payments-side read source — the "seeded fixtures" T11.3 calls for. */
function fakeSource(
  captured: readonly CapturedPaymentRecord[],
  refunds: readonly IssuedRefundRecord[],
): PaymentSettlementSource {
  return {
    listCapturedPayments: async () => captured,
    listCompletedRefunds: async () => refunds,
  };
}

let idCounter = 0;
function freshDeps(source: PaymentSettlementSource) {
  idCounter = 0;
  const journals = new InMemoryJournalRepository();
  const unitOfWork: BackfillUnitOfWork = { run: async (work) => work(undefined) };
  return {
    deps: {
      source,
      journals,
      postingAccounts: POSTING_ACCOUNTS,
      idGenerator: { generate: () => `journal-${(idCounter += 1)}` },
      clock: { now: () => new Date("2026-09-09T00:00:00.000Z") },
      unitOfWork,
    },
    journals,
  };
}

describe("backfillFinanceSettlement (WP-11 T11.3)", () => {
  it("posts a fee entry for a captured payment with no existing finance entry", async () => {
    const { deps, journals } = freshDeps(
      fakeSource([{ orderRef: "ORD-1", amountMinor: 5_000, currency: "EUR" }], []),
    );

    const result = await backfillFinanceSettlement(deps);

    expect(result).toEqual({ ordersInspected: 1, feeEntriesPosted: 1, contraEntriesPosted: 0 });
    const posted = await journals.findBySourceRef("ORD-1");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.lines.some((line) => line.memo === "fee")).toBe(true);
    expect(posted[0]?.lines.map((line) => line.amount.amountMinor)).toEqual([5_000, 5_000]);
  });

  it("posts a contra entry for an issued refund with no existing finance entry", async () => {
    const { deps, journals } = freshDeps(
      fakeSource(
        [],
        [
          {
            refundId: "refund-1",
            orderRef: "ORD-1",
            amountMinor: 1_500,
            currency: "EUR",
            occurredAt: new Date("2026-09-01T00:00:00.000Z"),
          },
        ],
      ),
    );

    const result = await backfillFinanceSettlement(deps);

    expect(result).toEqual({ ordersInspected: 1, feeEntriesPosted: 0, contraEntriesPosted: 1 });
    const posted = await journals.findBySourceRef("ORD-1");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.lines.some((line) => line.memo === "refund")).toBe(true);
  });

  it("is idempotent — running it twice posts nothing new the second time (T11.3's own test)", async () => {
    const { deps, journals } = freshDeps(
      fakeSource(
        [{ orderRef: "ORD-1", amountMinor: 5_000, currency: "EUR" }],
        [
          {
            refundId: "refund-1",
            orderRef: "ORD-1",
            amountMinor: 1_500,
            currency: "EUR",
            occurredAt: new Date("2026-09-01T00:00:00.000Z"),
          },
        ],
      ),
    );

    const first = await backfillFinanceSettlement(deps);
    expect(first).toEqual({ ordersInspected: 1, feeEntriesPosted: 1, contraEntriesPosted: 1 });
    const countAfterFirst = journals.all.length;

    const second = await backfillFinanceSettlement(deps);
    expect(second).toEqual({ ordersInspected: 1, feeEntriesPosted: 0, contraEntriesPosted: 0 });
    expect(journals.all.length).toBe(countAfterFirst); // same ledger state, not doubled
  });

  it("skips an order whose fee entry already exists (e.g. posted live by T11.1's registered consumer)", async () => {
    const { deps, journals } = freshDeps(
      fakeSource([{ orderRef: "ORD-1", amountMinor: 5_000, currency: "EUR" }], []),
    );
    // Pre-seed a fee entry as if the live consumer had already posted it.
    await backfillFinanceSettlement(deps);
    const preExisting = journals.all.length;

    const result = await backfillFinanceSettlement(deps);

    expect(result.feeEntriesPosted).toBe(0);
    expect(journals.all.length).toBe(preExisting);
  });

  it("posts only the MISSING refunds when an order already has some but not all of its contra entries", async () => {
    const refunds: IssuedRefundRecord[] = [
      {
        refundId: "refund-1",
        orderRef: "ORD-1",
        amountMinor: 1_000,
        currency: "EUR",
        occurredAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      {
        refundId: "refund-2",
        orderRef: "ORD-1",
        amountMinor: 2_000,
        currency: "EUR",
        occurredAt: new Date("2026-09-02T00:00:00.000Z"),
      },
    ];
    const { deps, journals } = freshDeps(fakeSource([], [refunds[0] as IssuedRefundRecord]));

    // First run: only refund-1 is known to the source (simulates the live consumer already
    // having posted refund-1's contra entry through the normal path before this backfill runs).
    await backfillFinanceSettlement(deps);
    expect(journals.all).toHaveLength(1);

    // Second run: the source now reports BOTH refunds (refund-2 newly discovered as missed).
    const depsWithBothRefunds = { ...deps, source: fakeSource([], refunds) };
    const result = await backfillFinanceSettlement(depsWithBothRefunds);

    expect(result.contraEntriesPosted).toBe(1); // only refund-2, not a second entry for refund-1
    const posted = await journals.findBySourceRef("ORD-1");
    expect(posted).toHaveLength(2);
    expect(posted.map((j) => j.lines[0]?.amount.amountMinor)).toEqual(
      expect.arrayContaining([1_000, 2_000]),
    );
  });

  it("touches only orders with a captured payment or a completed refund — no fabricated entries", async () => {
    const { deps, journals } = freshDeps(fakeSource([], []));

    const result = await backfillFinanceSettlement(deps);

    expect(result).toEqual({ ordersInspected: 0, feeEntriesPosted: 0, contraEntriesPosted: 0 });
    expect(journals.all).toHaveLength(0);
  });
});
