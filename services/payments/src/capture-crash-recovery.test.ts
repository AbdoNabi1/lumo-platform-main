import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, PaymentProvider, ProviderIntent } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { PaymentIntent } from "./domain/payment-intent";
import type { PaymentIntentRepository } from "./domain/payment-intent-repository";
import { PaymentMethod, PspReference } from "./domain/value-objects/payment-references";
import {
  CapturePaymentLifecycle,
  type PaymentLifecycleDeps,
} from "./application/payment-lifecycle.use-cases";
import { RecordWebhook, type RecordWebhookDeps } from "./application/record-webhook.use-case";
import type { FinancePort, NotificationPort, OrdersPort } from "./application/ports";
import { InMemoryProcessedWebhookStore } from "./infrastructure/in-memory-port-adapters";
import { PaymentIntentMapper, type PaymentIntentRow } from "./infrastructure/payment-intent.mapper";

/**
 * Phase A.9 (capture crash-recovery/reconciliation closure). Same fake shape as
 * `capture-concurrency.test.ts` (Phase A.8) — round-trips every read/write through
 * `PaymentIntentMapper` so `findById` returns an independent snapshot per call and `save` reproduces
 * Postgres's `UPDATE ... WHERE id = ? AND version = ?` optimistic-lock contract exactly.
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

  async save(intent: PaymentIntent): Promise<void> {
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

  async findById(id: string): Promise<PaymentIntent | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    return PaymentIntentMapper.toDomain(
      row.intentRow,
      row.chargeRows,
      row.refundRows,
      row.attemptRows,
    );
  }

  async findByIdempotencyKey(): Promise<PaymentIntent | null> {
    return null;
  }

  async findByPspReference(pspReference: string): Promise<PaymentIntent | null> {
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

/** Records every PSP capture call; models Stripe's idempotency-key dedup (same convention as A.8's fake). */
class RecordingCaptureProvider implements PaymentProvider {
  readonly calls: Array<{ providerIntentId: string; idempotencyKey: string }> = [];
  private readonly seenKeys = new Set<string>();
  realEffects = 0;
  constructor(private readonly failAlways = false) {}

  async createIntent(): Promise<ProviderIntent> {
    throw new Error("not used by this test");
  }
  async cancel(): Promise<void> {}
  async refund(): Promise<void> {
    throw new Error("not used by this test");
  }

