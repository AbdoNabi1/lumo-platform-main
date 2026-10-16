import { describe, expect, it } from "vitest";
import { staticProviders } from "./test-support/static-provider-resolver";
import type {
  Clock,
  IdGenerator,
  PaymentProvider,
  PaymentIntentRequest,
  ProviderIntent,
} from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import type { PaymentIntent } from "./domain/payment-intent";
import type { PaymentIntentRepository } from "./domain/payment-intent-repository";
import {
  CreatePaymentIntentLifecycle,
  type PaymentLifecycleDeps,
} from "./application/payment-lifecycle.use-cases";
import { PaymentIntentMapper, type PaymentIntentRow } from "./infrastructure/payment-intent.mapper";

/**
 * Phase A.13 (Task 5) — same fake shapes as `capture-concurrency.test.ts` (Phase A.8): a
 * Postgres-like repository that reproduces `PrismaPaymentIntentRepository`'s optimistic-lock
 * (`version`) contract, and a `TrackingUnitOfWork` that counts currently-open `run()` calls so a
 * `PaymentProvider` can prove whether it was invoked while a transaction was open.
 */
class PostgresLikePaymentIntentRepository implements PaymentIntentRepository {
  private readonly rows = new Map<
    string,
    {
      intentRow: PaymentIntentRow;
      chargeRows: ReturnType<typeof PaymentIntentMapper.toChargeRows>;
      refundRows: ReturnType<typeof PaymentIntentMapper.toRefundRows>;
      attemptRows: ReturnType<typeof PaymentIntentMapper.toAttemptRows>;
    }
  >();
  private readonly tenantId = "tenant-local";

  async save(intent: PaymentIntent, _tenantId: string): Promise<void> {
    const id = intent.id.toString();
    const existing = this.rows.get(id);
    if (existing === undefined) {
      this.write(intent, 1);
      return;
    }
    if (existing.intentRow.version !== intent.version) {
      throw new ConcurrencyError(
        `PaymentIntent ${id} was modified concurrently (expected version ${intent.version})`,
      );
    }
    this.write(intent, existing.intentRow.version + 1);
  }

  async findById(id: string, _tenantId: string): Promise<PaymentIntent | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    return PaymentIntentMapper.toDomain(
      row.intentRow,
      row.chargeRows,
      row.refundRows,
      row.attemptRows,
    );
  }

  async findByIdempotencyKey(_key: string, _tenantId: string): Promise<PaymentIntent | null> {
    return null;
  }

  async findByPspReference(): Promise<PaymentIntent | null> {
    return null;
  }

  size(): number {
    return this.rows.size;
  }

  async findByOrderRef(orderRef: string): Promise<PaymentIntent | null> {
    for (const row of this.rows.values()) {
      if (row.intentRow.orderRef === orderRef) {
        return PaymentIntentMapper.toDomain(
          row.intentRow,
          row.chargeRows,
          row.refundRows,
          row.attemptRows,
        );
      }
    }
    return null;
  }

  private write(intent: PaymentIntent, version: number): void {
    const intentRow = {
      ...PaymentIntentMapper.toIntentRow(intent, this.tenantId),
      version,
    } as PaymentIntentRow;
    this.rows.set(intent.id.toString(), {
      intentRow,
      chargeRows: PaymentIntentMapper.toChargeRows(intent, this.tenantId),
      refundRows: PaymentIntentMapper.toRefundRows(intent, this.tenantId),
      attemptRows: PaymentIntentMapper.toAttemptRows(intent, this.tenantId),
    });
  }
}

/** Tracks how many `run()` calls are currently open — a stand-in for "a live DB transaction is held". */
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

class RecordingCreateProvider implements PaymentProvider {
  readonly calls: Array<{ idempotencyKey: string; openCountAtCall: number }> = [];

  constructor(
    private readonly uow?: TrackingUnitOfWork,
    private readonly failAlways = false,
  ) {}

  async createIntent(request: PaymentIntentRequest): Promise<ProviderIntent> {
    this.calls.push({
      idempotencyKey: request.idempotencyKey,
      openCountAtCall: this.uow?.openCount ?? -1,
    });
    if (this.failAlways) {
      throw new Error("simulated PSP createIntent failure");
    }
    return { providerIntentId: `provider-${request.idempotencyKey}`, clientHandle: "secret_abc" };
  }
  async capture(): Promise<void> {
    throw new Error("not used by this test");
  }
  async cancel(): Promise<void> {}
  async refund(): Promise<void> {
    throw new Error("not used by this test");
  }
  async verifyWebhook(): Promise<boolean> {
    return true;
  }
}

let globalIdCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(globalIdCounter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-12T00:00:00.000Z") };

function buildDeps(
  repo: PaymentIntentRepository,
  paymentProvider: PaymentProvider,
  unitOfWork: TransactionalUnitOfWork<unknown>,
): PaymentLifecycleDeps {
  return {
    intents: repo,
    unitOfWork,
    idGenerator: sequentialIds("evt"),
    clock,
    providers: staticProviders(paymentProvider),
  };
}

describe("Task 4/5 — exploit proof: PSP createIntent() call happens while a DB transaction is open", () => {
  it("EXPLOIT (pre-fix shape): would show PaymentProvider.createIntent() invoked with a transaction still open", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingCreateProvider(uow);
    const lifecycle = new CreatePaymentIntentLifecycle(buildDeps(repo, provider, uow));

    const result = await lifecycle.execute({
      tenantId: "tenant-a",
      orderRef: "order-1",
      provider: "stripe",
      amountMinor: 1000,
      currency: "USD",
    });

    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    // Fixed behavior: the reservation's transaction is committed BEFORE the PSP call — no
    // transaction should be open while the PSP network call is in flight.
    expect(provider.calls[0]?.openCountAtCall).toBe(0);
  });

  it("the domain intent is durably reserved (persisted) before the PSP call resolves", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    const uow = new TrackingUnitOfWork();
    let sizeDuringPspCall = -1;
    const provider: PaymentProvider = {
      async createIntent() {
        sizeDuringPspCall = repo.size();
        return { providerIntentId: "provider-x" };
      },
      async capture() {},
      async cancel() {},
      async refund() {},
      async verifyWebhook() {
        return true;
      },
    };
    const lifecycle = new CreatePaymentIntentLifecycle(buildDeps(repo, provider, uow));

    await lifecycle.execute({
      tenantId: "tenant-a",
      orderRef: "order-2",
      provider: "stripe",
      amountMinor: 500,
      currency: "USD",
    });

    expect(sizeDuringPspCall).toBe(1);
  });
});

describe("Task 5 — PSP failure recovery on create", () => {
  it("a PSP createIntent failure leaves the reservation cancelled, not stuck ambiguously at 'created', and rethrows the original error", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    const uow = new TrackingUnitOfWork();
    const failingProvider = new RecordingCreateProvider(uow, true);
    const lifecycle = new CreatePaymentIntentLifecycle(buildDeps(repo, failingProvider, uow));

    await expect(
      lifecycle.execute({
        tenantId: "tenant-a",
        orderRef: "order-fail",
        provider: "stripe",
        amountMinor: 1000,
        currency: "USD",
      }),
    ).rejects.toThrow(/simulated PSP createIntent failure/);

    expect(repo.size()).toBe(1);
    const persisted = await repo.findByOrderRef("order-fail");
    expect(persisted?.status.value).toBe("cancelled");
  });

  it("a subsequent create call after a PSP failure succeeds independently (fresh id, no idempotency coupling)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    const uow = new TrackingUnitOfWork();
    const failingProvider = new RecordingCreateProvider(uow, true);
    const failingLifecycle = new CreatePaymentIntentLifecycle(
      buildDeps(repo, failingProvider, uow),
    );
    await expect(
      failingLifecycle.execute({
        tenantId: "tenant-a",
        orderRef: "order-retry",
        provider: "stripe",
        amountMinor: 1000,
        currency: "USD",
      }),
    ).rejects.toThrow();

    const workingProvider = new RecordingCreateProvider(uow, false);
    const retryLifecycle = new CreatePaymentIntentLifecycle(buildDeps(repo, workingProvider, uow));
    const retried = await retryLifecycle.execute({
      tenantId: "tenant-a",
      orderRef: "order-retry",
      provider: "stripe",
      amountMinor: 1000,
      currency: "USD",
    });

    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.status).toBe("created");
    // Two independent rows: the cancelled reservation from the failed attempt, plus the new one.
    expect(repo.size()).toBe(2);
  });
});

describe("Task 4 — concurrent create requests never race on shared state", () => {
  it("two concurrent creates each mint independent ids and both durably persist without a ConcurrencyError", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingCreateProvider(uow);
    const lifecycle = new CreatePaymentIntentLifecycle(buildDeps(repo, provider, uow));

    const [a, b] = await Promise.all([
      lifecycle.execute({
        tenantId: "tenant-a",
        orderRef: "order-a",
        provider: "stripe",
        amountMinor: 100,
        currency: "USD",
      }),
      lifecycle.execute({
        tenantId: "tenant-a",
        orderRef: "order-b",
        provider: "stripe",
        amountMinor: 200,
        currency: "USD",
      }),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.paymentIntentId).not.toBe(b.value.paymentIntentId);
    }
    expect(repo.size()).toBe(2);
  });
});
