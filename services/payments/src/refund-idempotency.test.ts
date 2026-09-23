import { describe, expect, it } from "vitest";
import { staticProviders } from "./test-support/static-provider-resolver";
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
 * Phase A.5 (refund-idempotency & crash-retry security closure). Same fake shape as
 * `refund-concurrency.test.ts` (Phase A.4) — round-trips every read/write through
 * `PaymentIntentMapper` so `findById` returns an independent snapshot per call and `save`
 * reproduces Postgres's `UPDATE ... WHERE id = ? AND version = ?` optimistic-lock contract exactly
 * (a write whose `version` no longer matches throws `ConcurrencyError`). Duplicated rather than
 * imported because the A4 test file does not export its fakes — same convention already used by
 * that file itself (self-contained fixtures per test file).
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

/**
 * Records every PSP refund call; optionally fails for a given amount (simulates a PSP-side
 * rejection). Also models the actual guarantee a real idempotency-key-aware PSP (e.g. Stripe)
 * provides: a SECOND call presenting an idempotency key it has already seen does not move money a
 * second time — it replays the cached outcome of the first. `calls` records every physical
 * invocation (useful for asserting what identity was PRESENTED); `realEffects` counts only the
 * FIRST occurrence of each distinct idempotency key (the actual number of times money moved) — the
 * distinction Task 7 (PSP Semantics) requires: this codebase cannot make the network call itself
 * exactly-once, only make every retry present the SAME identity so the PSP's own dedup applies.
 */
class RecordingPaymentProvider implements PaymentProvider {
  readonly calls: Array<{ providerIntentId: string; amountMinor: number; idempotencyKey: string }> =
    [];
  private readonly seenKeys = new Set<string>();
  realEffects = 0;
  constructor(private readonly failFor?: (amountMinor: number) => boolean) {}

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
    this.calls.push({ providerIntentId, amountMinor, idempotencyKey });
    if (this.seenKeys.has(idempotencyKey)) {
      return; // real-PSP dedup: replays the original outcome, does not move money again
    }
    this.seenKeys.add(idempotencyKey);
    this.realEffects += 1;
    if (this.failFor?.(amountMinor) === true) {
      throw new Error("simulated PSP failure");
    }
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

function seedCapturedIntent(
  repo: PostgresLikePaymentIntentRepository,
  id: string,
  capturedAmountMinor: number,
): void {
  const pi = PaymentIntent.createIntent(
    UniqueEntityId.from(id),
    `order-${id}`,
    usd(capturedAmountMinor),
    "stripe",
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
    providers: staticProviders(paymentProvider),
  };
}

describe("Task 2 — exploit proof: without idempotencyKey, a full-request retry mints a second PSP identity", () => {
  it("two retries of the SAME logical refund (no idempotencyKey — pre-A.5 caller shape) get TWO different PSP idempotency keys and TWO PSP calls", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-exploit", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    // Simulates Returns' PrismaPaymentsPortAdapter BEFORE the Phase A.5 fix: it received a stable
    // key from Returns but never passed it to RefundPaymentLifecycleInput, so every retry of the
    // whole `requestRefund()` call reached here with no idempotencyKey at all.
    const first = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-exploit",
      amountMinor: 300,
      currency: "USD",
    });
    const second = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-exploit",
      amountMinor: 300,
      currency: "USD",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // The vulnerability: two calls the caller intended as "the same logical refund, retried" were
    // treated as two independent refunds — two PSP calls, two distinct idempotency identities, and
    // (if capacity allows, as it does here: 1000 - 300 - 300 = 400 remaining) TWO real refunds.
    expect(provider.calls).toHaveLength(2);
    expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBe(2);

    const finalIntent = await repo.findById("pi-exploit", "tenant-a");
    const totalRefunded = finalIntent?.refunds
      .filter((r) => r.status !== "failed")
      .reduce((sum, r) => sum + r.amount.amountMinor, 0);
    expect(totalRefunded).toBe(600); // 300 + 300 — a real double-refund of what was meant to be one request
  });
});

