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
import { PaymentIntentMapper, type PaymentIntentRow } from "./infrastructure/payment-intent.mapper";

/**
 * Phase A.4 (refund-concurrency remediation). This is deliberately NOT
 * `InMemoryPaymentIntentRepository` (`infrastructure/in-memory-payment-intent-repository.ts`) —
 * that repository stores the live aggregate object by reference and never checks `version` at all,
 * so it cannot prove anything about the real cross-replica race (two Postgres transactions each
 * with their OWN row snapshot, serialized only by the `version` column). This fake instead
 * round-trips every read/write through `PaymentIntentMapper` (the exact same plain-row shapes
 * `PrismaPaymentIntentRepository` persists) so `findById` returns an INDEPENDENT snapshot every
 * call (mutating one caller's returned aggregate can never leak into another's) and `save`
 * reproduces Postgres's `UPDATE ... WHERE id = ? AND version = ?` contract exactly: a write whose
 * `version` no longer matches the stored row throws `ConcurrencyError`, precisely mirroring
 * `PrismaPaymentIntentRepository.save`.
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

  /** Seeds a row as already durably persisted (version 1 — mirrors a real create()'s stored version). */
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

/** Runs `work` directly — this fake's concurrency correctness comes from `save`'s version check, not from any transaction wrapper, exactly like the real Prisma repository's guarantee does not depend on `$transaction` alone either (see the Phase A.4 report's Phase B). */
class PassthroughUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

/** Records every PSP refund call; optionally delays (simulates network latency) and/or fails for a given amount. */
class RecordingPaymentProvider implements PaymentProvider {
  readonly calls: Array<{ providerIntentId: string; amountMinor: number; idempotencyKey: string }> =
    [];
  constructor(
    private readonly delayMs = 0,
    private readonly failFor?: (amountMinor: number) => boolean,
  ) {}

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
    if (this.failFor?.(amountMinor) === true) {
      throw new Error("simulated PSP failure");
    }
  }

  async verifyWebhook(): Promise<boolean> {
    return true;
  }
}

// A single module-level counter (not reset per `IdGenerator` instance) — ids must stay globally
// unique across every `RefundPaymentLifecycle` built in a test, exactly like the real UUIDv7
// `IdGenerator` never repeats. Resetting per-instance would let a retry's reservation collide
// with an earlier attempt's already-persisted refund id, which cannot happen in production.
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

/** A fully captured, PSP-authorized intent (pspReference set — the only path that actually calls the PSP). */
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
): PaymentLifecycleDeps {
  return {
    intents: repo,
    unitOfWork: new PassthroughUnitOfWork(),
    idGenerator: sequentialIds("evt"),
    clock,
    paymentProvider,
  };
}

