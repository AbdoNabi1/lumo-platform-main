import type { TransactionClient } from "@platform/db";
import type { IntegrationEvent } from "@platform/domain-events";
import type { Journal } from "@platform/finance";
import type { SupervisedConsumer } from "@platform/kafka";
import { describe, expect, it, vi } from "vitest";
import { buildRuntimeCore, type RuntimeCore } from "../composition";
import { loadRuntimeConfig } from "../config";
import { startWorker } from "../worker";
import {
  buildFinanceSettlementConsumerRuntimes,
  FinancePaymentsCapturedConsumer,
  FinanceRefundsIssuedConsumer,
  type PaymentSettlementPayload,
} from "./finance-settlement.consumers";

// The worker's health surface binds a real TCP port; nothing here exercises it.
vi.mock("../health-server", () => ({ startHealthServer: () => ({ close: vi.fn() }) }));

const WORKER_ENV = {
  DATABASE_URL: "postgresql://lumo:lumo@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  APP_ENV: "local",
} as NodeJS.ProcessEnv;

/** Same reach-in helper `orders-paid.consumers.test.ts` uses — `KafkaConsumerRuntime` exposes no public accessor for `unitOfWork`/`handleAtomic`. */
function runtimeDeps(runtime: SupervisedConsumer): {
  readonly unitOfWork?: unknown;
  readonly handler: { readonly handleAtomic?: unknown };
} {
  return (
    runtime as unknown as {
      deps: { unitOfWork?: unknown; handler: { handleAtomic?: unknown } };
    }
  ).deps;
}

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

function settlementEvent(
  type: string,
  overrides: Partial<PaymentSettlementPayload> = {},
): IntegrationEvent<PaymentSettlementPayload> {
  return {
    messageId: "01J0SETL0000000000000000",
    type,
    eventVersion: 1,
    aggregateId: "pi-7",
    aggregateType: "payment_intent",
    occurredAt: "2026-08-24T10:00:00.000Z",
    correlationId: "corr-1",
    causationId: "cause-1",
    metadata: {},
    payload: { orderRef: "ORD-1001", amountMinor: 5_000, currency: "EUR", ...overrides },
  };
}

const TEST_TENANT_ID = "tenant-settlement-test";

function journalDeps(append: (journal: Journal, tenantId?: string, tx?: unknown) => Promise<void>) {
  return {
    journals: { append, findById: vi.fn(), findBySourceRef: vi.fn() },
    postingAccounts: POSTING_ACCOUNTS,
    idGenerator: { generate: () => "journal-1" },
    clock: { now: () => new Date("2026-08-24T10:00:01.000Z") },
  };
}

describe("FinancePaymentsCapturedConsumer (WP-11, F-11)", () => {
  it("posts a balanced fee entry (debit fees, credit cash — LedgerPoster.forFee's own shape) on the tx it was handed", async () => {
    const append = vi.fn(
      async (_journal: Journal, _tenantId?: string, _tx?: unknown): Promise<void> => undefined,
    );
    const consumer = new FinancePaymentsCapturedConsumer(journalDeps(append), TEST_TENANT_ID);

    await consumer.handleAtomic(
      settlementEvent("payments.payment_intent.captured"),
      "runtime-tx" as unknown as TransactionClient,
    );

    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[1]).toBe(TEST_TENANT_ID);
    expect(append.mock.calls[0]?.[2]).toBe("runtime-tx");
    const journal = append.mock.calls[0]?.[0];
    expect(journal?.sourceRef).toBe("ORD-1001");
    expect(journal?.lines.map((line) => line.accountRef)).toEqual([
      POSTING_ACCOUNTS.fees,
      POSTING_ACCOUNTS.cash,
    ]);
    expect(journal?.lines.map((line) => line.amount.amountMinor)).toEqual([5_000, 5_000]);
  });

  it("REFUSES the non-atomic path rather than risk double-posting the fee entry", async () => {
    const append = vi.fn(async (_journal: Journal, _tx?: unknown): Promise<void> => undefined);

    await expect(
      new FinancePaymentsCapturedConsumer(journalDeps(append), TEST_TENANT_ID).handle(),
    ).rejects.toThrow(/requires the atomic path/);
    expect(append).not.toHaveBeenCalled();
  });

  it("replaying the same captured event twice posts the fee entry twice at this layer — dedup is the inbox's job, not this consumer's", async () => {
    // `PaymentsCapturedConsumer.handle` mints a fresh journal id every call (no idempotency key on
    // its own); exactly-once posting under redelivery is the reliability envelope's job
    // (`buildProcessedConsumer`'s Postgres inbox marker, committed atomically via `handleAtomic`),
    // proven by `buildFinanceSettlementConsumerRuntimes` wiring a `unitOfWork` below — NOT by this
    // consumer refusing a second call. This test pins that division of responsibility explicitly,
    // so a future change does not mistake "posts twice when called twice" for a regression here.
    const append = vi.fn(async (_journal: Journal, _tx?: unknown): Promise<void> => undefined);
    const consumer = new FinancePaymentsCapturedConsumer(journalDeps(append), TEST_TENANT_ID);
    const tx = "runtime-tx" as unknown as TransactionClient;

    await consumer.handleAtomic(settlementEvent("payments.payment_intent.captured"), tx);
    await consumer.handleAtomic(settlementEvent("payments.payment_intent.captured"), tx);

    expect(append).toHaveBeenCalledTimes(2);
  });
});

