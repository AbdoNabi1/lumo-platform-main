import type { TransactionClient } from "@platform/db";
import type { IntegrationEvent } from "@platform/domain-events";
import type { Journal } from "@platform/finance";
import type { CreateNotification } from "@platform/notifications";
import type { EarnPoints, LoyaltyAccountRepository } from "@platform/loyalty";
import type { UpdateProfileProjection } from "@platform/customer-360";
import type { SupervisedConsumer } from "@platform/kafka";
import { err, ok } from "@platform/types";
import { ValidationError } from "@platform/utils";
import { describe, expect, it, vi } from "vitest";
import { buildRuntimeCore, type RuntimeCore } from "../composition";
import { loadRuntimeConfig } from "../config";
import { startWorker } from "../worker";
import {
  buildOrdersPaidConsumerRuntimes,
  Customer360OrdersPaidConsumer,
  FinanceOrdersPaidConsumer,
  LoyaltyOrdersPaidConsumer,
  NotificationsOrdersPaidConsumer,
  ORDERS_ORDER_PAID,
  pointsForPaidOrder,
  type OrderPaidPayload,
} from "./orders-paid.consumers";

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

/**
 * `KafkaConsumerRuntime` keeps its deps private and exposes no accessor for `unitOfWork`, so the
 * atomic-path wiring (finding C1) is only observable by reaching in. Deliberate: the alternative is
 * widening the production class's API purely for a test.
 */
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

function orderPaidEvent(
  overrides: Partial<OrderPaidPayload> = {},
): IntegrationEvent<OrderPaidPayload> {
  return {
    messageId: "01J0PAID0000000000000000",
    type: ORDERS_ORDER_PAID,
    eventVersion: 1,
    aggregateId: "order-1",
    aggregateType: "order",
    occurredAt: "2026-08-24T10:00:00.000Z",
    correlationId: "corr-1",
    causationId: "cause-1",
    metadata: {},
    payload: {
      orderNumber: "ORD-1001",
      customerRef: "customer-9",
      paymentRef: "pi-7",
      currency: "EUR",
      totalAmountMinor: 12_345,
      ...overrides,
    },
  };
}

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
};

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

const FINANCE_TEST_TENANT_ID = "tenant-orders-paid-test";

function financeConsumer(
  append: (journal: Journal, tenantId?: string, tx?: unknown) => Promise<void>,
) {
  return new FinanceOrdersPaidConsumer(
    {
      journals: { append, findById: vi.fn(), findBySourceRef: vi.fn() },
      postingAccounts: POSTING_ACCOUNTS,
      idGenerator: { generate: () => "journal-1" },
      clock: { now: () => new Date("2026-08-24T10:00:01.000Z") },
    },
    FINANCE_TEST_TENANT_ID,
  );
}

describe("FinanceOrdersPaidConsumer (Task 17b, C-2 — payload adaptation)", () => {
  it("maps orderNumber/totalAmountMinor onto the { orderRef, amountMinor } shape Finance reads", async () => {
    // Finance's own OrdersPaidConsumer declares `{ orderRef, amountMinor, currency }`; Orders
    // publishes `{ orderNumber, ..., totalAmountMinor }`. Unadapted, this posts an undefined amount
    // against an undefined sourceRef — the mismatch was invisible because the class had no callers.
    const append = vi.fn(async (_journal: Journal, _tx?: unknown): Promise<void> => undefined);
    const consumer = financeConsumer(append);

    await consumer.handleAtomic(orderPaidEvent(), "tx-handle" as unknown as TransactionClient);

    expect(append).toHaveBeenCalledTimes(1);
    const journal = append.mock.calls[0]?.[0];
    expect(journal?.sourceRef).toBe("ORD-1001");
    expect(journal?.currency).toBe("EUR");
    expect(journal?.isPosted).toBe(true);
    expect(journal?.lines.map((line) => line.amount.amountMinor)).toEqual([12_345, 12_345]);
  });
});

