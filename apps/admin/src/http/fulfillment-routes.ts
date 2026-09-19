import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { FulfillmentOrder } from "@platform/fulfillment";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";

const createFulfillmentBody = z.object({
  orderRef: z.string().min(1),
  items: z
    .array(
      z.object({
        productRef: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});
const fulfillmentOrderIdParams = z.object({ fulfillmentOrderId: z.string().min(1) });
const advanceBody = z.object({ toStatus: z.string().min(1) });
const recordWebhookBody = z.object({
  carrier: z.string().min(1),
  eventId: z.string().min(1),
  kind: z.string().min(1),
});
const fulfillmentByOrderParams = z.object({ orderId: z.string().min(1) });

/** `FulfillmentOrder` (`@platform/fulfillment`) is an `Entity` — same DTO discipline as {@link toOrderListItemDto}. */
export interface FulfillmentDetailDto {
  readonly id: string;
  readonly orderRef: string;
  readonly status: string;
  readonly items: readonly { readonly productRef: string; readonly quantity: number }[];
  readonly carrier: string | null;
  readonly carrierShipmentId: string | null;
  readonly trackingNumber: string | null;
  readonly deliveredAt: string | null;
  readonly packages: readonly {
    readonly reference: string;
    readonly itemRefs: readonly string[];
    readonly weightGrams: number;
  }[];
}

function toFulfillmentDetailDto(fulfillmentOrder: FulfillmentOrder): FulfillmentDetailDto {
  return {
    id: fulfillmentOrder.id.toString(),
    orderRef: fulfillmentOrder.orderRef,
    status: fulfillmentOrder.status.value,
    items: fulfillmentOrder.items.map((item) => ({
      productRef: item.productRef.value,
      quantity: item.quantity,
    })),
    carrier: fulfillmentOrder.carrierReference?.carrier ?? null,
    carrierShipmentId: fulfillmentOrder.carrierReference?.carrierShipmentId ?? null,
    trackingNumber: fulfillmentOrder.trackingNumber?.value ?? null,
    deliveredAt: fulfillmentOrder.deliveredAt?.toISOString() ?? null,
    packages: fulfillmentOrder.packages.map((pkg) => ({
      reference: pkg.reference,
      itemRefs: pkg.itemRefs,
      weightGrams: pkg.weightGrams,
    })),
  };
}

/**
 * The Fulfillment admin HTTP surface (Sprint 4.9 — Fulfillment's first HTTP transport, per
 * `SPRINT_4_9_FULFILLMENT_CORE_REPORT.md` §2: "FulfillmentController + FulfillmentAdminController +
 * fulfillment-routes (5 versioned zod routes under /fulfillments: create / transitions / reserve /
 * shipments / webhook)"). Pure delegation — zod validates the boundary, the facade authorizes +
 * audits (AdminGuard), the context owns all behavior.
 */
export function fulfillmentRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/fulfillments",
      version: 1,
      permission: "fulfillment:create",
      idempotent: true,
      summary: "Open a fulfillment order for an order's items",
      schema: { body: createFulfillmentBody },
      handle: ({ body, context }) =>
        admin.fulfillment.create(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/fulfillments/:fulfillmentOrderId/transitions",
      version: 1,
      permission: "fulfillment:advance",
      idempotent: true,
      summary:
        "Advance a fulfillment order to any status its current status's transition table allows",
      schema: { params: fulfillmentOrderIdParams, body: advanceBody },
      handle: ({ params, body, context }) =>
        admin.fulfillment.advance(context.principal, {
          fulfillmentOrderId: params.fulfillmentOrderId,
          tenantId: context.tenantId,
          toStatus: body.toStatus as Parameters<typeof admin.fulfillment.advance>[1]["toStatus"],
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/fulfillments/:fulfillmentOrderId/reserve",
      version: 1,
      permission: "fulfillment:reserve",
      summary: "Request a stock reservation via the InventoryPort",
      schema: { params: fulfillmentOrderIdParams },
      handle: ({ params, context }) =>
        admin.fulfillment.reserve(context.principal, { ...params, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/fulfillments/:fulfillmentOrderId/shipments",
      version: 1,
      permission: "fulfillment:ship",
      idempotent: true,
      summary: "Request a shipment from the carrier via the ShippingProviderPort",
      schema: { params: fulfillmentOrderIdParams },
      handle: ({ params, context }) =>
        admin.fulfillment.ship(context.principal, { ...params, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "GET",
      path: "/orders/:orderId/fulfillment",
      version: 1,
      permission: "fulfillment:read",
      summary: "Get the fulfillment order opened for an order, if any",
      schema: { params: fulfillmentByOrderParams },
      handle: async ({ params, context }): Promise<AdminResponse> => {
        const response = await admin.fulfillment.getByOrder(context.principal, {
          tenantId: context.tenantId,
          orderRef: params.orderId,
        });
        if (response.status !== 200) {
          return response;
        }
        return { status: 200, body: toFulfillmentDetailDto(response.body as FulfillmentOrder) };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/fulfillments/:fulfillmentOrderId/webhook",
      version: 1,
      permission: "fulfillment:record_webhook",
      summary: "Record a carrier webhook (replay-safe)",
      schema: { params: fulfillmentOrderIdParams, body: recordWebhookBody },
      handle: ({ params, body, context }) =>
        admin.fulfillment.recordWebhook(context.principal, {
          fulfillmentOrderId: params.fulfillmentOrderId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
  ] as readonly RouteDefinition[];
}
