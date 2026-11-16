import { z } from "zod";
import { defineRoute, type RouteDefinition, type RequestContext } from "@platform/http";
import { CARRIER_KEY_PATTERN } from "@platform/shipping";
import type { WiredAdmin } from "../composition";

const id = z.string().min(1);
const ids = z
  .array(id)
  .min(1)
  .max(50)
  .refine((values) => new Set(values).size === values.length);
const carrierKey = z.string().regex(CARRIER_KEY_PATTERN);
const orderParams = z.object({ orderId: id });
const shipmentParams = z.object({ shipmentId: id });
const options = { format: z.enum(["A4", "A6"]).optional(), lang: z.enum(["ar", "en"]).optional() };
const key = (context: RequestContext): string => {
  const value = context.headers?.["idempotency-key"];
  return typeof value === "string" ? value : context.requestId;
};
export function carrierShippingRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/carrier-shipments",
      version: 1,
      permission: "shipping:create",
      idempotent: true,
      summary: "Ship order with carrier",
      schema: { params: orderParams, body: z.object({ carrierKey }).strict() },
      handle: ({ params, body, context }) =>
        admin.carrierShipping.ship(context.principal, {
          tenantId: context.tenantId,
          orderId: params.orderId,
          carrierKey: body.carrierKey,
          idempotencyKey: key(context),
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/carrier-shipments",
      version: 1,
      permission: "shipping:create",
      idempotent: true,
      summary: "Ship orders with carrier",
      schema: { body: z.object({ orderIds: ids, carrierKey }).strict() },
      handle: ({ body, context }) =>
        admin.carrierShipping.shipMany(context.principal, {
          ...body,
          tenantId: context.tenantId,
          idempotencyKey: key(context),
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/orders/:orderId/carrier-shipment",
      version: 1,
      permission: "shipping:read",
      summary: "Get order carrier shipment",
      schema: { params: orderParams },
      handle: ({ params, context }) =>
        admin.carrierShipping.orderCarrierShipment(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/shipments/:shipmentId/awb",
      version: 1,
      permission: "shipping:read",
      summary: "Print shipment waybill",
      schema: { params: shipmentParams, querystring: z.object(options).strict() },
      handle: ({ params, query, context }) =>
        admin.carrierShipping.printAwbs(context.principal, {
          tenantId: context.tenantId,
          shipmentIds: [params.shipmentId],
          ...query,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/shipments/awb",
      version: 1,
      permission: "shipping:read",
      summary: "Print shipment waybills",
      schema: {
        body: z.union([
          z.object({ shipmentIds: ids, ...options }).strict(),
          z.object({ orderIds: ids, ...options }).strict(),
        ]),
      },
      handle: ({ body, context }) =>
        admin.carrierShipping.printAwbs(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/shipments/:shipmentId/cancel",
      version: 1,
      permission: "shipping:void_label",
      idempotent: true,
      summary: "Cancel carrier shipment",
      schema: { params: shipmentParams },
      handle: ({ params, context }) =>
        admin.carrierShipping.cancel(context.principal, { ...params, tenantId: context.tenantId }),
    }),
  ] as readonly RouteDefinition[];
}
