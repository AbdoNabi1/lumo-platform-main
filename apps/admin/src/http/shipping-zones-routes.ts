import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const zoneIdParams = z.object({ zoneId: z.string().min(1) });
const rateIdParams = z.object({ zoneId: z.string().min(1), rateId: z.string().min(1) });

const countries = z
  .array(
    z.object({
      code: z.string().min(1).max(2),
      provinces: z.array(z.string().min(1).max(10)).max(100).nullable(),
    }),
  )
  .max(260);
const zoneBody = z.object({ name: z.string().max(200), countries });

const bound = z.number().int().nonnegative().optional();
const condition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("orderPrice"), minMinor: bound, maxMinor: bound }),
  z.object({ type: z.literal("weight"), minGrams: bound, maxGrams: bound }),
]);
const rateBody = z.object({
  name: z.string().max(200),
  priceMinor: z.number().int(),
  condition: condition.optional(),
  description: z.string().max(1000).nullable().optional(),
});
// Plan 3E: only a new zone may carry its first rates, saved with it in one unit of work.
const createZoneBody = zoneBody.extend({ rates: z.array(rateBody).max(20).optional() });

/**
 * Plan 3C — the shop's shipping zones and rates (Settings → Shipping and delivery). Staff routes under
 * `/shipping/zones`; reads need `settings:read`, writes `settings:update`. The tenant is the verified
 * request tenant, never a body field. Pure delegation: zod checks the shape, the Shipping context owns
 * every rule (names, one zone per country, conditions).
 */
export function shippingZonesRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/shipping/zones",
      version: 1,
      permission: "settings:read",
      summary: "The shop's shipping zones with their rates",
      schema: {},
      handle: ({ context }) =>
        admin.shippingZones.list(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/shipping/zones",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Create a shipping zone (a country can only be in one zone)",
      schema: { body: createZoneBody },
      handle: ({ body, context }) =>
        admin.shippingZones.create(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/shipping/zones/:zoneId",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Rename a shipping zone and replace its countries",
      schema: { params: zoneIdParams, body: zoneBody },
      handle: ({ params, body, context }) =>
        admin.shippingZones.update(context.principal, {
          ...body,
          zoneId: params.zoneId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "DELETE",
      path: "/shipping/zones/:zoneId",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Delete a shipping zone with its rates",
      schema: { params: zoneIdParams },
      handle: ({ params, context }) =>
        admin.shippingZones.remove(context.principal, {
          zoneId: params.zoneId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/shipping/zones/:zoneId/rates",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Add a rate to a shipping zone",
      schema: { params: zoneIdParams, body: rateBody },
      handle: ({ params, body, context }) =>
        admin.shippingZones.addRate(context.principal, {
          ...body,
          zoneId: params.zoneId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "PUT",
      path: "/shipping/zones/:zoneId/rates/:rateId",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Replace a shipping rate's name, price, condition and description",
      schema: { params: rateIdParams, body: rateBody },
      handle: ({ params, body, context }) =>
        admin.shippingZones.updateRate(context.principal, {
          ...body,
          zoneId: params.zoneId,
          rateId: params.rateId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "DELETE",
      path: "/shipping/zones/:zoneId/rates/:rateId",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Delete a shipping rate",
      schema: { params: rateIdParams },
      handle: ({ params, context }) =>
        admin.shippingZones.deleteRate(context.principal, {
          zoneId: params.zoneId,
          rateId: params.rateId,
          tenantId: context.tenantId,
        }),
    }),
  ] as readonly RouteDefinition[];
}
