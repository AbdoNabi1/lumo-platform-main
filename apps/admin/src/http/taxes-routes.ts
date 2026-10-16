import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const countryParams = z.object({ countryCode: z.string().min(1).max(2) });
const flagsBody = z.object({
  pricesIncludeTax: z.boolean(),
  chargeTaxOnShipping: z.boolean(),
});
const regionBody = z.object({
  rateBasisPoints: z.number().int(),
  provinces: z
    .array(z.object({ code: z.string().min(1).max(10), rateBasisPoints: z.number().int() }))
    .max(100),
});

/**
 * Plan 3C — the shop's tax settings (Settings → Taxes and duties): the two switches and the regions
 * where tax is collected, each with a country rate and optional province rates. Staff routes; reads
 * need `settings:read`, writes `settings:update`. The tenant is the verified request tenant. Rates are
 * basis points (1400 = 14%); the Finance context owns every rule.
 */
export function taxesRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/taxes",
      version: 1,
      permission: "settings:read",
      summary: "The shop's tax settings: the two switches and the regions with their rates",
      schema: {},
      handle: ({ context }) => admin.taxes.get(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/taxes/settings",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Save 'All prices include tax' and 'Charge tax on shipping rates'",
      schema: { body: flagsBody },
      handle: ({ body, context }) =>
        admin.taxes.update(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/taxes/regions/:countryCode",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Add or replace the tax region of a country (one region per country)",
      schema: { params: countryParams, body: regionBody },
      handle: ({ params, body, context }) =>
        admin.taxes.upsertRegion(context.principal, {
          ...body,
          countryCode: params.countryCode,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "DELETE",
      path: "/taxes/regions/:countryCode",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Remove the tax region of a country",
      schema: { params: countryParams },
      handle: ({ params, context }) =>
        admin.taxes.deleteRegion(context.principal, {
          countryCode: params.countryCode,
          tenantId: context.tenantId,
        }),
    }),
  ] as readonly RouteDefinition[];
}
