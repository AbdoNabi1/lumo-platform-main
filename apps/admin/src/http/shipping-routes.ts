import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Shipment } from "@platform/shipping";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";

const createShipmentBody = z.object({
  fulfillmentRef: z.string().min(1),
  packages: z
    .array(
      z.object({
        reference: z.string().min(1),
        itemRefs: z.array(z.string().min(1)).min(1),
        weightGrams: z.number().int().positive(),
      }),
    )
    .min(1),
});
const shipmentIdParams = z.object({ shipmentId: z.string().min(1) });
const advanceBody = z.object({ toStatus: z.string().min(1) });
const updateTrackingBody = z.object({
  description: z.string().min(1),
  location: z.string().min(1).optional(),
});
const recordWebhookBody = z.object({
  carrier: z.string().min(1),
  eventId: z.string().min(1),
  kind: z.string().min(1),
});
const shipmentByFulfillmentParams = z.object({ fulfillmentOrderId: z.string().min(1) });

/** `Shipment` (`@platform/shipping`) is an `Entity` — same DTO discipline as {@link toOrderListItemDto}. */
export interface ShipmentDetailDto {
  readonly id: string;
  readonly fulfillmentRef: string;
  readonly status: string;
  readonly carrier: string | null;
  readonly carrierService: string | null;
  readonly trackingNumber: string | null;
  /** Only set once the carrier accepted the shipment — derived from that attempt's own timestamp, never fabricated. */
  readonly shippedAt: string | null;
  readonly deliveredAt: string | null;
}

function toShipmentDetailDto(shipment: Shipment): ShipmentDetailDto {
  const acceptedByCarrier = shipment.attempts.find(
    (attempt) => attempt.kind === "carrier" && attempt.outcome === "succeeded",
  );
  return {
    id: shipment.id.toString(),
    fulfillmentRef: shipment.fulfillmentRef,
    status: shipment.status.value,
    carrier: shipment.carrier?.value ?? null,
    carrierService: shipment.carrierService?.value ?? null,
    trackingNumber: shipment.trackingNumber?.value ?? null,
    shippedAt: acceptedByCarrier?.occurredAt.toISOString() ?? null,
    deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
  };
}

/**
 * The Shipping admin HTTP surface (Sprint 4.10 — Shipping's first HTTP transport, per
 * `SPRINT_4_10_SHIPPING_CORE_REPORT.md` §2: "ShippingController + ShippingAdminController +
 * shipping-routes (7 versioned zod routes under /shipments: create / transitions / label /
 * label-void / tracking / retry / webhook)"). Pure delegation — zod validates the boundary, the
 * facade authorizes + audits (AdminGuard), the context owns all behavior.
 */
export function shippingRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/shipments",
      version: 1,
      permission: "shipping:create",
      idempotent: true,
      summary: "Open a shipment for a fulfillment order's packages",
      schema: { body: createShipmentBody },
      handle: ({ body, context }) => admin.shipping.create(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/shipments/:shipmentId/transitions",
      version: 1,
      permission: "shipping:advance",
      idempotent: true,
      summary: "Advance a shipment to any status its current status's transition table allows",
      schema: { params: shipmentIdParams, body: advanceBody },
      handle: ({ params, body, context }) =>
        admin.shipping.advance(context.principal, {
          shipmentId: params.shipmentId,
          toStatus: body.toStatus as Parameters<typeof admin.shipping.advance>[1]["toStatus"],
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/shipments/:shipmentId/label",
      version: 1,
      permission: "shipping:create_label",
      idempotent: true,
      summary: "Request a label from the carrier via the CarrierProviderPort",
      schema: { params: shipmentIdParams },
      handle: ({ params, context }) => admin.shipping.createLabel(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/shipments/:shipmentId/label-void",
      version: 1,
      permission: "shipping:void_label",
      idempotent: true,
      summary: "Void the shipment's label at the carrier",
      schema: { params: shipmentIdParams },
      handle: ({ params, context }) => admin.shipping.voidLabel(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/shipments/:shipmentId/tracking",
      version: 1,
      permission: "shipping:update_tracking",
      summary: "Append a carrier tracking scan to the shipment's history",
      schema: { params: shipmentIdParams, body: updateTrackingBody },
      handle: ({ params, body, context }) =>
        admin.shipping.updateTracking(context.principal, {
          shipmentId: params.shipmentId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/shipments/:shipmentId/retry",
      version: 1,
      permission: "shipping:retry",
      idempotent: true,
      summary: "Retry a shipment from a recoverable state",
      schema: { params: shipmentIdParams },
      handle: ({ params, context }) => admin.shipping.retry(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/fulfillments/:fulfillmentOrderId/shipment",
      version: 1,
      permission: "shipping:read",
      summary: "Get the shipment opened for a fulfillment order, if any",
      schema: { params: shipmentByFulfillmentParams },
      handle: async ({ params, context }): Promise<AdminResponse> => {
        const response = await admin.shipping.getByFulfillment(context.principal, {
          fulfillmentRef: params.fulfillmentOrderId,
        });
        if (response.status !== 200) {
          return response;
        }
        return { status: 200, body: toShipmentDetailDto(response.body as Shipment) };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/shipments/:shipmentId/webhook",
      version: 1,
      permission: "shipping:record_webhook",
      summary: "Record a carrier webhook (replay-safe)",
      schema: { params: shipmentIdParams, body: recordWebhookBody },
      handle: ({ params, body, context }) =>
        admin.shipping.recordWebhook(context.principal, { shipmentId: params.shipmentId, ...body }),
    }),
  ] as readonly RouteDefinition[];
}
