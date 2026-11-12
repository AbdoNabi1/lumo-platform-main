import type { Principal } from "@platform/contracts";
import type { Order } from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";

/**
 * The linked payment of each order on a page, from ONE batched Payments read. A failed read is the
 * failure — never "no payments": export rows and packing slips print a cash-to-collect amount from it.
 */
export async function paymentIntentsOfOrders(
  admin: Pick<WiredAdmin, "orders">,
  principal: Principal,
  tenantId: string,
  orders: readonly Order[],
): Promise<
  | { readonly ok: true; readonly byId: ReadonlyMap<string, PaymentIntentSummary> }
  | { readonly ok: false; readonly response: AdminResponse }
> {
  const paymentIntentIds = [
    ...new Set(
      orders.flatMap((order) => (order.paymentRef === undefined ? [] : [order.paymentRef])),
    ),
  ];
  if (paymentIntentIds.length === 0) return { ok: true, byId: new Map() };
  const response = await admin.orders.paymentIntentsOf(principal, { tenantId, paymentIntentIds });
  if (response.status !== 200) return { ok: false, response };
  const summaries = response.body as readonly PaymentIntentSummary[];
  return { ok: true, byId: new Map(summaries.map((summary) => [summary.id, summary])) };
}
