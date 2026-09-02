import type { Shipment } from "./shipment";

/** Persistence port for {@link Shipment}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface ShipmentRepository {
  save(shipment: Shipment, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Shipment | null>;
  /**
   * Looks up a shipment by its caller-supplied idempotency key — scaffolding for retry-safe
   * saga-activity idempotency (Sprint A0 precondition, reintroduced per this milestone's own
   * additive migration rather than editing the frozen A0 migration file). Returns `null` today for
   * every key: the domain aggregate carries no such field yet, so nothing writes the column this
   * queries.
   */
  findByIdempotencyKey(idempotencyKey: string, tx?: unknown): Promise<Shipment | null>;
  /** Looks up the shipment created for a given fulfillment order (Phase A.30 admin Order Detail panel). */
  findByFulfillmentRef(fulfillmentRef: string, tx?: unknown): Promise<Shipment | null>;
}
