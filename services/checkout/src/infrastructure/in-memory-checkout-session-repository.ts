import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";

export interface InMemoryCheckoutSessionRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `CheckoutSessionRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryCheckoutSessionRepository implements CheckoutSessionRepository {
  private readonly store = new Map<string, CheckoutSession>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryCheckoutSessionRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(session: CheckoutSession, tx?: unknown): Promise<void> {
    this.store.set(session.id.toString(), session);
    await this.outbox.write(session.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<CheckoutSession | null> {
    return this.store.get(id) ?? null;
  }
}
