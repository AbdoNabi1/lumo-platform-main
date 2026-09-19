import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";

export interface InMemoryCheckoutSessionRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `CheckoutSessionRepository`. Persists the aggregate and writes events to the outbox on save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, id)`. */
export class InMemoryCheckoutSessionRepository implements CheckoutSessionRepository {
  private readonly store = new Map<string, Map<string, CheckoutSession>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryCheckoutSessionRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(session: CheckoutSession, tenantId: string, tx?: unknown): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(session.id.toString(), session);
    await this.outbox.write(session.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<CheckoutSession | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }
}