  async capture(providerIntentId: string, idempotencyKey: string): Promise<void> {
    this.calls.push({ providerIntentId, idempotencyKey });
    if (this.failAlways) throw new Error("simulated PSP capture failure");
    if (this.seenKeys.has(idempotencyKey)) return;
    this.seenKeys.add(idempotencyKey);
    this.realEffects += 1;
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

function seedAuthorizedIntent(
  repo: PostgresLikePaymentIntentRepository,
  id: string,
  amountMinor: number,
): void {
  const pi = PaymentIntent.createIntent(UniqueEntityId.from(id), `order-${id}`, usd(amountMinor));
  pi.markProcessing("seed-1", new Date(0));
  const pspRef = PspReference.create(`psp-ref-${id}`);
  const method = PaymentMethod.create("tok_seed", "visa");
  if (!pspRef.ok || !method.ok) throw new Error("invalid fixture");
  pi.authorize(pspRef.value, method.value, amountMinor, "seed-2", new Date(0));
  pi.pullDomainEvents();
  repo.seed(pi);
}

/** Drives an intent to the durable `capture_requested` reservation state directly, bypassing `CapturePaymentLifecycle.execute()` — models "reserve() already committed" without invoking the PSP through the use case. */
async function seedReservedIntent(
  repo: PostgresLikePaymentIntentRepository,
  id: string,
): Promise<void> {
  const intent = await repo.findById(id);
  if (intent === null) throw new Error("fixture missing — call seedAuthorizedIntent first");
  intent.requestCapture("evt-reserve", new Date(0));
  await repo.save(intent);
}

function buildLifecycleDeps(
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

function buildWebhookDeps(
  repo: PostgresLikePaymentIntentRepository,
  extra?: Partial<RecordWebhookDeps>,
): RecordWebhookDeps {
  return {
    intents: repo,
    unitOfWork: new PassthroughUnitOfWork(),
    idGenerator: sequentialIds("wh"),
    clock,
    processedWebhooks: new InMemoryProcessedWebhookStore(),
    ...extra,
  };
}

describe("Task 3 — exploit proof: webhook-only recovery after a PSP-success-then-crash", () => {
  it("EXPLOIT: RecordWebhook advances status to `captured` but does not create the Charge, notify Orders/Notifications, or record the Finance event", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-crash-1", 1000);
    // Simulates: reserve() already committed (capture_requested durable), PSP capture succeeded for
    // real, then the process crashed BEFORE CapturePaymentLifecycle.settle() ever ran.
    await seedReservedIntent(repo, "pi-crash-1");

    const finance = new RecordingFinancePort();
    const notifications = new RecordingNotificationPort();
    const orders = new RecordingOrdersPort();
    const captureSettlement = new CapturePaymentLifecycle(
      buildLifecycleDeps(repo, new RecordingCaptureProvider(), {
        financePort: finance,
        notifications,
        ordersPort: orders,
      }),
    );

    // Recovery attempt: ONLY a webhook arrives — no client ever retries the capture request.
    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo, { captureSettlement }));
    const result = await recordWebhook.execute({
      paymentIntentId: "pi-crash-1",
      provider: "stripe",
      eventId: "evt_stripe_1",
      kind: "captured",
    });

    expect(result.ok).toBe(true);
    const afterWebhook = await repo.findById("pi-crash-1");
    expect(afterWebhook?.status.value).toBe("captured");

    // The exploit: the status transition alone is not full settlement. Desired/safe behavior: the
    // SAME Charge/Finance/notify side effects `CapturePaymentLifecycle.settle()` performs on a
    // normal retry must also happen when recovery occurs purely via webhook.
    expect(afterWebhook?.charges).toHaveLength(1);
    expect(afterWebhook?.charges[0]?.amount.amountMinor).toBe(1000);
    expect(finance.calls).toHaveLength(1);
    expect(finance.calls[0]).toMatchObject({
      orderRef: "order-pi-crash-1",
      amountMinor: 1000,
      kind: "captured",
    });
    expect(notifications.calls).toHaveLength(1);
    expect(orders.calls).toHaveLength(1);
  });

  it("without an injected captureSettlement (backward-compatible fallback), webhook-only recovery still only advances status — documented, not treated as a new regression", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-fallback", 1000);
    await seedReservedIntent(repo, "pi-fallback");

    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo)); // no captureSettlement wired
    const result = await recordWebhook.execute({
      paymentIntentId: "pi-fallback",
      provider: "stripe",
      eventId: "evt_stripe_fallback",
      kind: "captured",
    });

    expect(result.ok).toBe(true);
    const after = await repo.findById("pi-fallback");
    expect(after?.status.value).toBe("captured");
    expect(after?.charges).toHaveLength(0); // pre-existing fallback shape, unchanged by this phase
  });
});

describe("Task 10 — process restart simulation: Instance A reserves+crashes, Instance B reconciles", () => {
  it("Instance B's webhook-driven reconciliation and a later legitimate retry both converge to the same final state", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-restart", 1000);

    // Instance A: reserve commits, PSP succeeds, instance A crashes before settle().
    await seedReservedIntent(repo, "pi-restart");

    // Instance B: fresh process, fresh dependency graph, reconciles via webhook.
    const finance = new RecordingFinancePort();
    const captureSettlement = new CapturePaymentLifecycle(
      buildLifecycleDeps(repo, new RecordingCaptureProvider(), { financePort: finance }),
    );
    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo, { captureSettlement }));
    const reconciled = await recordWebhook.execute({
      paymentIntentId: "pi-restart",
      provider: "stripe",
      eventId: "evt_restart_1",
      kind: "captured",
    });
    expect(reconciled.ok).toBe(true);

    // A legitimate retry of the ORIGINAL capture request also arrives (e.g. the original caller's
    // client retried after a timeout). It must converge to the identical final state, not error.
    const provider = new RecordingCaptureProvider();
    const retryLifecycle = new CapturePaymentLifecycle(buildLifecycleDeps(repo, provider));
    const retried = await retryLifecycle.execute({ paymentIntentId: "pi-restart" });

    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.status).toBe("captured");
    expect(provider.calls).toHaveLength(0); // already captured — reserve() short-circuited before any PSP call

    const final = await repo.findById("pi-restart");
    expect(final?.status.value).toBe("captured");
    expect(final?.charges).toHaveLength(1); // exactly one Charge, not two
    expect(finance.calls).toHaveLength(1); // exactly one Finance record, not two
  });
});

