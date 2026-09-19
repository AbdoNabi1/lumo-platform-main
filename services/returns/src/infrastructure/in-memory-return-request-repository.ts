import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { ReturnRequest } from "../domain/return-request";
import type { ReturnRequestRepository } from "../domain/return-request-repository";

export interface InMemoryReturnRequestRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ReturnRequestRepository`. Persists the aggregate and writes events to the outbox on save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, id)`. */
export class InMemoryReturnRequestRepository implements ReturnRequestRepository {
  private readonly store = new Map<string, Map<string, ReturnRequest>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryReturnRequestRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(returnRequest: ReturnRequest, tenantId: string, tx?: unknown): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(returnRequest.id.toString(), returnRequest);
    await this.outbox.write(returnRequest.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<ReturnRequest | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  async findByOrderRef(orderRef: string, tenantId: string): Promise<ReturnRequest | null> {
    for (const returnRequest of this.store.get(tenantId)?.values() ?? []) {
      if (returnRequest.orderRef === orderRef) {
        return returnRequest;
      }
    }
    return null;
  }
}
