import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { CARRIER_KEY_PATTERN } from "@platform/shipping";
import type { WiredAdmin } from "../composition";

const params = z.object({ carrierKey: z.string().regex(CARRIER_KEY_PATTERN) });
const body = z
  .object({
    enabled: z.boolean().optional(),
    credentials: z.record(z.string().min(1).max(512)).optional(),
    config: z.record(z.unknown()).optional(),
    disconnect: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).length > 0 &&
      (value.disconnect !== true || Object.keys(value).length === 1),
  );

export function carrierSettingsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/shipping/carriers",
      version: 1,
      permission: "shipping:read_settings",
      summary: "Get carrier settings",
      schema: {},
      handle: ({ context }) =>
        admin.carrierSettings.get(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "GET",
      path: "/shipping/carriers/enabled",
      version: 1,
      permission: "shipping:read",
      summary: "List enabled carriers",
      schema: {},
      handle: ({ context }) =>
        admin.carrierSettings.listEnabled(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/shipping/carriers/:carrierKey",
      version: 1,
      permission: "shipping:update_settings",
      idempotent: true,
      summary: "Update carrier settings",
      schema: { params, body },
      handle: ({ params, body, context }) =>
        admin.carrierSettings.update(context.principal, {
          ...body,
          carrierKey: params.carrierKey,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/shipping/carriers/:carrierKey/webhook-secret",
      version: 1,
      permission: "shipping:update_settings",
      idempotent: true,
      summary: "Rotate the carrier webhook secret",
      schema: { params },
      handle: ({ params, context }) =>
        admin.carrierSettings.rotateWebhookSecret(context.principal, {
          carrierKey: params.carrierKey,
          tenantId: context.tenantId,
        }),
    }),
  ] as readonly RouteDefinition[];
}
