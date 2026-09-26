import type { TransactionClient } from "@platform/db";
import type { IntegrationEvent } from "@platform/domain-events";
import type { Journal } from "@platform/finance";
import { describe, expect, it, vi } from "vitest";
import {
  FinancePaymentsCapturedConsumer,
  FinanceRefundsIssuedConsumer,
  type PaymentSettlementPayload,
} from "./finance-settlement.consumers";
import {
  Customer360OrdersPaidConsumer,
  FinanceOrdersPaidConsumer,
  LoyaltyOrdersPaidConsumer,
  NotificationsOrdersPaidConsumer,
  ORDERS_ORDER_PAID,
  type OrderPaidPayload,
} from "./orders-paid.consumers";

/**
 * G-64: every consumer routes by the tenant on the ENVELOPE. Two halves per handler:
 *  - feed it two events with different tenants and assert each write lands under its own;
 *  - feed it an envelope with no tenant and assert it fails in the direction that handler chose.
 *
 * Direction rule (relation-sync.consumer.ts): a skipped write denies, a skipped delete allows.
 * The handlers here all ADD something (a ledger entry, points, a profile fact, a notification), so
 * nothing is protected by skipping — but a ledger entry is money and must not vanish quietly, so the
 * Finance handlers THROW to the DLQ; the three projections/side-effects REFUSE (write nothing, log
 * an error, ack).
 */

function envelope<T>(type: string, tenantId: string | undefined, payload: T): IntegrationEvent<T> {
  return {
    messageId: `msg-${tenantId ?? "none"}`,
    type,
    eventVersion: 1,
    aggregateId: "agg-1",
    aggregateType: "x",
    occurredAt: "2026-09-26T10:00:00.000Z",
    correlationId: "corr",
    causationId: "cause",
    metadata: {},
    // Off the wire a tenant can be absent even though the type says it is required.
    ...(tenantId === undefined ? {} : { tenantId }),
    payload,
  } as IntegrationEvent<T>;
}

const paid: OrderPaidPayload = {
  orderNumber: "ORD-1",
  customerRef: "cust-1",
  paymentRef: "pi-1",
  currency: "EUR",
  totalAmountMinor: 12_300,
};
const settlement: PaymentSettlementPayload = {
  orderRef: "ORD-1",
  amountMinor: 500,
  currency: "EUR",
};

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
const POSTING = {
  revenue: "4000",
  receivable: "1200",
  cogs: "5000",
  inventory: "1300",
  refundContra: "4900",
  expense: "6000",
  cash: "1000",
  fees: "6100",
};
const tx = "tx" as unknown as TransactionClient;

const MISSING = [
  ["absent", undefined],
  ["empty", ""],
] as const;

function financeDeps() {
  const append = vi.fn(async (_j: Journal, _tenantId: string, _tx?: unknown) => undefined);
  return {
    append,
    deps: {
      journals: { append, findById: vi.fn(), findBySourceRef: vi.fn() },
      postingAccounts: POSTING,
      idGenerator: { generate: () => "j-1" },
      clock: { now: () => new Date("2026-09-26T10:00:01.000Z") },
    },
  };
}

interface Atomic {
  handleAtomic(event: never, tx: TransactionClient): Promise<void>;
}

describe("Finance ledger consumers — envelope tenant, missing tenant THROWS", () => {
  const cases: readonly (readonly [string, string, unknown, (deps: never) => Atomic])[] = [
    [
      "FinanceOrdersPaidConsumer",
      ORDERS_ORDER_PAID,
      paid,
      (d) => new FinanceOrdersPaidConsumer(d) as unknown as Atomic,
    ],
    [
      "FinancePaymentsCapturedConsumer",
      "payments.payment_intent.captured",
      settlement,
      (d) => new FinancePaymentsCapturedConsumer(d) as unknown as Atomic,
    ],
    [
      "FinanceRefundsIssuedConsumer",
      "payments.payment_intent.refunded",
      settlement,
      (d) => new FinanceRefundsIssuedConsumer(d) as unknown as Atomic,
    ],
  ];

  for (const [name, type, payload, make] of cases) {
    it(`${name}: each event is journalled under its own envelope tenant`, async () => {
      const { append, deps } = financeDeps();
      const consumer = make(deps as never);
      await consumer.handleAtomic(envelope(type, "tenant-a", payload) as never, tx);
      await consumer.handleAtomic(envelope(type, "tenant-b", payload) as never, tx);
      expect(append.mock.calls.map((c) => c[1])).toEqual(["tenant-a", "tenant-b"]);
    });

    it.each(MISSING)(
      `${name}: an envelope with an %s tenant throws to the DLQ and posts nothing`,
      async (_n, tenant) => {
        const { append, deps } = financeDeps();
        const consumer = make(deps as never);
        await expect(
          consumer.handleAtomic(envelope(type, tenant, payload) as never, tx),
        ).rejects.toThrow(/tenant/i);
        expect(append).not.toHaveBeenCalled();
      },
    );
  }
});