describe("FinanceOrdersPaidConsumer — atomic ledger posting (C-2 fix round 1, finding C1)", () => {
  it("implements handleAtomic, so KafkaConsumerRuntime takes the ATOMIC path (ADR-0005)", () => {
    // The non-atomic path commits the journal first and the inbox marker second, in a SEPARATE
    // transaction: a crash in between makes Kafka redeliver the event, and a ledger append is not
    // idempotent (fresh journal id per call, no unique constraint on Journal.sourceRef), so the
    // same paid order posts revenue and receivable twice. The other three consumers dedupe on
    // their own idempotency keys; this one cannot.
    expect("handleAtomic" in FinanceOrdersPaidConsumer.prototype).toBe(true);
  });

  it("appends the journal on the tx it was handed — never a transaction of its own", async () => {
    const append = vi.fn(
      async (_journal: Journal, _tenantId?: string, _tx?: unknown): Promise<void> => undefined,
    );
    const consumer = financeConsumer(append);

    await consumer.handleAtomic(orderPaidEvent(), "runtime-tx" as unknown as TransactionClient);

    // Finance's OrdersPaidConsumer calls `journals.append(journal, tenantId)` with NO tx argument;
    // the tx reaching the repository is therefore proof the consumer bound the runtime's
    // transaction.
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[1]).toBe(FINANCE_TEST_TENANT_ID);
    expect(append.mock.calls[0]?.[2]).toBe("runtime-tx");
  });

  it("REFUSES the non-atomic path rather than risk double-posting the ledger", async () => {
    const append = vi.fn(async (_journal: Journal, _tx?: unknown): Promise<void> => undefined);

    await expect(financeConsumer(append).handle()).rejects.toThrow(/requires the atomic path/);
    expect(append).not.toHaveBeenCalled();
  });

  it("is the ONLY one of the four wired with a unitOfWork (the other three are self-idempotent)", () => {
    const core = buildRuntimeCore(loadRuntimeConfig(WORKER_ENV));
    const runtimes = buildOrdersPaidConsumerRuntimes(core, core.metrics);

    const atomic = runtimes.filter((runtime) => {
      const deps = runtimeDeps(runtime);
      return deps.unitOfWork !== undefined && typeof deps.handler.handleAtomic === "function";
    });
    expect(atomic).toHaveLength(1);
    expect(atomic[0]?.consumerGroup).toBe("finance.orders-paid");
    // The other three must NOT hold a Postgres transaction open across work that already
    // tolerates redelivery.
    expect(
      runtimes.filter((runtime) => runtimeDeps(runtime).unitOfWork !== undefined),
    ).toHaveLength(1);
  });
});

