import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { FulfillmentOrder } from "../domain/fulfillment-order";
import type { FulfillmentOrderRepository } from "../domain/fulfillment-order-repository";

export interface InMemoryFulfillmentOrderRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `FulfillmentOrderRepository`. Persists the aggregate and writes events to the outbox on save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, id)`. */
export class InMemoryFulfillmentOrderRepository implements FulfillmentOrderRepository {
  private readonly store = new Map<string, Map<string, FulfillmentOrder>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryFulfillmentOrderRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(fulfillmentOrder: FulfillmentOrder, tenantId: string, tx?: unknown): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(fulfillmentOrder.id.toString(), fulfillmentOrder);
    await this.outbox.write(fulfillmentOrder.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<FulfillmentOrder | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  async findByOrderRef(orderRef: string, tenantId: string): Promise<FulfillmentOrder | null> {
    for (const fulfillmentOrder of this.store.get(tenantId)?.values() ?? []) {
      if (fulfillmentOrder.orderRef === orderRef) {
        return fulfillmentOrder;
      }
    }
    return null;
  }
}
