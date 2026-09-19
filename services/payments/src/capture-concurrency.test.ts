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
import { InMemoryProcessedWebhookStore } from "./infrastructure/in-memory-port-adapters";
import { PaymentIntentMapper, type PaymentIntentRow } from "./infrastructure/payment-intent.mapper";

/**
 * Phase A.8 (capture-concurrency security audit). Same fake shape as `refund-concurrency.test.ts`
 * (Phase A.4) / `refund-idempotency.test.ts` (Phase A.5) — round-trips every read/write through
 * `PaymentIntentMapper` so `findById` returns an INDEPENDENT snapshot per call and `save` reproduces
 * Postgres's `UPDATE ... WHERE id = ? AND version = ?` optimistic-lock contract exactly (a write
 * whose `version` no longer matches throws `ConcurrencyError`, mirroring
 * `PrismaPaymentIntentRepository.save`).
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

/** Runs `work` directly — concurrency correctness comes entirely from `save`'s version check, exactly like the real Prisma repository's guarantee does not depend on `$transaction` alone either. */
class PassthroughUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

/**
 * Task 2/16 structural proof. Tracks how many `run()` calls are currently open (a stand-in for "a
 * live DB transaction/connection is held"). A `PaymentProvider` that samples `openCount` at the
 * instant it is invoked can prove whether a PSP network call happens WHILE a transaction is open
 * (the long-transaction anti-pattern A.7 flagged) or strictly BETWEEN two committed transactions
 * (the already-proven Refund/Phase-A.4 pattern).
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

/**
 * Records every PSP capture call and the transaction-openness at call time. Also models the actual
 * guarantee a real idempotency-key-aware PSP (Stripe) provides: a SECOND call presenting an
 * idempotency key it has already seen does not move money a second time — it replays the cached
 * outcome of the first. `calls` records every physical invocation (what identity was PRESENTED);
 * `realEffects` counts only the FIRST occurrence of each distinct idempotency key (how many times
 * money actually moved) — same distinction `refund-idempotency.test.ts`'s `RecordingPaymentProvider`
 * uses for Task 7 (PSP Semantics).
 */
class RecordingCaptureProvider implements PaymentProvider {
  readonly calls: Array<{
    providerIntentId: string;
    idempotencyKey: string;
    openCountAtCall: number;
  }> = [];
  private readonly seenKeys = new Set<string>();
  realEffects = 0;

  constructor(
    private readonly uow?: TrackingUnitOfWork,
    private readonly delayMs = 0,
    private readonly failAlways = false,
  ) {}

  async createIntent(): Promise<ProviderIntent> {
    throw new Error("not used by this test");
  }
  async cancel(): Promise<void> {}
  async refund(): Promise<void> {
    throw new Error("not used by this test");
  }

  async capture(providerIntentId: string, idempotencyKey: string): Promise<void> {
    this.calls.push({
      providerIntentId,
      idempotencyKey,
      openCountAtCall: this.uow?.openCount ?? -1,
    });
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.failAlways) {
      throw new Error("simulated PSP capture failure");
    }
    if (this.seenKeys.has(idempotencyKey)) {
      return; // real-PSP dedup: replays the original outcome, does not move money again
    }
    this.seenKeys.add(idempotencyKey);
    this.realEffects += 1;
  }

  async verifyWebhook(): Promise<boolean> {
    return true;
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

/** An authorized-but-not-yet-captured intent — the only status `requestCapture()` accepts. */
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

function buildDeps(
  repo: PostgresLikePaymentIntentRepository,
  paymentProvider: PaymentProvider,
  unitOfWork: TransactionalUnitOfWork<unknown> = new PassthroughUnitOfWork(),
): PaymentLifecycleDeps {
  return {
    intents: repo,
    unitOfWork,
    idGenerator: sequentialIds("evt"),
    clock,
    paymentProvider,
  };
}

describe("Task 3/20 — exploit proof: concurrent capture requests for the same intent", () => {
  it("both concurrent captures present the SAME deterministic PSP idempotency key (unlike pre-A.5 refund, capture's key never depended on a per-call reservation id)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-key", 1000);
    const provider = new RecordingCaptureProvider();
    const lifecycle = new CapturePaymentLifecycle(buildDeps(repo, provider));

    await Promise.allSettled([
      lifecycle.execute({ tenantId: "tenant-a", paymentIntentId: "pi-key" }),
      lifecycle.execute({ tenantId: "tenant-a", paymentIntentId: "pi-key" }),
    ]);

    expect(provider.calls.length).toBeGreaterThanOrEqual(1);
    expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBe(1);
    // The PSP itself only ever moved money once, regardless of how many physical calls were made.
    expect(provider.realEffects).toBe(1);
  });

  it("EXPLOIT: the losing side of a genuine concurrent capture race throws an uncaught ConcurrencyError instead of returning a clean Result (no `withConcurrencyRetry`, unlike RefundPaymentLifecycle)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-race", 1000);
    const provider = new RecordingCaptureProvider();
    const lifecycle = new CapturePaymentLifecycle(buildDeps(repo, provider));

    const outcomes = await Promise.allSettled([
      lifecycle.execute({ tenantId: "tenant-a", paymentIntentId: "pi-race" }),
      lifecycle.execute({ tenantId: "tenant-a", paymentIntentId: "pi-race" }),
    ]);

    // Desired/safe behavior: BOTH callers get back a Result (ok or a clean domain err), neither
    // call rejects the returned promise with a raw, uncaught exception.
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("fulfilled");
    }
  });
});