describe("Task 8/13/14 — Phase A.5 fix: idempotencyKey makes a full-request retry safe", () => {
  it("same idempotencyKey on retry → same PSP idempotency key, only ONE PSP call (Scenario B: response lost, caller retries)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-retry-1", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));
    const idempotencyKey = "return-1:refund";

    const first = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-retry-1",
      amountMinor: 300,
      currency: "USD",
      idempotencyKey,
    });
    expect(first.ok).toBe(true);

    // Second attempt: caller believes the first may have been lost (timeout) and retries with the
    // SAME idempotencyKey. The first attempt actually already completed — this must be a safe no-op.
    const second = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-retry-1",
      amountMinor: 300,
      currency: "USD",
      idempotencyKey,
    });
    expect(second.ok).toBe(true);

    // Only ONE PSP call was ever made — the retry was recognized as the same logical refund and
    // short-circuited domain-side (the reservation was already `completed`) before reaching the PSP.
    expect(provider.calls).toHaveLength(1);

    const finalIntent = await repo.findById("pi-retry-1", "tenant-a");
    const totalRefunded = finalIntent?.refunds
      .filter((r) => r.status !== "failed")
      .reduce((sum, r) => sum + r.amount.amountMinor, 0);
    expect(totalRefunded).toBe(300); // NOT 600 — the fix actually prevents the double-refund Task 2 proved
    expect(finalIntent?.refunds).toHaveLength(1);
  });

  it("Scenario A: crash between PSP success and settle-commit — retry with the same key resumes the SAME pending reservation and calls the PSP with the SAME idempotency identity", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-crash-a", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));
    const idempotencyKey = "return-crash-a:refund";

    // Simulated crash: reserve() commits `pending`, the PSP call happens (RecordingPaymentProvider
    // never throws here), but we stop BEFORE `settle()` — modeling a process crash after step 2
    // succeeded but before step 3's commit lands. Labeled simulation per Task 13: this is an
    // in-process state model of the crash window, not a real distributed-process kill.
    const intentBeforeCrash = await repo.findById("pi-crash-a", "tenant-a");
    if (intentBeforeCrash === null) throw new Error("fixture missing");
    const { refund } = intentBeforeCrash.requestRefund(
      usd(400),
      "evt-manual-1",
      clock.now(),
      idempotencyKey,
    );
    await repo.save(intentBeforeCrash, "tenant-a");
    await provider.refund(`psp-ref-pi-crash-a`, 400, `pi-crash-a:refund:${refund.id.toString()}`);
    // ^ PSP call succeeded for real; the process "crashes" here — settle() never ran, refund stays `pending`.

    const afterCrash = await repo.findById("pi-crash-a", "tenant-a");
    expect(afterCrash?.refunds[0]?.status).toBe("pending");
    expect(provider.calls).toHaveLength(1);

    // The caller retries the WHOLE request with the same idempotencyKey.
    const retried = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-crash-a",
      amountMinor: 400,
      currency: "USD",
      idempotencyKey,
    });
    expect(retried.ok).toBe(true);

    // The retry resumed the SAME reservation (same refund id) and therefore presented the PSP the
    // SAME idempotency key as the original (pre-crash) call — exactly what lets a real PSP
    // recognize it as a duplicate and no-op instead of moving money twice.
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.idempotencyKey).toBe(provider.calls[1]?.idempotencyKey);
    expect(provider.calls[1]?.idempotencyKey).toBe(`pi-crash-a:refund:${refund.id.toString()}`);

    const finalIntent = await repo.findById("pi-crash-a", "tenant-a");
    expect(finalIntent?.refunds).toHaveLength(1); // still ONE logical refund, not two
    expect(finalIntent?.refunds[0]?.status).toBe("completed");
  });

  it("reusing a key after the PSP call definitively failed is rejected — caller must mint a new key for a genuinely new attempt (Scenario C)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-failed-retry", 1000);
    const provider = new RecordingPaymentProvider((amountMinor) => amountMinor === 300);
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));
    const idempotencyKey = "return-fail:refund";

    await expect(
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-failed-retry",
        amountMinor: 300,
        currency: "USD",
        idempotencyKey,
      }),
    ).rejects.toThrow(/simulated PSP failure/);

    const afterFailure = await repo.findById("pi-failed-retry", "tenant-a");
    expect(afterFailure?.refunds[0]?.status).toBe("failed");

    // Reusing the SAME key is rejected outright — not silently retried, not silently ignored.
    const provider2 = new RecordingPaymentProvider();
    const lifecycle2 = new RefundPaymentLifecycle(buildDeps(repo, provider2));
    const reused = await lifecycle2.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-failed-retry",
      amountMinor: 300,
      currency: "USD",
      idempotencyKey,
    });
    expect(reused.ok).toBe(false);
    if (!reused.ok) expect(reused.error.code).toBe("BUSINESS_RULE");
    expect(provider2.calls).toHaveLength(0); // rejected before ever reaching the PSP

    // A genuinely NEW key is a legitimate new attempt and succeeds.
    const freshAttempt = await lifecycle2.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-failed-retry",
      amountMinor: 300,
      currency: "USD",
      idempotencyKey: "return-fail:refund:attempt-2",
    });
    expect(freshAttempt.ok).toBe(true);
    expect(provider2.calls).toHaveLength(1);
  });

  it("reusing a key with a DIFFERENT amount is rejected (Task 11 — tamper protection: the identity must always describe the same money movement)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-tamper", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));
    const idempotencyKey = "return-tamper:refund";

    const first = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-tamper",
      amountMinor: 300,
      currency: "USD",
      idempotencyKey,
    });
    expect(first.ok).toBe(true);

    const tampered = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-tamper",
      amountMinor: 999,
      currency: "USD",
      idempotencyKey, // same key, different amount — must not silently refund 999 under the "300" identity
    });
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) expect(tampered.error.code).toBe("BUSINESS_RULE");
    expect(provider.calls).toHaveLength(1); // the tampered retry never reached the PSP
  });

  it("two different logical refunds (different idempotencyKeys) never share a PSP identity, even concurrently (Scenario D)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-distinct", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    const [a, b] = await Promise.all([
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-distinct",
        amountMinor: 400,
        currency: "USD",
        idempotencyKey: "return-a:refund",
      }),
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-distinct",
        amountMinor: 400,
        currency: "USD",
        idempotencyKey: "return-b:refund",
      }),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(provider.calls).toHaveLength(2);
    expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBe(2);

    const finalIntent = await repo.findById("pi-distinct", "tenant-a");
    expect(
      finalIntent?.refunds
        .filter((r) => r.status !== "failed")
        .reduce((s, r) => s + r.amount.amountMinor, 0),
    ).toBe(800);
  });

  it("concurrent retries of the SAME logical refund (same idempotencyKey, racing) collapse into exactly ONE reservation and ONE PSP call — both callers observe success", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-concurrent-same", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));
    const idempotencyKey = "return-concurrent:refund";

    const [a, b] = await Promise.all([
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-concurrent-same",
        amountMinor: 500,
        currency: "USD",
        idempotencyKey,
      }),
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-concurrent-same",
        amountMinor: 500,
        currency: "USD",
        idempotencyKey,
      }),
    ]);

    // Both requests describe the SAME logical refund under the SAME key — the loser's optimistic-
    // lock conflict (the exact A4 mechanism) forces a re-read that finds the winner's reservation
    // and resumes it instead of failing, so both callers see success, not a spurious 409. The loser
    // may still physically call the PSP again (an ambiguous "pending" resume calls the PSP with the
    // SAME key rather than guessing whether the first call landed — Scenario B) but every call
    // presents the SAME idempotency key, so a real PSP's own dedup means money moved only ONCE.
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBe(1);
    expect(provider.realEffects).toBe(1);

    const finalIntent = await repo.findById("pi-concurrent-same", "tenant-a");
    expect(finalIntent?.refunds).toHaveLength(1);
    expect(
      finalIntent?.refunds
        .filter((r) => r.status !== "failed")
        .reduce((s, r) => s + r.amount.amountMinor, 0),
    ).toBe(500); // NOT 1000 — a naive implementation would double-refund this
  });

  it("omitting idempotencyKey entirely preserves pre-A.5 behavior — additive, not a breaking change", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-no-key", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    const result = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-no-key",
      amountMinor: 250,
      currency: "USD",
    });
    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });
});

