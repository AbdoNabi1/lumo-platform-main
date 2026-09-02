import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { ReturnRequest } from "../domain/return-request";
import type { ReturnRequestRepository } from "../domain/return-request-repository";

export interface InMemoryReturnRequestRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ReturnRequestRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryReturnRequestRepository implements ReturnRequestRepository {
  private readonly store = new Map<string, ReturnRequest>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryReturnRequestRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(returnRequest: ReturnRequest, tx?: unknown): Promise<void> {
    this.store.set(returnRequest.id.toString(), returnRequest);
    await this.outbox.write(returnRequest.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<ReturnRequest | null> {
    return this.store.get(id) ?? null;
  }

  async findByOrderRef(orderRef: string): Promise<ReturnRequest | null> {
    for (const returnRequest of this.store.values()) {
      if (returnRequest.orderRef === orderRef) {
        return returnRequest;
      }
    }
    return null;
  }
}
