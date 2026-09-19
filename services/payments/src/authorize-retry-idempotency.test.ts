import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { PaymentIntent } from "./domain/payment-intent";
import type { PaymentIntentRepository } from "./domain/payment-intent-repository";
import {
  AuthorizePayment,
  type PaymentLifecycleDeps,
} from "./application/payment-lifecycle.use-cases";
import { PaymentIntentMapper, type PaymentIntentRow } from "./infrastructure/payment-intent.mapper";

/**
 * Phase A.11 (Task 1/14) — `AuthorizePayment` is the ONLY Payments HTTP mutation route that carries
 * NO idempotency protection of its own at the domain/use-case level (unlike capture's deterministic
 * `<intentId>:capture` PSP key + `alreadyCaptured` resume, and refund's caller-supplied
 * `idempotencyKey` + `alreadyCompleted` resume). It relies ENTIRELY on the generic HTTP-transport
 * `idempotent: true` response-replay cache (`packages/http/src/server.ts`) — which itself only
 * activates when the client actually SENDS an `Idempotency-Key` header (silently skipped if absent,
 * `server.ts`'s `idempotencyKey !== null` guard) and is keyed only on `(tenantId, idempotencyKey)`,
 * not on the target resource. A retry that reaches the domain twice for the same already-authorized
 * intent — missing header, expired/evicted cache entry, or simply a second admin action — used to
 * throw an uncaught `BusinessRuleError` ("authorized" has no self-transition in `TRANSITIONS`,
 * `payment-status.ts`) instead of being a safe idempotent no-op, exactly the same shape as the
 * `RecordWebhook` defect this phase already fixed (`webhook-ordering-idempotency.test.ts`).
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

function seedProcessingIntent(
  repo: PostgresLikePaymentIntentRepository,
  id: string,
  amountMinor: number,
): void {
  const pi = PaymentIntent.createIntent(UniqueEntityId.from(id), `order-${id}`, usd(amountMinor));
  pi.markProcessing("seed-1", new Date(0));
  pi.pullDomainEvents();
  repo.seed(pi);
}

function buildDeps(repo: PostgresLikePaymentIntentRepository): PaymentLifecycleDeps {
  return {
    intents: repo,
    unitOfWork: new PassthroughUnitOfWork(),
    idGenerator: sequentialIds("evt"),
    clock,
    // Not used by AuthorizePayment; provided to satisfy the shared deps shape.
    paymentProvider: {
      createIntent: () => {
        throw new Error("not used");
      },
      capture: async () => {},
      cancel: async () => {},
      refund: async () => {},
      verifyWebhook: async () => true,
    },
  };
}

describe("Task 1/14 — AuthorizePayment retried for an already-authorized intent", () => {
  it("FIXED: an identical retry (same pspReference/method/amount) is a safe idempotent no-op, not a thrown BusinessRuleError", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedProcessingIntent(repo, "pi-auth-retry", 1000);
    const lifecycle = new AuthorizePayment(buildDeps(repo));

    const input = {
      tenantId: "tenant-a",
      paymentIntentId: "pi-auth-retry",
      pspReference: "psp-ref-1",
      paymentMethodToken: "tok_abc",
      paymentMethodBrand: "visa",
      authorizedAmountMinor: 1000,
    };

    const first = await lifecycle.execute(input);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.status).toBe("authorized");

    // A retry with no idempotency-key protection reaching the domain a second time — missing HTTP
    // header, expired transport cache entry, or a second admin action.
    const second = await lifecycle.execute(input);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe("authorized");

    const final = await repo.findById("pi-auth-retry", "tenant-a");
    expect(final?.status.value).toBe("authorized");
    // No duplicate authorize attempt recorded — the second call was a pure no-op read, not a second write.
    expect(final?.attempts.filter((a) => a.kind === "authorize")).toHaveLength(1);
  });

  it("a conflicting retry (different pspReference on an already-authorized intent) is still correctly rejected, not silently accepted", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedProcessingIntent(repo, "pi-auth-conflict", 1000);
    const lifecycle = new AuthorizePayment(buildDeps(repo));

    const first = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-auth-conflict",
      pspReference: "psp-ref-A",
      paymentMethodToken: "tok_abc",
      paymentMethodBrand: "visa",
      authorizedAmountMinor: 1000,
    });
    expect(first.ok).toBe(true);

    const conflicting = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-auth-conflict",
      pspReference: "psp-ref-B", // different PSP reference — not the same logical retry
      paymentMethodToken: "tok_abc",
      paymentMethodBrand: "visa",
      authorizedAmountMinor: 1000,
    });
    expect(conflicting.ok).toBe(false);
    if (!conflicting.ok) expect(conflicting.error.code).toBe("BUSINESS_RULE");

    const final = await repo.findById("pi-auth-conflict", "tenant-a");
    expect(final?.pspReference?.value).toBe("psp-ref-A"); // untouched by the rejected conflicting call
  });

  it("a genuinely illegal transition (e.g. re-authorizing a captured intent) is still correctly rejected", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedProcessingIntent(repo, "pi-auth-captured", 1000);
    const lifecycle = new AuthorizePayment(buildDeps(repo));

    const authorized = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-auth-captured",
      pspReference: "psp-ref-1",
      paymentMethodToken: "tok_abc",
      authorizedAmountMinor: 1000,
    });
    expect(authorized.ok).toBe(true);

    const intent = await repo.findById("pi-auth-captured", "tenant-a");
    if (intent === null) throw new Error("fixture missing");
    intent.requestCapture("evt-cap-req", new Date(0));
    intent.markCaptured("evt-cap", new Date(0));
    await repo.save(intent, "tenant-a");

    const reAuthorize = await lifecycle.execute({
      tenantId: "tenant-a",
      paymentIntentId: "pi-auth-captured",
      pspReference: "psp-ref-1",
      paymentMethodToken: "tok_abc",
      authorizedAmountMinor: 1000,
    });
    expect(reAuthorize.ok).toBe(false);
    if (!reAuthorize.ok) expect(reAuthorize.error.code).toBe("BUSINESS_RULE");
  });
});
