import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, PaymentProvider, ProviderIntent } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { PaymentIntent } from "./domain/payment-intent";
import type { PaymentIntentRepository } from "./domain/payment-intent-repository";
import { PaymentMethod, PspReference } from "./domain/value-objects/payment-references";
import {
  RefundPaymentLifecycle,
  type PaymentLifecycleDeps,
} from "./application/payment-lifecycle.use-cases";
import type { FinancePort, NotificationPort, OrdersPort } from "./application/ports";
import { PaymentIntentMapper, type PaymentIntentRow } from "./infrastructure/payment-intent.mapper";

/**
 * Phase A.10 (Task 2). Same fake shape as `refund-concurrency.test.ts` (Phase A.4) /
 * `capture-crash-recovery.test.ts` (Phase A.9) — round-trips every read/write through
 * `PaymentIntentMapper` so `findById` returns an independent snapshot per call and `save`
 * reproduces Postgres's `UPDATE ... WHERE id = ? AND version = ?` optimistic-lock contract exactly.
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

  seed(intent: PaymentIntent): void {
    this.write(intent, 1);
  }

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

  async findByPspReference(pspReference: string, _tenantId: string): Promise<PaymentIntent | null> {
    for (const row of this.rows.values()) {
      if (row.intentRow.pspReference === pspReference) {
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

class PassthroughUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

/** Records every PSP refund call; models Stripe's idempotency-key dedup (same convention as A.8's capture fake). */
class RecordingPaymentProvider implements PaymentProvider {
  readonly calls: Array<{ providerIntentId: string; amountMinor: number; idempotencyKey: string }> =
    [];
  private readonly seenKeys = new Set<string>();
  realEffects = 0;
  constructor(private readonly delayMs = 0) {}

  async createIntent(): Promise<ProviderIntent> {
    throw new Error("not used by this test");
  }
  async capture(): Promise<void> {}
  async cancel(): Promise<void> {}

  async refund(
    providerIntentId: string,
    amountMinor: number,
    idempotencyKey: string,
  ): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    this.calls.push({ providerIntentId, amountMinor, idempotencyKey });
    if (!this.seenKeys.has(idempotencyKey)) {
      this.seenKeys.add(idempotencyKey);
      this.realEffects += 1;
    }
  }

  async verifyWebhook(): Promise<boolean> {
    return true;
  }
}

class RecordingFinancePort implements FinancePort {
  readonly calls: Array<{ orderRef: string; amountMinor: number; currency: string; kind: string }> =
    [];
  async recordPaymentEvent(
    orderRef: string,
    amountMinor: number,
    currency: string,
    kind: string,
  ): Promise<void> {
    this.calls.push({ orderRef, amountMinor, currency, kind });
  }
}

class RecordingNotificationPort implements NotificationPort {
  readonly calls: Array<{ orderRef: string; status: string }> = [];
  async notify(orderRef: string, status: string): Promise<void> {
    this.calls.push({ orderRef, status });
  }
}

class RecordingOrdersPort implements OrdersPort {
  readonly calls: Array<{ orderRef: string; status: string }> = [];
  async reportPaymentOutcome(orderRef: string, status: string): Promise<void> {
    this.calls.push({ orderRef, status });
  }
}

let globalIdCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(globalIdCounter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-11T00:00:00.000Z") };

function usd(amountMinor: number): Money {
  const result = Money.create(amountMinor, "USD");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function seedCapturedIntent(
  repo: PostgresLikePaymentIntentRepository,
  id: string,
  capturedAmountMinor: number,
): void {
  const pi = PaymentIntent.createIntent(
    UniqueEntityId.from(id),
    `order-${id}`,
    usd(capturedAmountMinor),
  );
  pi.markProcessing("seed-1", new Date(0));
  const pspRef = PspReference.create(`psp-ref-${id}`);
  const method = PaymentMethod.create("tok_seed", "visa");
  if (!pspRef.ok || !method.ok) throw new Error("invalid fixture");
  pi.authorize(pspRef.value, method.value, capturedAmountMinor, "seed-2", new Date(0));
  pi.requestCapture("seed-3", new Date(0));
  pi.markCaptured("seed-4", new Date(0));
  pi.pullDomainEvents();
  repo.seed(pi);
}

function buildDeps(
  repo: PostgresLikePaymentIntentRepository,
  paymentProvider: PaymentProvider,
  extra?: {
    readonly financePort?: FinancePort;
    readonly notifications?: NotificationPort;
    readonly ordersPort?: OrdersPort;
  },
): PaymentLifecycleDeps {
  return {
    intents: repo,
    unitOfWork: new PassthroughUnitOfWork(),
    idGenerator: sequentialIds("evt"),
    clock,
    paymentProvider,
    financePort: extra?.financePort,
    notifications: extra?.notifications,
    ordersPort: extra?.ordersPort,
  };
}

describe("Task 2 — RefundPaymentLifecycle duplicate side-effect exploit (Phase A.10)", () => {
  it("EXPLOIT Scenario A: two concurrent full-request retries with the SAME idempotency key both race reserve() then settle() — must notify exactly once", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-dup-a", 1000);
    // A real PSP round-trip has latency — both callers' reserve() phases resolve (neither sees the
    // other's settle() yet) before either's PSP call returns, exactly like the genuine
    // `refund-concurrency.test.ts` race but with a SHARED idempotencyKey so both resolve to the
    // SAME logical refund reservation instead of two independent ones.
    const provider = new RecordingPaymentProvider(30);
    const notifications = new RecordingNotificationPort();
    const finance = new RecordingFinancePort();
    const orders = new RecordingOrdersPort();
    const lifecycle = new RefundPaymentLifecycle(
      buildDeps(repo, provider, { notifications, financePort: finance, ordersPort: orders }),
    );

    const [a, b] = await Promise.all([
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-dup-a",
        amountMinor: 400,
        currency: "USD",
        idempotencyKey: "return-1:refund",
      }),
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-dup-a",
        amountMinor: 400,
        currency: "USD",
        idempotencyKey: "return-1:refund",
      }),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const final = await repo.findById("pi-dup-a", "tenant-a");
    // Exactly one logical refund reservation was ever created — the PSP was dedup'd correctly.
    expect(final?.refunds).toHaveLength(1);
    expect(provider.realEffects).toBe(1);

    // The financially/customer-visible side effects of settlement must fire exactly once, not once
    // per racing settle() call.
    expect(notifications.calls).toHaveLength(1);
    expect(orders.calls).toHaveLength(1);
  });

  it("EXPLOIT Scenario C: the SAME completed refund settled twice sequentially is a pure no-op the second time", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-dup-c", 1000);
    const provider = new RecordingPaymentProvider();
    const notifications = new RecordingNotificationPort();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider, { notifications }));

    const first = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-dup-c",
      amountMinor: 400,
      currency: "USD",
      idempotencyKey: "return-2:refund",
    });
    expect(first.ok).toBe(true);
    expect(notifications.calls).toHaveLength(1);

    // A second full-request retry with the SAME key, well after the first settled — Phase A.5's
    // `alreadyCompleted` short-circuit in `execute()` should catch this before ever reaching PSP or
    // settle() again.
    const second = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-dup-c",
      amountMinor: 400,
      currency: "USD",
      idempotencyKey: "return-2:refund",
    });
    expect(second.ok).toBe(true);

    expect(provider.calls).toHaveLength(1);
    expect(notifications.calls).toHaveLength(1);

    const final = await repo.findById("pi-dup-c", "tenant-a");
    expect(final?.refunds).toHaveLength(1);
    expect(final?.refunds[0]?.status).toBe("completed");
  });

  it("does not duplicate the refund.transitioned(completed) domain event or the refund attempt log on a racing settle", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-dup-events", 1000);
    const provider = new RecordingPaymentProvider(30);
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    await Promise.all([
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-dup-events",
        amountMinor: 250,
        currency: "USD",
        idempotencyKey: "return-3:refund",
      }),
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-dup-events",
        amountMinor: 250,
        currency: "USD",
        idempotencyKey: "return-3:refund",
      }),
    ]);

    const final = await repo.findById("pi-dup-events", "tenant-a");
    // Append-only attempt log: exactly one "refund succeeded" attempt, not one per racing settle().
    const refundAttempts = final?.attempts.filter(
      (a) => a.kind === "refund" && a.outcome === "succeeded",
    );
    expect(refundAttempts).toHaveLength(1);
  });
});