describe("Task 14 — A4 concurrency regression, unaffected by the A.5 idempotency change", () => {
  it("captured=1000, concurrent 700+700 (no idempotencyKey) — still only ONE PSP refund", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-a4-1", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    const [a, b] = await Promise.all([
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-a4-1",
        amountMinor: 700,
        currency: "USD",
      }),
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-a4-1",
        amountMinor: 700,
        currency: "USD",
      }),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("captured=1000, concurrent 500+500 (no idempotencyKey) — both succeed, TWO PSP calls, totaling 1000", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-a4-2", 1000);
    const provider = new RecordingPaymentProvider();
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    const [a, b] = await Promise.all([
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-a4-2",
        amountMinor: 500,
        currency: "USD",
      }),
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-a4-2",
        amountMinor: 500,
        currency: "USD",
      }),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(provider.calls).toHaveLength(2);
    const finalIntent = await repo.findById("pi-a4-2", "tenant-a");
    expect(finalIntent?.status.value).toBe("refunded");
  });

  it("PSP failure still releases the reservation (capacity is not permanently locked)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedCapturedIntent(repo, "pi-a4-3", 1000);
    const provider = new RecordingPaymentProvider((amountMinor) => amountMinor === 700);
    const lifecycle = new RefundPaymentLifecycle(buildDeps(repo, provider));

    await expect(
      lifecycle.execute({
        tenantId: "tenant-a",
        paymentIntentId: "pi-a4-3",
        amountMinor: 700,
        currency: "USD",
      }),
    ).rejects.toThrow(/simulated PSP failure/);

    const provider2 = new RecordingPaymentProvider();
    const lifecycle2 = new RefundPaymentLifecycle(buildDeps(repo, provider2));
    const retried = await lifecycle2.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-a4-3",
      amountMinor: 700,
      currency: "USD",
    });
    expect(retried.ok).toBe(true);
  });
});
