import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { Invoice } from "./domain/invoice";
import type { InvoiceRepository } from "./domain/repositories";
import { CollectInvoice, type BillingDeps } from "./application/billing.use-cases";
import type { FinanceLedgerPort, PaymentsPort } from "./application/ports";
import { InvoiceMapper, type InvoiceRow } from "./infrastructure/mappers";

/**
 * Phase A.16 (Task 1/2/3) — closes the A.15 §20 residual risk: `PaymentsPort.collect()` had no
 * idempotency key of any kind, the largest documented gap of the whole A.15 remediation. This suite
 * proves the `<invoiceId>:<version>:collect` deterministic key (see `billing.use-cases.ts` class doc
 * "IDEMPOTENCY") actually closes the required scenarios, using a `PostgresLikeInvoiceRepository` that
 * round-trips every read/write through `InvoiceMapper` — unlike Phase A.15's own
 * `collect-invoice-transaction-boundary.test.ts` fake (which stores the live `Invoice` object by
 * reference and therefore never reproduces a real optimistic-lock `version` increment across separate
 * reads), this fake reconstructs a FRESH `Invoice` instance via `Invoice.reconstitute` on every
 * `findById`, exactly like `PrismaInvoiceRepository` does — required to prove the version-keyed
 * idempotency mechanism for real, not just against a shared in-memory reference.
 */
class PostgresLikeInvoiceRepository implements InvoiceRepository {
  private readonly rows = new Map<string, InvoiceRow>();
  private readonly tenantId = "tenant-a";

  async save(invoice: Invoice): Promise<void> {
    const id = invoice.id.toString();
    const existing = this.rows.get(id);
    const row = InvoiceMapper.toRow(invoice, this.tenantId);
    if (existing === undefined) {
      this.rows.set(id, { ...row, version: 1 });
      return;
    }
    if (existing.version !== invoice.version) {
      throw new ConcurrencyError(`Invoice ${id} was modified concurrently`);
    }
    this.rows.set(id, { ...row, version: existing.version + 1 });
  }

  async findById(id: string): Promise<Invoice | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    return InvoiceMapper.toDomain(row);
  }

  size(): number {
    return this.rows.size;
  }
}

class PassthroughUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

/** Models a Stripe-style idempotent PSP: identical keys dedupe to the SAME recorded effect. */
class RecordingCollectProvider implements PaymentsPort {
  readonly calls: Array<{
    tenantRef: string;
    amount: number;
    currency: string;
    idempotencyKey?: string;
  }> = [];
  private readonly seenKeys = new Map<string, { reference: string }>();
  realEffects = 0;
  constructor(private readonly failAlways = false) {}

  async collect(
    tenantRef: string,
    amount: number,
    currency: string,
    idempotencyKey?: string,
  ): Promise<{ reference: string }> {
    this.calls.push({ tenantRef, amount, currency, idempotencyKey });
    if (this.failAlways) throw new Error("simulated PSP collect failure");
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (idempotencyKey !== undefined) {
      const cached = this.seenKeys.get(idempotencyKey);
      if (cached !== undefined) return cached;
    }
    this.realEffects += 1;
    const result = { reference: `psp-ref-${this.realEffects}` };
    if (idempotencyKey !== undefined) this.seenKeys.set(idempotencyKey, result);
    return result;
  }
}

class RecordingFinanceLedger implements FinanceLedgerPort {
  readonly calls: Array<{
    tenantRef: string;
    amount: number;
    currency: string;
    reference: string;
  }> = [];
  async postSettlement(
    tenantRef: string,
    amount: number,
    currency: string,
    reference: string,
  ): Promise<void> {
    this.calls.push({ tenantRef, amount, currency, reference });
  }
}

let idCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(idCounter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-08-13T00:00:00.000Z") };

function buildUseCase(
  invoices: InvoiceRepository,
  payments: PaymentsPort,
  financeLedger: FinanceLedgerPort = new RecordingFinanceLedger(),
): CollectInvoice {
  const deps: BillingDeps = {
    invoices,
    credits: { save: async () => {}, findById: async () => null },
    payments,
    financeLedger,
    unitOfWork: new PassthroughUnitOfWork(),
    idGenerator: sequentialIds("evt"),
    clock,
  };
  return new CollectInvoice(deps);
}

async function seedIssuedInvoice(
  invoices: PostgresLikeInvoiceRepository,
  id: string,
): Promise<void> {
  const invoice = Invoice.createDraft(
    { toString: () => id } as never,
    "tenant-a",
    "sub-1",
    "USD",
    [{ description: "seat", amountMinor: 5000 }],
    "evt-seed-1",
    clock.now(),
  );
  await invoices.save(invoice); // version 0 -> 1 (draft)
  const reloaded = await invoices.findById(id);
  if (reloaded === null) throw new Error("fixture missing");
  reloaded.issue("evt-seed-2", clock.now());
  await invoices.save(reloaded); // version 1 -> 2 (issued)
}

describe("Task 1 Scenario 1 — identical request repeated sequentially", () => {
  it("second call is a pure no-op; exactly one real PSP effect", async () => {
    const invoices = new PostgresLikeInvoiceRepository();
    await seedIssuedInvoice(invoices, "inv-seq");
    const provider = new RecordingCollectProvider();
    const useCase = buildUseCase(invoices, provider);

    const first = await useCase.execute({ invoiceId: "inv-seq", tenantId: "tenant-local" });
    const second = await useCase.execute({ invoiceId: "inv-seq", tenantId: "tenant-local" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(provider.realEffects).toBe(1);
    const final = await invoices.findById("inv-seq");
    expect(final?.status).toBe("paid");
  });
});

describe("Task 1 Scenario 2 — identical request concurrently", () => {
  it("both racers physically call the PSP with the SAME key; only one real PSP effect; one persisted paid row", async () => {
    for (let run = 0; run < 3; run += 1) {
      const invoices = new PostgresLikeInvoiceRepository();
      await seedIssuedInvoice(invoices, "inv-conc");
      const provider = new RecordingCollectProvider();
      const useCaseA = buildUseCase(invoices, provider);
      const useCaseB = buildUseCase(invoices, provider);

      const [a, b] = await Promise.all([
        useCaseA.execute({ invoiceId: "inv-conc", tenantId: "tenant-local" }),
        useCaseB.execute({ invoiceId: "inv-conc", tenantId: "tenant-local" }),
      ]);

      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      expect(provider.calls).toHaveLength(2); // both racers DID reach the PSP (documented, not prevented)
      expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBe(1); // ...with the identical key
      expect(provider.realEffects).toBe(1); // the PSP itself only ever moved money once
      const final = await invoices.findById("inv-conc");
      expect(final?.status).toBe("paid");
      expect(invoices.size()).toBe(1);
    }
  });
});

describe("Task 9 sweep finding — Finance is posted exactly once under concurrency, never double-posted", () => {
  it("two concurrent racers: only the one that performed the real markPaid write posts to Finance", async () => {
    for (let run = 0; run < 3; run += 1) {
      const invoices = new PostgresLikeInvoiceRepository();
      await seedIssuedInvoice(invoices, "inv-finance-race");
      const provider = new RecordingCollectProvider();
      const finance = new RecordingFinanceLedger();
      const useCaseA = buildUseCase(invoices, provider, finance);
      const useCaseB = buildUseCase(invoices, provider, finance);

      const [a, b] = await Promise.all([
        useCaseA.execute({ invoiceId: "inv-finance-race", tenantId: "tenant-local" }),
        useCaseB.execute({ invoiceId: "inv-finance-race", tenantId: "tenant-local" }),
      ]);

      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      // Both racers physically call the PSP (documented, not prevented) and both reach settleSuccess...
      expect(provider.calls).toHaveLength(2);
      // ...but Finance is posted EXACTLY ONCE — the no-op racer's settleSuccess reports
      // `alreadyPaid: true` and execute() skips its postSettlement call.
      expect(finance.calls).toHaveLength(1);
      const final = await invoices.findById("inv-finance-race");
      expect(final?.status).toBe("paid");
    }
  });
});

describe("Task 1 Scenario 3 — first attempt succeeds", () => {
  it("clean happy path: one PSP call, invoice paid, Finance posted", async () => {
    const invoices = new PostgresLikeInvoiceRepository();
    await seedIssuedInvoice(invoices, "inv-happy");
    const provider = new RecordingCollectProvider();
    const finance = new RecordingFinanceLedger();
    const useCase = buildUseCase(invoices, provider, finance);

    const result = await useCase.execute({ invoiceId: "inv-happy", tenantId: "tenant-local" });

    expect(result.ok).toBe(true);
    expect(provider.realEffects).toBe(1);
    expect(finance.calls).toHaveLength(1);
    const final = await invoices.findById("inv-happy");
    expect(final?.status).toBe("paid");
    expect(final?.paymentReference).toBeDefined();
  });
});

describe("Task 1 Scenario 4 / Task 3 — crash after PSP success, before settle() commits", () => {
  it("retry after the crash presents the SAME key; the PSP is not charged twice; the invoice converges to paid", async () => {
    const invoices = new PostgresLikeInvoiceRepository();
    await seedIssuedInvoice(invoices, "inv-crash");
    const provider = new RecordingCollectProvider();

    let saveAttempts = 0;
    const crashingInvoices: InvoiceRepository = {
      findById: (id) => invoices.findById(id),
      save: async (invoice) => {
        saveAttempts += 1;
        if (saveAttempts === 1) throw new Error("simulated process crash during settle commit");
        return invoices.save(invoice);
      },
    };
    const crashingUseCase = buildUseCase(crashingInvoices, provider);

    // First attempt: the PSP call succeeds for real, then the process "crashes" exactly as
    // settleSuccess() tries to commit — the durable write never happens.
    await expect(
      crashingUseCase.execute({ invoiceId: "inv-crash", tenantId: "tenant-local" }),
    ).rejects.toThrow(/simulated process crash/);

    const afterCrash = await invoices.findById("inv-crash");
    expect(afterCrash?.status).toBe("issued"); // unchanged — the crash pre-empted the commit
    expect(provider.realEffects).toBe(1); // the PSP already moved money once, invisibly to local state

    // Retry: a fresh process (fresh use-case instance, working repository) re-attempts the SAME invoice.
    const retryUseCase = buildUseCase(invoices, provider);
    const retried = await retryUseCase.execute({
      invoiceId: "inv-crash",
      tenantId: "tenant-local",
    });

    expect(retried.ok).toBe(true);
    expect(provider.calls.length).toBeGreaterThanOrEqual(2); // the PSP WAS called again on retry...
    expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBe(1); // ...with the IDENTICAL key...
    expect(provider.realEffects).toBe(1); // ...so it only ever actually moved money once

    const final = await invoices.findById("inv-crash");
    expect(final?.status).toBe("paid");
  });
});

describe("Task 1 Scenario 5 — retry after a genuine PSP failure (not a crash)", () => {
  it("a legitimate re-issue + retry after a real decline computes a FRESH key, not blocked by the failed attempt's key", async () => {
    const invoices = new PostgresLikeInvoiceRepository();
    await seedIssuedInvoice(invoices, "inv-retry");
    const failingProvider = new RecordingCollectProvider(true);
    const failingUseCase = buildUseCase(invoices, failingProvider);

    await expect(
      failingUseCase.execute({ invoiceId: "inv-retry", tenantId: "tenant-local" }),
    ).rejects.toThrow(/simulated PSP collect failure/);
    const afterFailure = await invoices.findById("inv-retry");
    expect(afterFailure?.status).toBe("failed");
    const failedKey = failingProvider.calls[0]?.idempotencyKey;
    expect(failedKey).toBeDefined();

    // Business re-issues the failed invoice — a legal `failed -> issued` transition (e.g. the
    // customer updated their card) — this is a genuinely NEW collection attempt, not a resume.
    const reissued = await invoices.findById("inv-retry");
    if (reissued === null) throw new Error("fixture missing");
    reissued.issue("evt-reissue", clock.now());
    await invoices.save(reissued);

    const workingProvider = new RecordingCollectProvider();
    const retryUseCase = buildUseCase(invoices, workingProvider);
    const retried = await retryUseCase.execute({
      invoiceId: "inv-retry",
      tenantId: "tenant-local",
    });

    expect(retried.ok).toBe(true);
    const newKey = workingProvider.calls[0]?.idempotencyKey;
    expect(newKey).not.toBe(failedKey); // NOT wedged behind the stale failed-attempt key
    expect(workingProvider.realEffects).toBe(1);
    const final = await invoices.findById("inv-retry");
    expect(final?.status).toBe("paid");
  });
});

describe("Task 1 Scenario 6 — conflicting collection request", () => {
  it("collect() against a voided invoice is rejected; the PSP is never called", async () => {
    const invoices = new PostgresLikeInvoiceRepository();
    const invoice = Invoice.createDraft(
      { toString: () => "inv-conflict" } as never,
      "tenant-a",
      "sub-1",
      "USD",
      [{ description: "seat", amountMinor: 5000 }],
      "evt-1",
      clock.now(),
    );
    await invoices.save(invoice);
    const reloaded = await invoices.findById("inv-conflict");
    if (reloaded === null) throw new Error("fixture missing");
    reloaded.voidInvoice("evt-2", clock.now());
    await invoices.save(reloaded);

    const provider = new RecordingCollectProvider();
    const useCase = buildUseCase(invoices, provider);
    const result = await useCase.execute({ invoiceId: "inv-conflict", tenantId: "tenant-local" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BUSINESS_RULE");
    expect(provider.calls).toHaveLength(0);
  });
});
