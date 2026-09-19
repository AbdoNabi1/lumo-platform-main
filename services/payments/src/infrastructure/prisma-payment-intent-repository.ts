import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { PaymentIntent } from "../domain/payment-intent";
import type { PaymentIntentRepository } from "../domain/payment-intent-repository";
import { PaymentIntentMapper } from "./payment-intent.mapper";

export interface PrismaPaymentIntentRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/**
 * Production `PaymentIntentRepository` on the `payments` schema. Charges/attempts are append-only
 * (`skipDuplicates`, PK = entity id — never rewritten). Refunds are append-only in identity/amount/
 * occurredAt but their `status` transitions exactly once post-creation (`pending` ->
 * `completed`|`failed`, Phase A.4 refund-concurrency remediation) — written via per-row `upsert`
 * so an existing reservation's settlement is durably visible to every subsequent reader, not
 * silently dropped by `skipDuplicates`. Optimistic locking (`version`) + same-transaction outbox
 * per ADR-0003. Only `psp_token`/`payment_method` (tokenized) are stored — card data never
 * touches this schema (G-27).
 */
export class PrismaPaymentIntentRepository implements PaymentIntentRepository {
  private readonly deps: PrismaPaymentIntentRepositoryDeps;

  constructor(deps: PrismaPaymentIntentRepositoryDeps) {
    this.deps = deps;
  }

  async save(intent: PaymentIntent, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const intentId = intent.id.toString();
    const row = PaymentIntentMapper.toIntentRow(intent, tenantId);

    if (intent.version === 0) {
      await client.paymentIntent.create({
        data: { ...row, paymentMethod: row.paymentMethod },
      });
    } else {
      const updated = await client.paymentIntent.updateMany({
        where: { id: intentId, tenantId, version: intent.version },
        data: {
          status: row.status,
          pspReference: row.pspReference,
          paymentMethod: row.paymentMethod,
          authorizedAmountMinor: row.authorizedAmountMinor,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `PaymentIntent ${intentId} was modified concurrently (expected version ${intent.version})`,
        );
      }
    }
    const charges = PaymentIntentMapper.toChargeRows(intent, tenantId);
    if (charges.length > 0) {
      await client.charge.createMany({ data: charges, skipDuplicates: true });
    }
    const refunds = PaymentIntentMapper.toRefundRows(intent, tenantId);
    for (const refund of refunds) {
      await client.refund.upsert({
        where: { id: refund.id },
        create: refund,
        update: { status: refund.status },
      });
    }
    const attempts = PaymentIntentMapper.toAttemptRows(intent, tenantId);
    if (attempts.length > 0) {
      await client.paymentAttempt.createMany({ data: attempts, skipDuplicates: true });
    }

    await this.deps.outbox.write(
      intent.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<PaymentIntent | null> {
    return this.findOne({ id, tenantId }, tenantId, tx);
  }

  /** Scaffolding for A3's saga-activity idempotency (Sprint A0 precondition); not yet called by any use case. */
  async findByIdempotencyKey(
    idempotencyKey: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<PaymentIntent | null> {
    return this.findOne({ idempotencyKey, tenantId }, tenantId, tx);
  }

  /** Phase A.10 (Tasks 4-6): correlates a PSP webhook's own reference (e.g. Stripe's `pi_...` id) to our domain intent. */
  async findByPspReference(
    pspReference: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<PaymentIntent | null> {
    return this.findOne({ pspReference, tenantId }, tenantId, tx);
  }

  /** Shared lookup — every caller's `where` already carries `tenantId`; reads run via `runReadScoped` unless the caller supplied its `tx`. */
  private async findOne(
    where: { readonly tenantId: string } & Record<string, string>,
    tenantId: string,
    tx: unknown,
  ): Promise<PaymentIntent | null> {
    const run = (client: TransactionClient) =>
      client.paymentIntent.findFirst({
        where,
        include: {
          charges: { orderBy: { occurredAt: "asc" } },
          refunds: { orderBy: { occurredAt: "asc" } },
          attempts: { orderBy: { occurredAt: "asc" } },
        },
      });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    if (row === null) return null;
    return PaymentIntentMapper.toDomain(
      { ...row, paymentMethod: row.paymentMethod as { token: string; brand?: string } },
      row.charges,
      row.refunds,
      row.attempts,
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaPaymentIntentRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
