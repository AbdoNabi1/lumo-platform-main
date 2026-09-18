import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Shipment } from "../domain/shipment";
import type { ShipmentRepository } from "../domain/shipment-repository";

/** ADR-0014 (WP-10, T10.3): per-tenant bucket, so every store is keyed by `(tenantId, id)`. */
function bucketFor<T>(store: Map<string, Map<string, T>>, tenantId: string): Map<string, T> {
  let bucket = store.get(tenantId);
  if (bucket === undefined) {
    bucket = new Map();
    store.set(tenantId, bucket);
  }
  return bucket;
}

export interface InMemoryShipmentRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ShipmentRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryShipmentRepository implements ShipmentRepository {
  private readonly store = new Map<string, Map<string, Shipment>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryShipmentRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(shipment: Shipment, tenantId: string, tx?: unknown): Promise<void> {
    bucketFor(this.store, tenantId).set(shipment.id.toString(), shipment);
    await this.outbox.write(shipment.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Shipment | null> {
    return bucketFor(this.store, tenantId).get(id) ?? null;
  }

  /**
   * Scaffolding for retry-safe saga-activity idempotency (Sprint A0 precondition); not yet called
   * by any use case. Always returns `null` — the domain aggregate carries no `idempotencyKey`
   * field yet, so there is nothing to match against (mirrors the Prisma adapter's always-NULL
   * column today).
   */
  async findByIdempotencyKey(_idempotencyKey: string, _tenantId: string): Promise<Shipment | null> {
    return null;
  }

  async findByFulfillmentRef(fulfillmentRef: string, tenantId: string): Promise<Shipment | null> {
    for (const shipment of bucketFor(this.store, tenantId).values()) {
      if (shipment.fulfillmentRef === fulfillmentRef) {
        return shipment;
      }
    }
    return null;
  }
}