describe("RefundPaymentLifecycle — concurrency proof (Phase A.4)", () => {
  it("Case 1: captured=1000, concurrent 700+700 — at most 1000 refunded, exactly ONE PSP call ever made", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-1", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    const [a, b] = await Promise.all([
      lifecycle.execute({ paymentIntentId: "pi-1", amountMinor: 700, currency: "USD" }),
      lifecycle.execute({ paymentIntentId: "pi-1", amountMinor: 700, currency: "USD" }),
    ]);

    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.filter((r) => !r.ok)).toHaveLength(1);
    // The rejected side must be a clean domain rejection (409 BUSINESS_RULE), never a raw throw.
    const rejected = outcomes.find((r) => !r.ok);
    if (rejected?.ok === false) {
      expect(rejected.error.code).toBe("BUSINESS_RULE");
    }
    // The critical financial assertion: the PSP was never asked to refund 1400. It was called
    // exactly once, because the loser's reservation was rejected BEFORE any PSP call.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.amountMinor).toBe(700);

    const finalIntent = await repo.findById("pi-1");
    const totalRefunded = finalIntent?.refunds
      .filter((r) => r.status !== "failed")
      .reduce((sum, r) => sum + r.amount.amountMinor, 0);
    expect(totalRefunded).toBeLessThanOrEqual(1000);
    expect(totalRefunded).toBe(700);
  });

  it("Case 2: captured=1000, concurrent 500+500 — both succeed via retry, totaling exactly 1000, TWO PSP calls", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-2", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    const [a, b] = await Promise.all([
      lifecycle.execute({ paymentIntentId: "pi-2", amountMinor: 500, currency: "USD" }),
      lifecycle.execute({ paymentIntentId: "pi-2", amountMinor: 500, currency: "USD" }),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls.map((c) => c.amountMinor).sort()).toEqual([500, 500]);
    // Two distinct reservations must never share one idempotency key.
    expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBe(2);

    const finalIntent = await repo.findById("pi-2");
    const totalRefunded = finalIntent?.refunds
      .filter((r) => r.status !== "failed")
      .reduce((sum, r) => sum + r.amount.amountMinor, 0);
    expect(totalRefunded).toBe(1000);
    expect(finalIntent?.status.value).toBe("refunded");
  });

  it("Case 3: captured=1000, concurrent 500+600 — exactly one succeeds (500), the other fails cleanly, never 1100", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-3", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    const [a, b] = await Promise.all([
      lifecycle.execute({ paymentIntentId: "pi-3", amountMinor: 500, currency: "USD" }),
      lifecycle.execute({ paymentIntentId: "pi-3", amountMinor: 600, currency: "USD" }),
    ]);

    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.filter((r) => !r.ok)).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);

    const finalIntent = await repo.findById("pi-3");
    const totalRefunded = finalIntent?.refunds
      .filter((r) => r.status !== "failed")
      .reduce((sum, r) => sum + r.amount.amountMinor, 0);
    expect(totalRefunded).toBeLessThan(1100);
    expect(totalRefunded).toBe(500);
  });

  it("Case 4: captured=1000, concurrent 1000+1000 — only one refund succeeds, one PSP call", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-4", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    const [a, b] = await Promise.all([
      lifecycle.execute({ paymentIntentId: "pi-4", amountMinor: 1000, currency: "USD" }),
      lifecycle.execute({ paymentIntentId: "pi-4", amountMinor: 1000, currency: "USD" }),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);

    const finalIntent = await repo.findById("pi-4");
    expect(finalIntent?.status.value).toBe("refunded");
  });

  it("holds even with realistic PSP latency (50ms) — the invariant is decided entirely during reservation, before any PSP call", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-5", 1000);
    const provider = new RecordingPaymentProvider(50);
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    const [a, b] = await Promise.all([
      lifecycle.execute({ paymentIntentId: "pi-5", amountMinor: 700, currency: "USD" }),
      lifecycle.execute({ paymentIntentId: "pi-5", amountMinor: 700, currency: "USD" }),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("PSP failure releases the reservation: a failed refund does not permanently lock capacity, and is not counted as refunded", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-6", 1000);
    const provider = new RecordingPaymentProvider(0, (amountMinor) => amountMinor === 700);
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    await expect(
      lifecycle.execute({ paymentIntentId: "pi-6", amountMinor: 700, currency: "USD" }),
    ).rejects.toThrow(/simulated PSP failure/);

    const afterFailure = await repo.findById("pi-6");
    expect(afterFailure?.refunds).toHaveLength(1);
    expect(afterFailure?.refunds[0]?.status).toBe("failed");
    // Capacity was released — a fresh refund for the same 700 (now succeeding) must be accepted.
    const provider2 = new RecordingPaymentProvider();
    const lifecycle2 = new RefundPaymentLifecycle(buildDeps(repo, provider2));
    const retried = await lifecycle2.execute({
      paymentIntentId: "pi-6",
      amountMinor: 700,
      currency: "USD",
    });
    expect(retried.ok).toBe(true);
    expect(provider2.calls).toHaveLength(1);
  });

  it("the PSP idempotency key is derived from the durable reservation id, not a fresh id per attempt", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-7", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    await lifecycle.execute({ paymentIntentId: "pi-7", amountMinor: 300, currency: "USD" });

    const intent = await repo.findById("pi-7");
    const refundId = intent?.refunds[0]?.id.toString();
    expect(provider.calls[0]?.idempotencyKey).toBe(`pi-7:refund:${refundId}`);
  });

  it("regression matrix: valid partial, valid full, excessive (rejected before any PSP call), unknown intent (404)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-8", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    const partial = await lifecycle.execute({
      paymentIntentId: "pi-8",
      amountMinor: 400,
      currency: "USD",
    });
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(partial.value.status).toBe("partially_refunded");

    const excessive = await lifecycle.execute({
      paymentIntentId: "pi-8",
      amountMinor: 9999,
      currency: "USD",
    });
    expect(excessive.ok).toBe(false);
    if (!excessive.ok) expect(excessive.error.code).toBe("BUSINESS_RULE");
    expect(provider.calls).toHaveLength(1); // the excessive request never reached the PSP

    const full = await lifecycle.execute({
      paymentIntentId: "pi-8",
      amountMinor: 600,
      currency: "USD",
    });
    expect(full.ok).toBe(true);
    if (full.ok) expect(full.value.status).toBe("refunded");
    expect(provider.calls).toHaveLength(2);

    const alreadyFullyRefunded = await lifecycle.execute({
      paymentIntentId: "pi-8",
      amountMinor: 1,
      currency: "USD",
    });
    expect(alreadyFullyRefunded.ok).toBe(false);

    const missing = await lifecycle.execute({
      paymentIntentId: "missing-intent",
      amountMinor: 100,
      currency: "USD",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("NOT_FOUND");
  });
});
