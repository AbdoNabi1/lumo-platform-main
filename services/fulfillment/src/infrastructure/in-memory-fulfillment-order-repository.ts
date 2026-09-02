import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { FulfillmentOrder } from "../domain/fulfillment-order";
import type { FulfillmentOrderRepository } from "../domain/fulfillment-order-repository";

export interface InMemoryFulfillmentOrderRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `FulfillmentOrderRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryFulfillmentOrderRepository implements FulfillmentOrderRepository {
  private readonly store = new Map<string, FulfillmentOrder>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryFulfillmentOrderRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(fulfillmentOrder: FulfillmentOrder, tx?: unknown): Promise<void> {
    this.store.set(fulfillmentOrder.id.toString(), fulfillmentOrder);
    await this.outbox.write(fulfillmentOrder.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<FulfillmentOrder | null> {
    return this.store.get(id) ?? null;
  }

  async findByOrderRef(orderRef: string): Promise<FulfillmentOrder | null> {
    for (const fulfillmentOrder of this.store.values()) {
      if (fulfillmentOrder.orderRef === orderRef) {
        return fulfillmentOrder;
      }
    }
    return null;
  }
}
