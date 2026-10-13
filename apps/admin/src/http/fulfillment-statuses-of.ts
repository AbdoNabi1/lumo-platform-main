import type { FulfillmentOrder } from "@platform/fulfillment";
import type { OrderFulfillmentStatus } from "@platform/orders";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { deriveFulfillmentStatus } from "./order-fulfillment-status";

/**
 * The Shopify-style fulfillment status of each order on a page, from ONE batched read of the
 * Fulfillment context (never a call per order). An order with no fulfillment order is "unfulfilled".
 * A failed read is returned as the response: a list that silently showed every order "unfulfilled"
 * would be wrong, not just incomplete.
 */
export async function fulfillmentStatusesOf(
  admin: Pick<WiredAdmin, "orders">,
  principal: Parameters<WiredAdmin["orders"]["fulfillmentsOfOrders"]>[0],
  tenantId: string,
  orderIds: readonly string[],
): Promise<
  | { readonly ok: true; readonly byOrder: ReadonlyMap<string, OrderFulfillmentStatus> }
  | { readonly ok: false; readonly response: AdminResponse }
> {
  if (orderIds.length === 0) return { ok: true, byOrder: new Map() };
  const response = await admin.orders.fulfillmentsOfOrders(principal, { tenantId, orderIds });
  if (response.status !== 200) return { ok: false, response };
  const byOrder = new Map<string, OrderFulfillmentStatus>();
  for (const fulfillmentOrder of response.body as readonly FulfillmentOrder[]) {
    byOrder.set(fulfillmentOrder.orderRef, deriveFulfillmentStatus(fulfillmentOrder));
  }
  return { ok: true, byOrder };
}