describe("LoyaltyOrdersPaidConsumer (Task 17b, C-2)", () => {
  function fakeAccounts(account: unknown): LoyaltyAccountRepository {
    return {
      findByCustomerRef: vi.fn(async () => account),
      findById: vi.fn(),
      save: vi.fn(),
    } as unknown as LoyaltyAccountRepository;
  }

  const activeAccount = {
    id: { toString: () => "acc-1" },
    status: { value: "active" },
  };

  it("earns points on the resolved account, keyed deterministically off the order number", async () => {
    const execute = vi.fn(async () =>
      ok({ accountId: "acc-1", status: "active", balance: 123, tierName: "bronze" }),
    );
    const consumer = new LoyaltyOrdersPaidConsumer({
      accounts: fakeAccounts(activeAccount),
      earnPoints: { execute } as unknown as EarnPoints,
      logger: silentLogger,
      tenantId: "tenant-local",
    });

    await consumer.handle(orderPaidEvent());

    expect(consumer.eventType).toBe("orders.order.paid");
    expect(execute).toHaveBeenCalledWith({
      accountId: "acc-1",
      idempotencyKey: "orders.order.paid:earn:ORD-1001",
      // 12_345 minor units -> 123 points at the documented placeholder 1-per-100 rate.
      points: 123,
      ref: "ORD-1001",
      tenantId: "tenant-local",
    });
  });

  it("SKIPS SILENTLY when the customer has no loyalty account (never opted in — not an error)", async () => {
    const execute = vi.fn();
    const consumer = new LoyaltyOrdersPaidConsumer({
      accounts: fakeAccounts(null),
      earnPoints: { execute } as unknown as EarnPoints,
      logger: silentLogger,
      tenantId: "tenant-local",
    });

    await expect(consumer.handle(orderPaidEvent())).resolves.toBeUndefined();
    // Throwing here would push every non-member's order through the retry topics into the DLQ.
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["suspended", "closed"])(
    "SKIPS a %s account instead of DLQ-ing every future order from that customer (finding I1)",
    async (status) => {
      // LoyaltyAccount.earn calls requireActive() and throws BusinessRuleError for a non-active
      // account. Letting that through would retry-then-dead-letter every paid order this customer
      // ever places — permanently, since `closed` is terminal in canTransitionAccount's table.
      const execute = vi.fn();
      const consumer = new LoyaltyOrdersPaidConsumer({
        accounts: fakeAccounts({ id: { toString: () => "acc-1" }, status: { value: status } }),
        earnPoints: { execute } as unknown as EarnPoints,
        logger: silentLogger,
        tenantId: "tenant-local",
      });

      await expect(consumer.handle(orderPaidEvent())).resolves.toBeUndefined();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("propagates a genuine use-case failure so the reliability envelope can retry/DLQ it", async () => {
    const consumer = new LoyaltyOrdersPaidConsumer({
      accounts: fakeAccounts(activeAccount),
      earnPoints: {
        execute: vi.fn(async () => err(new ValidationError("boom", []))),
      } as unknown as EarnPoints,
      logger: silentLogger,
      tenantId: "tenant-local",
    });

    await expect(consumer.handle(orderPaidEvent())).rejects.toThrow(/boom/);
  });

  it("floors the placeholder earning rate (1 point per 100 minor units)", () => {
    expect(pointsForPaidOrder(0)).toBe(0);
    expect(pointsForPaidOrder(99)).toBe(0);
    expect(pointsForPaidOrder(100)).toBe(1);
    expect(pointsForPaidOrder(12_345)).toBe(123);
  });
});

describe("Customer360OrdersPaidConsumer (Task 17b, C-2)", () => {
  it("asserts the order number as a verified `lastOrderRef` against the customer_id identifier", async () => {
    const execute = vi.fn(async () => ok({ applied: true, version: 1 }));
    const consumer = new Customer360OrdersPaidConsumer({
      updateProfileProjection: { execute } as unknown as UpdateProfileProjection,
      tenantId: "tenant-local",
    });

    await consumer.handle(orderPaidEvent());

    expect(execute).toHaveBeenCalledWith({
      tenantId: "tenant-local",
      identifier: { type: "customer_id", value: "customer-9" },
      field: "lastOrderRef",
      value: "ORD-1001",
      source: "orders",
      confidence: "verified",
      // The instant the order was paid, NOT the clock — `applyFieldUpdate`'s freshness guard
      // compares this against what is already on file.
      occurredAt: "2026-08-24T10:00:00.000Z",
    });
  });

  it("propagates a projection failure", async () => {
    const consumer = new Customer360OrdersPaidConsumer({
      updateProfileProjection: {
        execute: vi.fn(async () => err(new ValidationError("bad field", []))),
      } as unknown as UpdateProfileProjection,
      tenantId: "tenant-local",
    });

    await expect(consumer.handle(orderPaidEvent())).rejects.toThrow(/bad field/);
  });
});

describe("NotificationsOrdersPaidConsumer (Task 17b, C-2)", () => {
  it("opens an order-confirmation notification idempotently keyed off the order number", async () => {
    const execute = vi.fn(async () => ok({ notificationId: "ntf-1", status: "created" }));
    const consumer = new NotificationsOrdersPaidConsumer({
      createNotification: { execute } as unknown as CreateNotification,
      tenantId: "tenant-local",
    });

    await consumer.handle(orderPaidEvent());

    expect(execute).toHaveBeenCalledWith({
      tenantId: "tenant-local",
      idempotencyKey: "orders.order.paid:confirmation:ORD-1001",
      // `orders:<orderNumber>` matches OrdersNotificationAdapter's existing sourceRef convention.
      sourceRef: "orders:ORD-1001",
      recipientRef: "customer-9",
      channels: ["email"],
      templateId: "order-confirmation",
      bodyPattern:
        "Order {{orderNumber}} is confirmed. Total paid: {{totalAmountMinor}} {{currency}}.",
      subjectPattern: "Order {{orderNumber}} confirmed",
      variables: { orderNumber: "ORD-1001", currency: "EUR", totalAmountMinor: "12345" },
      maxAttempts: 3,
    });
  });

  it("propagates a create failure", async () => {
    const consumer = new NotificationsOrdersPaidConsumer({
      createNotification: {
        execute: vi.fn(async () => err(new ValidationError("no channels", []))),
      } as unknown as CreateNotification,
      tenantId: "tenant-local",
    });

    await expect(consumer.handle(orderPaidEvent())).rejects.toThrow(/no channels/);
  });
});

const ORDERS_PAID_GROUPS = [
  "finance.orders-paid",
  "loyalty.orders-paid",
  "customer360.orders-paid",
  "notifications.orders-paid",
];

describe("buildOrdersPaidConsumerRuntimes (Task 17b, C-2)", () => {
  it("composes exactly four consumers, all on `orders.order.paid`, in per-context groups", () => {
    const core = buildRuntimeCore(loadRuntimeConfig(WORKER_ENV));
    const runtimes = buildOrdersPaidConsumerRuntimes(core, core.metrics);

    expect(runtimes).toHaveLength(4);
    expect(runtimes.map((runtime) => runtime.topic)).toEqual([
      "orders.order.paid.v1",
      "orders.order.paid.v1",
      "orders.order.paid.v1",
      "orders.order.paid.v1",
    ]);
    expect(runtimes.map((runtime) => runtime.consumerGroup)).toEqual(ORDERS_PAID_GROUPS);
    expect(runtimes.every((runtime) => !runtime.isRunning)).toBe(true); // built, not started
  });
});

/**
 * Finding I3: the previous "worker-level" test built its OWN `ConsumerSupervisor` and re-ran the
 * registration loop, so deleting the registration lines from `worker.ts` would have left it green.
 * This calls the REAL `startWorker`. Only the broker (and the health server's TCP bind, mocked
 * above) is faked — `startWorker` itself, its supervisor, and its registration lines are the real
 * ones, so removing them fails this test.
 */
describe("startWorker — orders.order.paid registration (Task 17b, C-2)", () => {
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

  it("registers all four orders.order.paid consumer groups on the supervisor it returns", async () => {
    const config = loadRuntimeConfig(WORKER_ENV);

    const supervisor = await startWorker(config, fakeKafkaCore());

    const groups = supervisor.status().map((status) => status.consumerGroup);
    expect(groups).toEqual(expect.arrayContaining(ORDERS_PAID_GROUPS));
    // Registered alongside — not instead of — the payments-captured consumer that was already there.
    expect(groups).toContain("orders.payment-captured");
    await supervisor.stopAll();
  });
});
