import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { ArchiveOrdersOutput } from "@platform/orders";
import { NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import type { BulkOrderAction } from "../interfaces/bulk-order-actions";
import { BULK_RUNNERS } from "./order-bulk-actions";

const orderIdParams = z.object({ orderId: z.string().min(1) });

const bulkOrderIds = z.array(z.string().min(1)).min(1).max(50);

function bulkAction<A extends BulkOrderAction>(action: A) {
  return z.object({ action: z.literal(action), orderIds: bulkOrderIds }).strict();
}

/** One strict member per action, so Part 2 can add `tags` to its own two members only. */
export const bulkOrdersBody = z.discriminatedUnion("action", [
  bulkAction("archive"),
  bulkAction("unarchive"),
  bulkAction("fulfill"),
  bulkAction("capture_payments"),
  bulkAction("mark_cod_collected"),
]);

/** Archive or unarchive ONE order through the same use case the bulk action runs (spec §1.4). */
async function setOneArchived(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  orderId: string,
  archive: boolean,
): Promise<AdminResponse> {
  const input = { tenantId, orderIds: [orderId], actorRef: principal.id };
  const response = archive
    ? await admin.orders.archiveOrders(principal, input)
    : await admin.orders.unarchiveOrders(principal, input);
  if (response.status !== 200) return response;
  const result = (response.body as ArchiveOrdersOutput).results[0];
  if (result === undefined || result.outcome === "not_found") {
    return { status: 404, body: toErrorEnvelope(new NotFoundError("Order not found")) };
  }
  return {
    status: 200,
    body: { orderId: result.orderId, archivedAt: result.archivedAt?.toISOString() ?? null },
  };
}

/** Order operations Part 1 — the list's operations (archive here; bulk, export rows and packing slips follow). */
export function orderOperationsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/archive",
      version: 1,
      permission: "orders:archive",
      idempotent: true,
      summary:
        "Archive an order (Shopify's reversible Archive; the lifecycle and version are untouched)",
      schema: { params: orderIdParams },
      handle: ({ params, context }) =>
        setOneArchived(admin, context.principal, context.tenantId, params.orderId, true),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/unarchive",
      version: 1,
      permission: "orders:archive",
      idempotent: true,
      summary: "Unarchive an order",
      schema: { params: orderIdParams },
      handle: ({ params, context }) =>
        setOneArchived(admin, context.principal, context.tenantId, params.orderId, false),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/bulk",
      version: 1,
      // The route's own gate only says "works with orders"; the ACTION's permission is checked first,
      // inside (BULK_ACTION_PERMISSIONS), before any order is touched.
      permission: "orders:read",
      idempotent: true,
      summary:
        "Run one action on up to 50 orders — each order on its own, through the single-order call — and answer a result per order",
      schema: { body: bulkOrdersBody },
      handle: async ({ body, context }): Promise<AdminResponse> => {
        const denied = await admin.orders.authorizeBulkAction(context.principal, {
          action: body.action,
        });
        if (denied) return denied;
        const outcome = await BULK_RUNNERS[body.action]({
          admin,
          principal: context.principal,
          tenantId: context.tenantId,
          orderIds: [...new Set(body.orderIds)],
        });
        if (!outcome.ok) return outcome.response;
        return { status: 200, body: { results: outcome.results } };
      },
    }),
  ];
}