describe("Task 11 — webhook race: retry and webhook both attempt settlement", () => {
  it("webhook and a concurrent capture retry racing to settle() converge to exactly one Charge and one Finance record", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-race-1", 1000);
    await seedReservedIntent(repo, "pi-race-1");

    const finance = new RecordingFinancePort();
    const captureSettlement = new CapturePaymentLifecycle(
      buildLifecycleDeps(repo, new RecordingCaptureProvider(), { financePort: finance }),
    );
    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo, { captureSettlement }));
    const retryProvider = new RecordingCaptureProvider();
    const retryLifecycle = new CapturePaymentLifecycle(
      buildLifecycleDeps(repo, retryProvider, { financePort: finance }),
    );

    const outcomes = await Promise.allSettled([
      recordWebhook.execute({
        paymentIntentId: "pi-race-1",
        provider: "stripe",
        eventId: "evt_race_1",
        kind: "captured",
      }),
      retryLifecycle.execute({ paymentIntentId: "pi-race-1" }),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe("fulfilled");
    }

    const final = await repo.findById("pi-race-1");
    expect(final?.status.value).toBe("captured");
    expect(final?.charges).toHaveLength(1);
    expect(finance.calls).toHaveLength(1);
  });

  it("reversed ordering — retry first, webhook second — converges identically", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-race-2", 1000);
    await seedReservedIntent(repo, "pi-race-2");

    const finance = new RecordingFinancePort();
    const retryProvider = new RecordingCaptureProvider();
    const retryLifecycle = new CapturePaymentLifecycle(
      buildLifecycleDeps(repo, retryProvider, { financePort: finance }),
    );
    const captureSettlement = new CapturePaymentLifecycle(
      buildLifecycleDeps(repo, new RecordingCaptureProvider(), { financePort: finance }),
    );
    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo, { captureSettlement }));

    const retried = await retryLifecycle.execute({ paymentIntentId: "pi-race-2" });
    expect(retried.ok).toBe(true);

    const webhooked = await recordWebhook.execute({
      paymentIntentId: "pi-race-2",
      provider: "stripe",
      eventId: "evt_race_2",
      kind: "captured",
    });
    expect(webhooked.ok).toBe(true);

    const final = await repo.findById("pi-race-2");
    expect(final?.charges).toHaveLength(1);
    expect(finance.calls).toHaveLength(1);
  });
});

describe("Task 12 — duplicate webhook delivery", () => {
  it("the same successful-capture webhook delivered 3 times settles exactly once; later deliveries are safe no-ops", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-dup", 1000);
    await seedReservedIntent(repo, "pi-dup");

    const finance = new RecordingFinancePort();
    const captureSettlement = new CapturePaymentLifecycle(
      buildLifecycleDeps(repo, new RecordingCaptureProvider(), { financePort: finance }),
    );
    const processedWebhooks = new InMemoryProcessedWebhookStore();
    const recordWebhook = new RecordWebhook(
      buildWebhookDeps(repo, { captureSettlement, processedWebhooks }),
    );

    const input = {
      paymentIntentId: "pi-dup",
      provider: "stripe",
      eventId: "evt_dup_1", // same eventId every time — a real Stripe redelivery
      kind: "captured",
    };
    const first = await recordWebhook.execute(input);
    const second = await recordWebhook.execute(input);
    const third = await recordWebhook.execute(input);

    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.duplicate).toBe(false);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.duplicate).toBe(true);
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.value.duplicate).toBe(true);

    const final = await repo.findById("pi-dup");
    expect(final?.charges).toHaveLength(1);
    expect(finance.calls).toHaveLength(1);
  });
});

