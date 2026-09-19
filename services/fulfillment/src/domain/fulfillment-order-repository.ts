import type { FulfillmentOrder } from "./fulfillment-order";

/** Persistence port for {@link FulfillmentOrder}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface FulfillmentOrderRepository {
  save(fulfillmentOrder: FulfillmentOrder, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<FulfillmentOrder | null>;
  /** Looks up the fulfillment order opened for a given order (Phase A.30 admin Order Detail panel). */
  findByOrderRef(
    orderRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<FulfillmentOrder | null>;
}