function tenantsOf(mock: { mock: { calls: unknown[][] } }, index: number): unknown[] {
  return mock.mock.calls.map((c) => {
    const arg = c[index];
    return typeof arg === "object" && arg !== null ? (arg as { tenantId?: string }).tenantId : arg;
  });
}

describe("LoyaltyOrdersPaidConsumer — envelope tenant, missing tenant REFUSES", () => {
  function make() {
    const findByCustomerRef = vi.fn(async (_ref: string, _tenant: string) => ({
      id: { toString: () => "acct-1" },
      status: { value: "active" },
    }));
    const execute = vi.fn(async (_input: { tenantId: string }) => ({ ok: true }));
    const consumer = new LoyaltyOrdersPaidConsumer({
      accounts: { findByCustomerRef } as never,
      earnPoints: { execute } as never,
      logger: logger as never,
    });
    return { consumer, findByCustomerRef, execute };
  }

  it("looks up and earns under each event's own tenant", async () => {
    const { consumer, findByCustomerRef, execute } = make();
    await consumer.handle(envelope(ORDERS_ORDER_PAID, "tenant-a", paid));
    await consumer.handle(envelope(ORDERS_ORDER_PAID, "tenant-b", paid));
    expect(findByCustomerRef.mock.calls.map((c) => c[1])).toEqual(["tenant-a", "tenant-b"]);
    expect(tenantsOf(execute, 0)).toEqual(["tenant-a", "tenant-b"]);
  });

  it.each(MISSING)(
    "refuses (reads nothing, earns nothing, logs an error, does not throw) on an %s tenant",
    async (_n, tenant) => {
      const { consumer, findByCustomerRef, execute } = make();
      logger.error.mockClear();
      await expect(
        consumer.handle(envelope(ORDERS_ORDER_PAID, tenant, paid)),
      ).resolves.toBeUndefined();
      expect(findByCustomerRef).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    },
  );
});

describe("Customer360OrdersPaidConsumer — envelope tenant, missing tenant REFUSES", () => {
  function make() {
    const execute = vi.fn(async (_input: { tenantId: string }) => ({ ok: true }));
    const consumer = new Customer360OrdersPaidConsumer({
      updateProfileProjection: { execute } as never,
      logger: logger as never,
    });
    return { consumer, execute };
  }

  it("projects each event under its own tenant", async () => {
    const { consumer, execute } = make();
    await consumer.handle(envelope(ORDERS_ORDER_PAID, "tenant-a", paid));
    await consumer.handle(envelope(ORDERS_ORDER_PAID, "tenant-b", paid));
    expect(tenantsOf(execute, 0)).toEqual(["tenant-a", "tenant-b"]);
  });

  it.each(MISSING)("refuses without writing on an %s tenant", async (_n, tenant) => {
    const { consumer, execute } = make();
    await expect(
      consumer.handle(envelope(ORDERS_ORDER_PAID, tenant, paid)),
    ).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("NotificationsOrdersPaidConsumer — envelope tenant, missing tenant REFUSES", () => {
  function make() {
    const execute = vi.fn(async (_input: { tenantId: string }) => ({ ok: true }));
    const consumer = new NotificationsOrdersPaidConsumer({
      createNotification: { execute } as never,
      logger: logger as never,
    });
    return { consumer, execute };
  }

  it("creates each notification under its own tenant", async () => {
    const { consumer, execute } = make();
    await consumer.handle(envelope(ORDERS_ORDER_PAID, "tenant-a", paid));
    await consumer.handle(envelope(ORDERS_ORDER_PAID, "tenant-b", paid));
    expect(tenantsOf(execute, 0)).toEqual(["tenant-a", "tenant-b"]);
  });

  it.each(MISSING)("refuses without creating anything on an %s tenant", async (_n, tenant) => {
    const { consumer, execute } = make();
    await expect(
      consumer.handle(envelope(ORDERS_ORDER_PAID, tenant, paid)),
    ).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });
});
