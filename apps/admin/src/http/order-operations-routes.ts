import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { ArchiveOrdersOutput } from "@platform/orders";
import { NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";

const orderIdParams = z.object({ orderId: z.string().min(1) });

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
  ];
}
