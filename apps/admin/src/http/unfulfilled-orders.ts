import type { Principal } from "@platform/contracts";
import { isOpenOrder, type Order, type OrderFulfillmentStatus } from "@platform/orders";
import type { Paginated } from "@platform/types";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { fulfillmentStatusesOf } from "./fulfillment-statuses-of";

/** How many orders are examined per request at most, however few of them match. */
export const UNFULFILLED_SCAN_CAP = 500;
const BATCH = 100;
const DEFAULT_PAGE = 20;

export type UnfulfilledOrdersResult =
  | {
      readonly ok: true;
      readonly page: Paginated<Order>;
      /** The Plan 3B fulfillment status of each returned order (always "unfulfilled"). */
      readonly statuses: ReadonlyMap<string, OrderFulfillmentStatus>;
    }
  | { readonly ok: false; readonly response: AdminResponse };

/**
 * `GET /orders?fulfillment=unfulfilled`: the orders the dashboard "Orders to fulfill" card counts.
 * The fulfillment status of an order lives in the Fulfillment context, so it cannot be a WHERE on the
 * orders table; like the existing status filter, this walks the list newest first in batches, keeps
 * the orders that are open ({@link isOpenOrder}: never cancelled, not closed) AND whose Plan 3B status
 * (ONE batched Fulfillment read per batch, the very function the list uses) is "unfulfilled", and
 * stops at a full page or after {@link UNFULFILLED_SCAN_CAP} orders.
 *
 * The cursor is always an order id this call returned or examined, so the next page resumes exactly
 * where this one stopped: a page may come back short while `hasNextPage` is still true when the cap
 * was hit first. A failed read is answered as the failure, never as an empty or partial list.
 */
export async function listUnfulfilledOrders(
  admin: Pick<WiredAdmin, "orders">,
  principal: Principal,
  tenantId: string,
  query: {
    readonly first?: number;
    readonly after?: string;
    readonly search?: string;
    readonly status?: Parameters<WiredAdmin["orders"]["listOrders"]>[1]["status"];
  },
): Promise<UnfulfilledOrdersResult> {
  const limit = query.first ?? DEFAULT_PAGE;
  const matches: Order[] = [];
  let cursor = query.after;
  let scanned = 0;
  let exhausted = false;

  while (matches.length <= limit && scanned < UNFULFILLED_SCAN_CAP) {
    const response = await admin.orders.listOrders(principal, {
      tenantId,
      first: Math.min(BATCH, UNFULFILLED_SCAN_CAP - scanned),
      ...(cursor === undefined ? {} : { after: cursor }),
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.status === undefined ? {} : { status: query.status }),
    });
    if (response.status !== 200) return { ok: false, response };

    const batch = response.body as Paginated<Order>;
    const open = batch.items.filter((order) => isOpenOrder(order.history));
    const statuses = await fulfillmentStatusesOf(
      admin,
      principal,
      tenantId,
      open.map((order) => order.id.toString()),
    );
    if (!statuses.ok) return { ok: false, response: statuses.response };

    for (const order of open) {
      const status = statuses.byOrder.get(order.id.toString()) ?? "unfulfilled";
      if (status === "unfulfilled" && matches.length <= limit) matches.push(order);
    }

    scanned += batch.items.length;
    cursor = batch.pageInfo.endCursor ?? cursor;
    if (batch.items.length === 0 || !batch.pageInfo.hasNextPage) {
      exhausted = true;
      break;
    }
  }

  const statuses = new Map<string, OrderFulfillmentStatus>();
  const send = (items: readonly Order[]) => {
    for (const order of items) statuses.set(order.id.toString(), "unfulfilled");
    return items;
  };

  if (matches.length > limit) {
    const items = send(matches.slice(0, limit));
    return {
      ok: true,
      statuses,
      page: {
        items: [...items],
        pageInfo: { hasNextPage: true, endCursor: items.at(-1)?.id.toString() ?? null },
      },
    };
  }
  return {
    ok: true,
    statuses,
    page: {
      items: [...send(matches)],
      pageInfo: {
        hasNextPage: !exhausted,
        endCursor: exhausted ? (matches.at(-1)?.id.toString() ?? null) : (cursor ?? null),
      },
    },
  };
}