describe("FinanceRefundsIssuedConsumer (WP-11, F-11)", () => {
  it("posts a balanced contra entry (debit refund contra, credit receivable)", async () => {
    const append = vi.fn(async (_journal: Journal, _tx?: unknown): Promise<void> => undefined);
    const consumer = new FinanceRefundsIssuedConsumer(journalDeps(append), TEST_TENANT_ID);

    await consumer.handleAtomic(
      settlementEvent("payments.payment_intent.refunded", { amountMinor: 2_000 }),
      "runtime-tx" as unknown as TransactionClient,
    );

    expect(append).toHaveBeenCalledTimes(1);
    const journal = append.mock.calls[0]?.[0];
    expect(journal?.sourceRef).toBe("ORD-1001");
    expect(journal?.lines.map((line) => line.accountRef)).toEqual(
      expect.arrayContaining([POSTING_ACCOUNTS.refundContra, POSTING_ACCOUNTS.receivable]),
    );
    expect(journal?.lines.map((line) => line.amount.amountMinor)).toEqual([2_000, 2_000]);
  });

  it("REFUSES the non-atomic path rather than risk double-posting the contra entry", async () => {
    const append = vi.fn(async (_journal: Journal, _tx?: unknown): Promise<void> => undefined);

    await expect(
      new FinanceRefundsIssuedConsumer(journalDeps(append), TEST_TENANT_ID).handle(),
    ).rejects.toThrow(/requires the atomic path/);
    expect(append).not.toHaveBeenCalled();
  });
});

describe("settlement invariant: refund after capture -> one contra entry (WP-11, T11.6)", () => {
  it("capturing then refunding the same order posts exactly one fee entry and exactly one contra entry", async () => {
    const posted: Journal[] = [];
    const append = vi.fn(async (journal: Journal, _tx?: unknown): Promise<void> => {
      posted.push(journal);
    });
    const tx = "runtime-tx" as unknown as TransactionClient;

    const capturedConsumer = new FinancePaymentsCapturedConsumer(
      journalDeps(append),
      TEST_TENANT_ID,
    );
    await capturedConsumer.handleAtomic(settlementEvent("payments.payment_intent.captured"), tx);

    const refundedConsumer = new FinanceRefundsIssuedConsumer(journalDeps(append), TEST_TENANT_ID);
    await refundedConsumer.handleAtomic(
      settlementEvent("payments.payment_intent.refunded", { amountMinor: 2_000 }),
      tx,
    );

    expect(posted).toHaveLength(2);
    const feeEntries = posted.filter((journal) =>
      journal.lines.some((line) => line.memo === "fee"),
    );
    const contraEntries = posted.filter((journal) =>
      journal.lines.some((line) => line.memo === "refund"),
    );
    expect(feeEntries).toHaveLength(1);
    expect(contraEntries).toHaveLength(1);
    expect(feeEntries[0]?.sourceRef).toBe("ORD-1001");
    expect(contraEntries[0]?.sourceRef).toBe("ORD-1001");
  });
});

describe("buildFinanceSettlementConsumerRuntimes (WP-11, F-11)", () => {
  it("composes exactly two consumers, each on its own event type and consumer group, both atomic", () => {
    const core = buildRuntimeCore(loadRuntimeConfig(WORKER_ENV));
    const runtimes = buildFinanceSettlementConsumerRuntimes(core, core.metrics);

    expect(runtimes).toHaveLength(2);
    expect(runtimes.map((runtime) => runtime.consumerGroup)).toEqual([
      "finance.payments-captured",
      "finance.refunds-issued",
    ]);
    expect(runtimes.map((runtime) => runtime.topic)).toEqual([
      "payments.payment_intent.captured.v1",
      "payments.payment_intent.refunded.v1",
    ]);
    // Both must be atomic (WP-11's whole point): a ledger append is not idempotent by itself,
    // unlike orders-paid's three self-idempotent siblings.
    expect(
      runtimes.every((runtime) => {
        const deps = runtimeDeps(runtime);
        return deps.unitOfWork !== undefined && typeof deps.handler.handleAtomic === "function";
      }),
    ).toBe(true);
    expect(runtimes.every((runtime) => !runtime.isRunning)).toBe(true); // built, not started
  });
});

/**
 * Same discipline `orders-paid.consumers.test.ts`'s "Finding I3" comment documents: calls the REAL
 * `startWorker`, so deleting the registration lines from `worker.ts` fails this test, not just a
 * hand-rolled supervisor here.
 */
describe("startWorker — finance settlement registration (WP-11, F-11)", () => {
  function fakeKafkaCore(): RuntimeCore {
    const consumer = {
      connect: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => undefined),
      run: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    };
    const producer = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      send: vi.fn(async () => undefined),
      on: vi.fn(),
      events: { DISCONNECT: "producer.disconnect" },
    };
    const core = buildRuntimeCore(loadRuntimeConfig(WORKER_ENV));
    return {
      ...core,
      kafka: {
        consumer: () => consumer,
        producer: () => producer,
        admin: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      },
    } as unknown as RuntimeCore;
  }

  it("registers both finance-settlement consumer groups alongside every pre-existing one", async () => {
    const config = loadRuntimeConfig(WORKER_ENV);

    const supervisor = await startWorker(config, fakeKafkaCore());

    const groups = supervisor.status().map((status) => status.consumerGroup);
    expect(groups).toContain("finance.payments-captured");
    expect(groups).toContain("finance.refunds-issued");
    // Registered alongside — not instead of — the pre-existing orders.order.paid fleet.
    expect(groups).toContain("finance.orders-paid");
    expect(groups).toContain("orders.payment-captured");
    await supervisor.stopAll();
  });
});
