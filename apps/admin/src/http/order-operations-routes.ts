import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { ArchiveOrdersOutput, Order } from "@platform/orders";
import type { Paginated } from "@platform/types";
import { NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import type { BulkOrderAction } from "../interfaces/bulk-order-actions";
import { BULK_RUNNERS } from "./order-bulk-actions";
import { customerContactsFor, customerLabelsOf, customerNamesFor } from "./order-customer-names";
import { toOrderExportRowDto, toPackingSlipDto } from "./order-export-rows";
import { paymentIntentsOfOrders } from "./order-payment-intents";
import {
  listOrdersForView,
  ORDER_STATUS_VALUES,
  ORDER_VIEWS,
  orderAnnotationsFor,
} from "./order-views";

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

/**
 * A comma list of ids (`?ids=a,b`), trimmed and deduped, 1..max. `RouteDefinition` types a schema's
 * input as its output (`z.ZodType<T>`), so the string-in / array-out schema is declared that way; the
 * parsing is unchanged and handlers always receive the array.
 */
function commaIds(max: number): z.ZodType<string[], z.ZodTypeDef, string[]> {
  return z
    .string()
    .transform((raw) => [
      ...new Set(
        raw
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    ])
    .pipe(z.array(z.string()).min(1).max(max)) as unknown as z.ZodType<
    string[],
    z.ZodTypeDef,
    string[]
  >;
}

export const EXPORT_ROWS_PAGE_SIZE = 250;

const exportRowsQuery = z
  .object({
    view: z.enum(ORDER_VIEWS).optional(),
    search: z.string().min(1).optional(),
    status: z.enum(ORDER_STATUS_VALUES).optional(),
    ids: commaIds(50).optional(),
    /** ISO instants; admin-web turns the shop-local days into them. createdFrom inclusive, createdTo exclusive. */
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
    first: z.coerce.number().int().min(1).max(EXPORT_ROWS_PAGE_SIZE).optional(),
    after: z.string().min(1).optional(),
  })
  .refine(
    (query) =>
      query.createdFrom === undefined ||
      query.createdTo === undefined ||
      query.createdFrom < query.createdTo,
    { message: "createdFrom must be before createdTo", path: ["createdTo"] },
  );

const packingSlipsQuery = z.object({ ids: commaIds(50) });

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
    defineRoute({
      method: "GET",
      path: "/orders/export-rows",
      version: 1,
      permission: "orders:export",
      summary: "One courier-ready row per order, for the CSV export (cursor page of up to 250)",
      schema: { querystring: exportRowsQuery },
      handle: async ({ query, context }): Promise<AdminResponse> => {
        const { principal, tenantId } = context;
        const { view, ids, first, ...filters } = query;
        const found = await listOrdersForView(admin, principal, tenantId, view ?? "all", {
          ...filters,
          ...(ids === undefined ? {} : { ids }),
          first: first ?? EXPORT_ROWS_PAGE_SIZE,
        });
        if (!found.ok) return found.response;
        const orders = found.page.items;
        // A sheet whose cash-on-delivery amounts are guessed is worse than no sheet: fail instead.
        const intents = await paymentIntentsOfOrders(admin, principal, tenantId, orders);
        if (!intents.ok) return intents.response;
        const annotations = await orderAnnotationsFor(
          admin,
          principal,
          tenantId,
          orders.map((o) => o.id.toString()),
        );
        if (!annotations.ok) return annotations.response;
        const contacts = await customerContactsFor(admin, principal, tenantId, orders);
        const customerLabels = customerLabelsOf(contacts);
        return {
          status: 200,
          body: {
            items: orders.map((order) =>
              toOrderExportRowDto(order, {
                fulfillmentStatus: found.statuses.get(order.id.toString()) ?? "unfulfilled",
                contact: contacts.get(order.customerRef),
                customerLabels,
                intent:
                  order.paymentRef === undefined ? undefined : intents.byId.get(order.paymentRef),
                annotations: annotations.byOrder.get(order.id.toString()),
              }),
            ),
            pageInfo: found.page.pageInfo,
          },
        };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/orders/packing-slips",
      version: 1,
      permission: "orders:read",
      summary: "Printable packing slips for up to 50 orders, in the order asked",
      schema: { querystring: packingSlipsQuery },
      handle: async ({ query, context }): Promise<AdminResponse> => {
        const { principal, tenantId } = context;
        // A slip needs no fulfillment status: one plain tenant-scoped list read of the ids asked.
        const listed = await admin.orders.listOrders(principal, {
          tenantId,
          ids: query.ids,
          first: query.ids.length,
        });
        if (listed.status !== 200) return listed;
        const orders = (listed.body as Paginated<Order>).items;
        const intents = await paymentIntentsOfOrders(admin, principal, tenantId, orders);
        if (!intents.ok) return intents.response;
        const annotations = await orderAnnotationsFor(
          admin,
          principal,
          tenantId,
          orders.map((o) => o.id.toString()),
        );
        if (!annotations.ok) return annotations.response;
        const customerLabels = await customerNamesFor(admin, principal, tenantId, orders);
        const byId = new Map<string, Order>(orders.map((order) => [order.id.toString(), order]));
        return {
          status: 200,
          body: {
            slips: query.ids.flatMap((id) => {
              const order = byId.get(id);
              if (order === undefined) return [];
              return [
                toPackingSlipDto(order, {
                  customerLabels,
                  intent:
                    order.paymentRef === undefined ? undefined : intents.byId.get(order.paymentRef),
                  annotations: annotations.byOrder.get(id),
                }),
              ];
            }),
          },
        };
      },
    }),
  ];
}
