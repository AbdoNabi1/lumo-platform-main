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
 * Phase A.10 (Tasks 4-6). Proves the identifier a real Stripe webhook carries
 * (`data.object.id`, e.g. `pi_3Nx0aB2eZvKYlo2C1aBcDeFg` — Stripe's OWN PaymentIntent id) is NEVER
 * our internally-generated domain id (a UUIDv7 minted by `IdGenerator`), and only ever lands on our
 * aggregate as `pspReference` (set by `AuthorizePayment`, a caller-supplied field distinct from
 * `id`). Same fake shape as the other Phase A.4/A.8/A.9 suites — round-trips through
 * `PaymentIntentMapper` so `findById`/`findByPspReference` behave like the real Postgres repository.
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

/**
 * A realistic Stripe-authorized intent: `pspReference` is a genuine Stripe-shaped id
 * (`pi_...`), completely unrelated in format/value to our own domain UUID (`domainId`) — exactly
 * what `AuthorizePayment` records in production once an admin/backend flow presents Stripe's own
 * reference back to us.
 */
function seedAuthorizedStripeIntent(
  repo: PostgresLikePaymentIntentRepository,
  domainId: string,
  stripePaymentIntentId: string,
  amountMinor: number,
): void {
  const pi = PaymentIntent.createIntent(
    UniqueEntityId.from(domainId),
    `order-${domainId}`,
    usd(amountMinor),
  );
  pi.markProcessing("seed-1", new Date(0));
  const pspRef = PspReference.create(stripePaymentIntentId);
  const method = PaymentMethod.create("tok_seed", "visa");
  if (!pspRef.ok || !method.ok) throw new Error("invalid fixture");
  pi.authorize(pspRef.value, method.value, amountMinor, "seed-2", new Date(0));
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
    ...extra,
  };
}

describe("Tasks 4-6 — Stripe webhook identifier correlation (Phase A.10)", () => {
  it("EXPLOIT (pre-fix): a webhook carrying Stripe's OWN PaymentIntent id (never our domain id) now correlates and reconciles correctly", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    const domainId = "018f2e6a-27b6-7000-8000-000000000001"; // our own UUIDv7-shaped id
    const stripeId = "pi_3Nx0aB2eZvKYlo2C1aBcDeFg"; // Stripe's real id shape — never equal to domainId
    seedAuthorizedStripeIntent(repo, domainId, stripeId, 1000);

    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo));

    // This is exactly what `payments-webhook-routes.ts` sends: `paymentIntentId: body.data.object.id`
    // — Stripe's own reference, NOT the domain id.
    // `authorized` (not `cancelled`) would collide with the unrelated, pre-existing fact that this
    // codebase's transition table has no `authorized -> authorized` self-transition (Phase A.8's
    // "bonus finding") — irrelevant to identifier correlation, so this test uses `cancelled`
    // (a legal `authorized -> cancelled` edge) to isolate the ONE thing under test here.
    const result = await recordWebhook.execute({
      paymentIntentId: stripeId,
      provider: "stripe",
      eventId: "evt_canceled_1",
      kind: "cancelled",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The response must name OUR domain id, not echo Stripe's reference back — every other
      // Payments endpoint (`GET /payment-intents/:id`, capture, refund) addresses intents by domain
      // id, so a caller correlating this webhook's response against those must see the same id.
      expect(result.value.paymentIntentId).toBe(domainId);
      expect(result.value.status).toBe("cancelled");
    }

    const final = await repo.findById(domainId);
    expect(final?.status.value).toBe("cancelled");
    expect(final?.attempts.some((a) => a.kind === "webhook")).toBe(true);
  });

  it("an unknown PSP reference (no matching intent) fails closed with NotFound, never mutating an unrelated record", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    seedAuthorizedStripeIntent(repo, "018f2e6a-27b6-7000-8000-000000000002", "pi_known", 500);

    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo));
    const result = await recordWebhook.execute({
      paymentIntentId: "pi_totally_unknown",
      provider: "stripe",
      eventId: "evt_unknown_1",
      kind: "cancelled",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");

    // The unrelated, actually-known intent must be completely untouched.
    const untouched = await repo.findById("018f2e6a-27b6-7000-8000-000000000002");
    expect(untouched?.status.value).toBe("authorized");
    expect(untouched?.attempts.some((a) => a.kind === "webhook")).toBe(false);
  });

  it("a caller that already knows the domain id (e.g. this repo's own pre-A.10 test fixtures) is unaffected — findById still resolves first", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    const domainId = "018f2e6a-27b6-7000-8000-000000000003";
    seedAuthorizedStripeIntent(repo, domainId, "pi_side_channel", 750);

    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo));
    const result = await recordWebhook.execute({
      paymentIntentId: domainId, // domain id, not the PSP reference
      provider: "stripe",
      eventId: "evt_domain_id_1",
      kind: "cancelled",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.paymentIntentId).toBe(domainId);
  });

  it("duplicate delivery of the same event, addressed by Stripe's own reference, is idempotent (no second transition)", async () => {
    const repo = new PostgresLikePaymentIntentRepository();
    const domainId = "018f2e6a-27b6-7000-8000-000000000004";
    const stripeId = "pi_dup_channel";
    seedAuthorizedStripeIntent(repo, domainId, stripeId, 900);

    const recordWebhook = new RecordWebhook(buildWebhookDeps(repo));
    const input = {
      paymentIntentId: stripeId,
      provider: "stripe",
      eventId: "evt_dup_channel_1",
      kind: "cancelled" as const,
    };
    const first = await recordWebhook.execute(input);
    const second = await recordWebhook.execute(input);

    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.duplicate).toBe(false);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.duplicate).toBe(true);
      expect(second.value.paymentIntentId).toBe(domainId);
    }
  });
});
