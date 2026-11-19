import { z } from "zod";
import type { Principal } from "@platform/contracts";
import type { Order, OrderAnnotations, OrderFulfillmentStatus } from "@platform/orders";
import type { Paginated } from "@platform/types";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { fulfillmentStatusesOf } from "./fulfillment-statuses-of";
import { listUnfulfilledOrders } from "./unfulfilled-orders";

/** Shopify's default views, in Shopify's order (spec §1.1). */
export const ORDER_VIEWS = ["all", "unfulfilled", "unpaid", "open", "archived"] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

/** The 21 lifecycle statuses the Filter's status select offers (moved here from admin-routes.ts). */
export const ORDER_STATUS_VALUES = [
  "placed",
  "paid",
  "refunded",
  "created",
  "confirmed",
  "cancelled",
  "held",
  "resumed",
  "awaiting_payment",
  "payment_requested",
  "payment_received",
  "payment_failed",
  "ready_for_fulfillment",
  "fulfillment_requested",
  "fulfilled",
  "partially_fulfilled",
  "delivered",
  "return_requested",
  "returned",
  "refund_requested",
  "closed",
] as const;

type ListInput = Parameters<WiredAdmin["orders"]["listOrders"]>[1];
/** Everything a caller may filter on besides the view's own predicates. */
export type OrderListFilters = Omit<ListInput, "tenantId" | "archived" | "open" | "paymentStatus">;

/** Each tab as repository predicates; `unfulfilled` adds the Fulfillment-side check in `listUnfulfilledOrders`. */
export function viewFilters(
  view: OrderView,
): Pick<ListInput, "archived" | "open" | "paymentStatus"> {
  switch (view) {
    case "all":
      return {};
    case "unfulfilled":
      // `open` lets SQL drop cancelled/closed orders before the Fulfillment scan; the scan still checks
      // `isOpenOrder`, so the results are the same — only fewer orders are examined.
      return { archived: false, open: true };
    case "unpaid":
      return { archived: false, open: true, paymentStatus: "pending" };
    case "open":
      return { archived: false, open: true };
    case "archived":
      return { archived: true };
  }
}

/** `view` wins; Home's old `fulfillment=unfulfilled` links read as the Unfulfilled tab; nothing = All. */
export function resolveOrderView(
  view: OrderView | undefined,
  fulfillment: "unfulfilled" | undefined,
): OrderView {
  return view ?? (fulfillment === "unfulfilled" ? "unfulfilled" : "all");
}

export type OrderViewPage =
  | {
      readonly ok: true;
      readonly page: Paginated<Order>;
      readonly statuses: ReadonlyMap<string, OrderFulfillmentStatus>;
    }
  | { readonly ok: false; readonly response: AdminResponse };

/** One page of a view, with each order's Plan 3B fulfillment status (one batched Fulfillment read). */
export async function listOrdersForView(
  admin: Pick<WiredAdmin, "orders">,
  principal: Principal,
  tenantId: string,
  view: OrderView,
  filters: OrderListFilters,
): Promise<OrderViewPage> {
  const query = { ...filters, ...viewFilters(view) };
  if (view === "unfulfilled") {
    const found = await listUnfulfilledOrders(admin, principal, tenantId, query);
    return found.ok ? { ok: true, page: found.page, statuses: found.statuses } : found;
  }
  const response = await admin.orders.listOrders(principal, { ...query, tenantId });
  if (response.status !== 200) return { ok: false, response };
  const page = response.body as Paginated<Order>;
  const statuses = await fulfillmentStatusesOf(
    admin,
    principal,
    tenantId,
    page.items.map((order) => order.id.toString()),
  );
  if (!statuses.ok) return { ok: false, response: statuses.response };
  return { ok: true, page, statuses: statuses.byOrder };
}

/** Each order's annotations from ONE read; a failed read is answered as the failure. */
export async function orderAnnotationsFor(
  admin: Pick<WiredAdmin, "orders">,
  principal: Principal,
  tenantId: string,
  orderIds: readonly string[],
): Promise<
  | { readonly ok: true; readonly byOrder: ReadonlyMap<string, OrderAnnotations> }
  | { readonly ok: false; readonly response: AdminResponse }
> {
  if (orderIds.length === 0) return { ok: true, byOrder: new Map() };
  const response = await admin.orders.orderAnnotations(principal, { tenantId, orderIds });
  if (response.status !== 200) return { ok: false, response };
  return { ok: true, byOrder: response.body as ReadonlyMap<string, OrderAnnotations> };
}

/**
 * Spec §2.3: `tag` may repeat (`?tag=vip&tag=urgent` — AND). Fastify hands one value as a string and
 * several as an array; both become a trimmed list of 1..10 tags. Typed input-as-output like
 * `commaIds` in order-operations-routes.ts, because `RouteDefinition` types a schema by its output.
 */
export function tagFilterParam(): z.ZodType<string[], z.ZodTypeDef, string[]> {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((raw) =>
      (Array.isArray(raw) ? raw : [raw]).map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    )
    .pipe(z.array(z.string().max(200)).min(1).max(10)) as unknown as z.ZodType<
    string[],
    z.ZodTypeDef,
    string[]
  >;
}
