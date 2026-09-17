import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { Invoice } from "./domain/invoice";
import type { InvoiceRepository } from "./domain/repositories";
import { CollectInvoice, type BillingDeps } from "./application/billing.use-cases";
import type { FinanceLedgerPort, PaymentsPort } from "./application/ports";

/**
 * Phase A.15 (Task 3) — same exploit-proof shape as Payments' Phase A.13
 * `create-intent-transaction-boundary.test.ts`: a `TrackingUnitOfWork` counts currently-open `run()`
 * calls so `PaymentsPort.collect()`/`FinanceLedgerPort.postSettlement()` can prove whether they were
 * invoked while a transaction was open (A.14 §11 finding #1).
 */
class TrackingUnitOfWork implements TransactionalUnitOfWork<unknown> {
  openCount = 0;
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    this.openCount += 1;
    try {
      return await work(undefined);
    } finally {
      this.openCount -= 1;
    }
  }
}

/** Postgres-like: reproduces `PrismaInvoiceRepository`'s optimistic-lock (`version`) contract. */
class PostgresLikeInvoiceRepository implements InvoiceRepository {
  private readonly rows = new Map<string, Invoice>();

  async save(invoice: Invoice): Promise<void> {
    const id = invoice.id.toString();
    const existing = this.rows.get(id);
    if (existing !== undefined && existing.version !== invoice.version) {
      throw new ConcurrencyError(`Invoice ${id} was modified concurrently`);
    }
    this.rows.set(id, invoice);
  }

  async findById(id: string): Promise<Invoice | null> {
    return this.rows.get(id) ?? null;
  }

  size(): number {
    return this.rows.size;
  }
}

let idCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(idCounter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-08-12T00:00:00.000Z") };

function buildDeps(
  invoices: InvoiceRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  payments: PaymentsPort,
  financeLedger: FinanceLedgerPort,
): BillingDeps {
  return {
    invoices,
    credits: {
      save: async () => {},
      findById: async () => null,
    },
    payments,
    financeLedger,
    unitOfWork,
    idGenerator: sequentialIds("evt"),
    clock,
  };
}

async function seedIssuedInvoice(invoices: InvoiceRepository, id: string): Promise<void> {
  const invoice = Invoice.createDraft(
    { toString: () => id } as never,
    "tenant-a",
    "sub-1",
    "USD",
    [{ description: "seat", amount: 5000 }],
    "evt-seed-1",
    clock.now(),
  );
  invoice.issue("evt-seed-2", clock.now());
  await invoices.save(invoice, "tenant-local");
}

describe("Task 3 — exploit proof: PSP collect()/Finance postSettlement() run while a DB transaction is open", () => {
  it("EXPLOIT (pre-fix shape): would show collect() invoked with a transaction still open", async () => {
    const invoices = new PostgresLikeInvoiceRepository();
    await seedIssuedInvoice(invoices, "inv-1");
    const uow = new TrackingUnitOfWork();
    const openCountAtCollect: number[] = [];
    const openCountAtPostSettlement: number[] = [];
    const payments: PaymentsPort = {
      collect: async () => {
        openCountAtCollect.push(uow.openCount);
        return { reference: "psp-ref-1" };
      },
    };
    const financeLedger: FinanceLedgerPort = {
      postSettlement: async () => {
        openCountAtPostSettlement.push(uow.openCount);
      },
    };
    const useCase = new CollectInvoice(buildDeps(invoices, uow, payments, financeLedger));

    const result = await useCase.execute({ invoiceId: "inv-1", tenantId: "tenant-local" });

    expect(result.ok).toBe(true);
    // Fixed behavior: neither external call happens while a transaction is open.
    expect(openCountAtCollect).toEqual([0]);
    expect(openCountAtPostSettlement).toEqual([0]);
  });

  it("the precheck's read is durably committed before the PSP call resolves", async () => {
    const invoices = new PostgresLikeInvoiceRepository();
    await seedIssuedInvoice(invoices, "inv-2");
    const uow = new TrackingUnitOfWork();
    let sizeDuringPspCall = -1;
    const payments: PaymentsPort = {
      collect: async () => {
        sizeDuringPspCall = invoices.size();
        return { reference: "psp-ref-2" };
      },
    };
    const financeLedger: FinanceLedgerPort = { postSettlement: async () => {} };
    const useCase = new CollectInvoice(buildDeps(invoices, uow, payments, financeLedger));

    await useCase.execute({ invoiceId: "inv-2", tenantId: "tenant-local" });

    expect(sizeDuringPspCall).toBe(1);
  });
});

describe("Task 3 — PSP failure recovery on collect", () => {
  it("a PSP collect() failure marks the invoice failed and rethrows the original error", async () => {
    const invoices = new PostgresLikeInvoiceRepository();
    await seedIssuedInvoice(invoices, "inv-3");
    const uow = new TrackingUnitOfWork();
    const payments: PaymentsPort = {
      collect: async () => {
        throw new Error("simulated PSP collect failure");
      },
    };
    const financeLedger: FinanceLedgerPort = { postSettlement: async () => {} };
    const useCase = new CollectInvoice(buildDeps(invoices, uow, payments, financeLedger));

    await expect(useCase.execute({ invoiceId: "inv-3", tenantId: "tenant-local" })).rejects.toThrow(
      /simulated PSP collect failure/,
    );

    const persisted = await invoices.findById("inv-3");
    expect(persisted?.status).toBe("failed");
  });

  it("a Finance postSettlement() failure does not roll back or misrepresent an already-collected invoice (latent bug fixed by this phase)", async () => {
    const invoices = new PostgresLikeInvoiceRepository();
    await seedIssuedInvoice(invoices, "inv-4");
    const uow = new TrackingUnitOfWork();
    const payments: PaymentsPort = { collect: async () => ({ reference: "psp-ref-4" }) };
    const financeLedger: FinanceLedgerPort = {
      postSettlement: async () => {
        throw new Error("simulated Finance ledger outage");
      },
    };
    const useCase = new CollectInvoice(buildDeps(invoices, uow, payments, financeLedger));

    const result = await useCase.execute({ invoiceId: "inv-4", tenantId: "tenant-local" });

    // Pre-fix, this call chain threw an unrelated BusinessRuleError ("paid" has no outgoing
    // transitions) and the markPaid write was rolled back with the whole transaction. Post-fix, the
    // collection is already durably committed before postSettlement runs, so it stays `paid`.
    expect(result.ok).toBe(true);
    const persisted = await invoices.findById("inv-4");
    expect(persisted?.status).toBe("paid");
    expect(persisted?.paymentReference).toBe("psp-ref-4");
  });
});

describe("Task 3/11 — idempotency and concurrency", () => {
  it("a retried execute() call against an already-paid invoice is a pure no-op (no second PSP charge)", async () => {
    const invoices = new PostgresLikeInvoiceRepository();
    await seedIssuedInvoice(invoices, "inv-5");
    const uow = new TrackingUnitOfWork();
    let collectCalls = 0;
    const payments: PaymentsPort = {
      collect: async () => {
        collectCalls += 1;
        return { reference: "psp-ref-5" };
      },
    };
    const financeLedger: FinanceLedgerPort = { postSettlement: async () => {} };
    const useCase = new CollectInvoice(buildDeps(invoices, uow, payments, financeLedger));

    const first = await useCase.execute({ invoiceId: "inv-5", tenantId: "tenant-local" });
    const second = await useCase.execute({ invoiceId: "inv-5", tenantId: "tenant-local" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(collectCalls).toBe(1);
  });

  it("both settle() writes converge on one persisted 'paid' row without a lost update or an uncaught ConcurrencyError, even though both racers called the PSP (documented residual risk — see class doc)", async () => {
    // CHARACTERIZATION, not a safety proof: `PaymentsPort.collect()` carries no idempotency key
    // (unlike every other Phase A.15 site), and `precheck()` is a plain read with no reservation
    // write, so both concurrent callers legitimately reach `payments.collect()` here — this is the
    // documented, pre-existing (not phase-introduced) residual risk. What this test DOES prove: the
    // two racing `settle()` writes still converge deterministically (optimistic-lock retry) instead
    // of corrupting the row or leaking an uncaught ConcurrencyError to the caller.
    for (let run = 0; run < 3; run += 1) {
      const invoices = new PostgresLikeInvoiceRepository();
      await seedIssuedInvoice(invoices, "inv-concurrent");
      const uow = new TrackingUnitOfWork();
      let collectCalls = 0;
      const payments: PaymentsPort = {
        collect: async () => {
          collectCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { reference: "psp-ref-concurrent" };
        },
      };
      const financeLedger: FinanceLedgerPort = { postSettlement: async () => {} };
      const useCaseA = new CollectInvoice(buildDeps(invoices, uow, payments, financeLedger));
      const useCaseB = new CollectInvoice(buildDeps(invoices, uow, payments, financeLedger));

      const [a, b] = await Promise.all([
        useCaseA.execute({ invoiceId: "inv-concurrent", tenantId: "tenant-local" }),
        useCaseB.execute({ invoiceId: "inv-concurrent", tenantId: "tenant-local" }),
      ]);

      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      expect(collectCalls).toBe(2);
      const persisted = await invoices.findById("inv-concurrent");
      expect(persisted?.status).toBe("paid");
      expect(invoices.size()).toBe(1); // one row, not a duplicate/corrupted write
    }
  });
});
