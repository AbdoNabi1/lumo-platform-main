import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Shipment } from "../domain/shipment";
import type { ShipmentRepository } from "../domain/shipment-repository";

export interface InMemoryShipmentRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ShipmentRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryShipmentRepository implements ShipmentRepository {
  private readonly store = new Map<string, Shipment>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryShipmentRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(shipment: Shipment, tx?: unknown): Promise<void> {
    this.store.set(shipment.id.toString(), shipment);
    await this.outbox.write(shipment.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Shipment | null> {
    return this.store.get(id) ?? null;
  }

  /**
   * Scaffolding for retry-safe saga-activity idempotency (Sprint A0 precondition); not yet called
   * by any use case. Always returns `null` — the domain aggregate carries no `idempotencyKey`
   * field yet, so there is nothing to match against (mirrors the Prisma adapter's always-NULL
   * column today).
   */
  async findByIdempotencyKey(_idempotencyKey: string): Promise<Shipment | null> {
    return null;
  }

  async findByFulfillmentRef(fulfillmentRef: string): Promise<Shipment | null> {
    for (const shipment of this.store.values()) {
      if (shipment.fulfillmentRef === fulfillmentRef) {
        return shipment;
      }
    }
    return null;
  }
}