describe("Task 2/16 — exploit proof: the PSP call happens while a DB transaction is open (long-transaction anti-pattern)", () => {
  it("EXPLOIT: PaymentProvider.capture() is invoked with a transaction still open (openCount > 0)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-tx", 1000);
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingCaptureProvider(uow);
    const lifecycle = new CapturePaymentLifecycle(buildDeps(repo, provider, uow));

    await lifecycle.execute({ tenantId: "tenant-a", paymentIntentId: "pi-tx" });

    expect(provider.calls).toHaveLength(1);
    // Desired/safe behavior: no transaction should be open while the PSP network call is in flight.
    expect(provider.calls[0]?.openCountAtCall).toBe(0);
  });
});

describe("Task 8 — crash-consistency: webhook reconciliation after a crash between PSP success and DB commit", () => {
  function buildWebhookDeps(repo: PostgresLikePaymentIntentRepository): RecordWebhookDeps {
    return {
      intents: repo,
      unitOfWork: new PassthroughUnitOfWork(),
      idGenerator: sequentialIds("wh"),
      clock,
      processedWebhooks: new InMemoryProcessedWebhookStore(),
    };
  }

  it("STANDING GAP (architecture-level, not fixed by this phase): a `payment_intent.succeeded` webhook cannot repair an intent stuck at `authorized` — `authorized -> captured` is not a legal transition", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-stuck-authorized", 1000);
    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo));

    const result = await recordWebhook.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-stuck-authorized",
      provider: "stripe",
      eventId: "evt_stripe_1",
      kind: "captured",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BUSINESS_RULE");
    const afterWebhook = await repo.findById("pi-stuck-authorized", "tenant-a");
    expect(afterWebhook?.status.value).toBe("authorized"); // permanently stuck under today's crash window
  });

  it("FIX TARGET: if the crash window instead leaves the intent durably at `capture_requested` (the reservation this phase's fix commits BEFORE the PSP call), the same webhook DOES repair it", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-stuck-requested", 1000);
    // Simulate the fixed reserve() step's durable pre-PSP-call commit.
    const intent = await repo.findById("pi-stuck-requested", "tenant-a");
    if (intent === null) throw new Error("fixture missing");
    intent.requestCapture("evt-reserve", new Date(0));
    await repo.save(intent, "tenant-a");
    // ^ PSP call happens here (outside any transaction) and "crashes" before `settle()` runs.

    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo));
    const result = await recordWebhook.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-stuck-requested",
      provider: "stripe",
      eventId: "evt_stripe_2",
      kind: "captured",
    });

    expect(result.ok).toBe(true);
    const afterWebhook = await repo.findById("pi-stuck-requested", "tenant-a");
    expect(afterWebhook?.status.value).toBe("captured");
  });
});

describe("Task 4/18 Scenario D — PSP failure recovery", () => {
  it("a PSP capture failure does not leave the intent permanently stuck — a subsequent capture attempt succeeds", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-psp-fail", 1000);
    const failingProvider = new RecordingCaptureProvider(undefined, 0, true);
    const lifecycle = new CapturePaymentLifecycle(buildDeps(repo, failingProvider));

    await expect(
      lifecycle.execute({ tenantId: "tenant-a", paymentIntentId: "pi-psp-fail" }),
    ).rejects.toThrow(/simulated PSP capture failure/);

    const workingProvider = new RecordingCaptureProvider();
    const retryLifecycle = new CapturePaymentLifecycle(buildDeps(repo, workingProvider));
    const retried = await retryLifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-psp-fail",
    });
    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.status).toBe("captured");
  });
});

describe("Task 4 Scenario F/12 — retry with the same identity and unauthorized targets", () => {
  it("retrying capture on an already-captured intent is a clean idempotent no-op, not a duplicate charge", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-already", 1000);
    const provider = new RecordingCaptureProvider();
    const lifecycle = new CapturePaymentLifecycle(buildDeps(repo, provider));

    const first = await lifecycle.execute({ tenantId: "tenant-a", paymentIntentId: "pi-already" });
    expect(first.ok).toBe(true);

    const second = await lifecycle.execute({ tenantId: "tenant-a", paymentIntentId: "pi-already" });
    // Desired/safe behavior: a retry after genuine success must not error out or re-charge.
    expect(second.ok).toBe(true);
    expect(provider.realEffects).toBe(1);
  });

  it("capturing a nonexistent payment intent returns a clean NOT_FOUND, never touches the PSP", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    const provider = new RecordingCaptureProvider();
    const lifecycle = new CapturePaymentLifecycle(buildDeps(repo, provider));

    const result = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "does-not-exist",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(provider.calls).toHaveLength(0);
  });
});