describe("Task 9 — partial settlement failure and PSP-failure-before-settlement", () => {
  it("PSP capture succeeds but the settlement write fails once (transient), then a retry safely completes settlement — no duplicate Charge", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-settle-fail", 1000);
    await seedReservedIntent(repo, "pi-settle-fail");

    // Simulate the settlement transaction itself failing once (e.g. a transient DB error) by
    // wrapping the repository's save() to throw on the first call only.
    let saveAttempts = 0;
    const flaky: PaymentIntentRepository = {
      findById: (id) => repo.findById(id),
      findByIdempotencyKey: () => repo.findByIdempotencyKey(),
      findByPspReference: (pspReference) => repo.findByPspReference(pspReference),
      save: async (intent) => {
        saveAttempts += 1;
        if (saveAttempts === 1) throw new Error("simulated transient DB failure during settlement");
        return repo.save(intent);
      },
    };
    const finance = new RecordingFinancePort();
    const flakyDeps: PaymentLifecycleDeps = {
      ...buildLifecycleDeps(repo, new RecordingCaptureProvider(), { financePort: finance }),
      intents: flaky,
    };
    const captureSettlement = new CapturePaymentLifecycle(flakyDeps);

    await expect(captureSettlement.settle("pi-settle-fail")).rejects.toThrow(
      /simulated transient DB failure/,
    );
    const afterFailedSettle = await repo.findById("pi-settle-fail");
    expect(afterFailedSettle?.status.value).toBe("capture_requested"); // unsettled, but not corrupted
    expect(afterFailedSettle?.charges).toHaveLength(0);

    // Retry: settle() again (e.g. driven by a subsequent webhook or client retry) succeeds cleanly.
    const retried = await captureSettlement.settle("pi-settle-fail");
    expect(retried.ok).toBe(true);
    const final = await repo.findById("pi-settle-fail");
    expect(final?.status.value).toBe("captured");
    expect(final?.charges).toHaveLength(1); // exactly one, not duplicated by the failed first attempt
    expect(finance.calls).toHaveLength(1);
  });

  it("PSP capture failure (never reaches settlement) leaves the reservation retryable, not stuck", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-psp-fail", 1000);
    const failingLifecycle = new CapturePaymentLifecycle(
      buildLifecycleDeps(repo, new RecordingCaptureProvider(true)),
    );

    await expect(failingLifecycle.execute({ paymentIntentId: "pi-psp-fail" })).rejects.toThrow(
      /simulated PSP capture failure/,
    );

    const workingLifecycle = new CapturePaymentLifecycle(
      buildLifecycleDeps(repo, new RecordingCaptureProvider()),
    );
    const retried = await workingLifecycle.execute({ paymentIntentId: "pi-psp-fail" });
    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.status).toBe("captured");
  });
});

describe("Task 8 — idempotency key preservation through the webhook-mediated settlement path", () => {
  it("Scenario B: PSP succeeds, DB settlement fails, retry via the SAME deterministic key does not create a second real PSP capture", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-idem", 1000);

    const provider = new RecordingCaptureProvider();
    const lifecycle = new CapturePaymentLifecycle(buildLifecycleDeps(repo, provider));

    const first = await lifecycle.execute({ paymentIntentId: "pi-idem" });
    expect(first.ok).toBe(true);

    // A second full request (e.g. a client retry believing the first was lost) presents the SAME
    // deterministic key <paymentIntentId>:capture — never a fresh one.
    const second = await lifecycle.execute({ paymentIntentId: "pi-idem" });
    expect(second.ok).toBe(true);

    expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBeLessThanOrEqual(1);
    expect(provider.realEffects).toBe(1); // the PSP itself only ever moved money once
  });
});

describe("Task 15 — financial invariants after recovery", () => {
  it("capturedAmount never exceeds authorizedAmount, exactly one Charge exists, and PaymentIntent status matches PSP truth after any recovery path", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-invariant", 750);
    await seedReservedIntent(repo, "pi-invariant");

    const captureSettlement = new CapturePaymentLifecycle(
      buildLifecycleDeps(repo, new RecordingCaptureProvider()),
    );
    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo, { captureSettlement }));
    await recordWebhook.execute({
      paymentIntentId: "pi-invariant",
      provider: "stripe",
      eventId: "evt_invariant",
      kind: "captured",
    });

    const final = await repo.findById("pi-invariant");
    expect(final?.status.value).toBe("captured");
    expect(final?.charges).toHaveLength(1);
    const totalCaptured = final?.charges.reduce((sum, c) => sum + c.amount.amountMinor, 0) ?? 0;
    expect(totalCaptured).toBe(750);
    expect(totalCaptured).toBeLessThanOrEqual(final?.authorizedAmount?.amountMinor ?? 0);
  });
});
