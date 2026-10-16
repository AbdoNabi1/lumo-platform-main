import { staticCapabilities } from "./test-support/static-provider-resolver";
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { PaymentIntent } from "./domain/payment-intent";
import type { PaymentIntentRepository } from "./domain/payment-intent-repository";
import { PaymentMethod, PspReference } from "./domain/value-objects/payment-references";
import { RecordWebhook, type RecordWebhookDeps } from "./application/record-webhook.use-case";
import { InMemoryProcessedWebhookStore } from "./infrastructure/in-memory-port-adapters";
import { PaymentIntentMapper, type PaymentIntentRow } from "./infrastructure/payment-intent.mapper";

/**
 * Phase A.11 (Task 11 — webhook ordering). `ProcessedWebhookStore` dedups on `(provider, eventId)`
 * only. Stripe can legitimately emit two DISTINCT event ids that both map (via `KIND_TO_STATUS`) onto
 * the SAME target status a PaymentIntent has already reached through a first delivery — e.g. two
 * separate `payment_intent.payment_failed` events for two different failed attempts on one intent.
 * `PaymentStatus`'s transition table (`payment-status.ts`) has no self-transition for any status
 * ("failed" -> "failed", "authorized" -> "authorized", "cancelled" -> "cancelled" are all absent from
 * `TRANSITIONS`), so a second such webhook used to fall through to `intent.transition(toStatus, ...)`
 * and throw a domain `BusinessRuleError` instead of being treated as a safe idempotent no-op. `captured`
 * is unaffected in production composition roots (`captureSettlement` is always wired — see
 * `composition.ts` — so it never reaches the generic `transition()` call at all), but `authorized`/
 * `failed`/`cancelled`/`expired` all go through the generic path unconditionally.
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
  const pi = PaymentIntent.createIntent(
    UniqueEntityId.from(id),
    `order-${id}`,
    usd(amountMinor),
    "stripe",
  );
  pi.markProcessing("seed-1", new Date(0));
  const pspRef = PspReference.create(`psp-ref-${id}`);
  const method = PaymentMethod.create("tok_seed", "visa");
  if (!pspRef.ok || !method.ok) throw new Error("invalid fixture");
  pi.authorize(pspRef.value, method.value, amountMinor, "seed-2", new Date(0));
  pi.pullDomainEvents();
  repo.seed(pi);
}

/** `processing` (not yet authorized) — the only status `"processing" -> "failed"` is a legal transition from. */
function seedProcessingIntent(
  repo: PostgresLikePaymentIntentRepository,
  id: string,
  amountMinor: number,
): void {
  const pi = PaymentIntent.createIntent(
    UniqueEntityId.from(id),
    `order-${id}`,
    usd(amountMinor),
    "stripe",
  );
  pi.markProcessing("seed-1", new Date(0));
  pi.pullDomainEvents();
  repo.seed(pi);
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
    providers: staticCapabilities(),
    ...extra,
  };
}

describe("Task 11 — webhook-after-success: a second, distinctly-id'd webhook mapping to an already-reached status", () => {
  it("FIXED: two distinct `payment_intent.payment_failed` events (different eventId) both settle cleanly instead of the second throwing a BUSINESS_RULE error", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedProcessingIntent(repo, "pi-dup-failed", 1000);
    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo));

    const first = await recordWebhook.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-dup-failed",
      provider: "stripe",
      eventId: "evt_failed_1",
      kind: "failed",
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.status).toBe("failed");

    // A second, genuinely DISTINCT Stripe event (different eventId — e.g. a second failed attempt)
    // maps to the same "failed" kind. `ProcessedWebhookStore`'s (provider, eventId) dedup does not
    // catch this — it is a different event. Pre-fix this threw BUSINESS_RULE ("failed" -> "failed"
    // is not in the transition table); the safe/expected behavior is an idempotent no-op.
    const second = await recordWebhook.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-dup-failed",
      provider: "stripe",
      eventId: "evt_failed_2",
      kind: "failed",
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.status).toBe("failed");
      expect(second.value.duplicate).toBe(false); // genuinely a new event — recorded, just not re-transitioned
    }

    const final = await repo.findById("pi-dup-failed", "tenant-a");
    expect(final?.status.value).toBe("failed");
    // Both webhook deliveries are recorded in the append-only attempt log (audit trail preserved).
    expect(final?.attempts.filter((a) => a.kind === "webhook")).toHaveLength(2);
  });

  it("FIXED: two distinct `payment_intent.canceled` events after cancellation both settle cleanly", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-dup-cancel", 1000);
    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo));

    const first = await recordWebhook.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-dup-cancel",
      provider: "stripe",
      eventId: "evt_cancel_1",
      kind: "cancelled",
    });
    expect(first.ok).toBe(true);

    const second = await recordWebhook.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-dup-cancel",
      provider: "stripe",
      eventId: "evt_cancel_2",
      kind: "cancelled",
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe("cancelled");
  });

  it("a genuinely ILLEGAL cross-status webhook (not a same-status replay) is still correctly rejected", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedIntent(repo, "pi-illegal", 1000);
    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo));

    const cancelled = await recordWebhook.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-illegal",
      provider: "stripe",
      eventId: "evt_illegal_1",
      kind: "cancelled",
    });
    expect(cancelled.ok).toBe(true);

    // "authorized" -> "failed" is not reachable from "cancelled": cancelled only transitions to
    // "closed". This must still fail — the fix must not turn illegal transitions into silent no-ops.
    const illegal = await recordWebhook.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-illegal",
      provider: "stripe",
      eventId: "evt_illegal_2",
      kind: "failed",
    });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.code).toBe("BUSINESS_RULE");
  });
});
