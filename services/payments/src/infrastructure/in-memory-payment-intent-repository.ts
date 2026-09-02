import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { PaymentIntent } from "../domain/payment-intent";
import type { PaymentIntentRepository } from "../domain/payment-intent-repository";

export interface InMemoryPaymentIntentRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `PaymentIntentRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryPaymentIntentRepository implements PaymentIntentRepository {
  private readonly store = new Map<string, PaymentIntent>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPaymentIntentRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(intent: PaymentIntent, tx?: unknown): Promise<void> {
    this.store.set(intent.id.toString(), intent);
    await this.outbox.write(intent.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<PaymentIntent | null> {
    return this.store.get(id) ?? null;
  }

  /**
   * Scaffolding for A3's saga-activity idempotency (Sprint A0 precondition); not yet called by any
   * use case. Always returns `null` — the domain aggregate carries no `idempotencyKey` field yet,
   * so there is nothing to match against (mirrors the Prisma adapter's always-NULL column today).
   */
  async findByIdempotencyKey(_idempotencyKey: string): Promise<PaymentIntent | null> {
    return null;
  }

  /** Phase A.10 (Tasks 4-6): mirrors `PrismaPaymentIntentRepository.findByPspReference`. */
  async findByPspReference(pspReference: string): Promise<PaymentIntent | null> {
    for (const intent of this.store.values()) {
      if (intent.pspReference?.value === pspReference) return intent;
    }
    return null;
  }
}
