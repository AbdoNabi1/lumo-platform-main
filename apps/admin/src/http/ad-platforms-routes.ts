import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { AD_PLATFORMS } from "@platform/ad-platforms";
import type { WiredAdmin } from "../composition";

const platformParams = z.object({ platform: z.enum(AD_PLATFORMS) });

/**
 * No `tenantId`, no `platform` at the top level (`.strict()` ⇒ 422): the shop is the request's and the
 * platform is the path's. `secret` is write-only: accepted here, never returned. The shape rules (ids,
 * token characters) are the use case's and answer 422 field issues.
 */
const saveBody = z
  .object({
    enabled: z.boolean(),
    publicConfig: z.record(z.string(), z.unknown()).nullable(),
    secret: z.string().max(1024).optional(),
    clearSecret: z.boolean().optional(),
    testEventCode: z.string().max(64).nullable().optional(),
    /** 0 when the page loaded "no row yet". */
    expectedVersion: z.number().int().min(0),
  })
  .strict();

/**
 * Lead Site Part D1: Settings → Ad platforms. Per request tenant, admin only (`settings:*`). A token is
 * never in a response: the view carries `secret: { configured, last4 }` only. 503 `UNAVAILABLE` when a
 * token is sent while no real credential vault is configured (`AD_PLATFORM_CREDENTIALS_KEK_REF`).
 */
export function adPlatformsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/ad-platforms",
      version: 1,
      permission: "settings:read",
      summary:
        "The shop's five ad platform connections (tokens are never returned: configured + last4)",
      schema: {},
      handle: async ({ context }) => {
        const res = await admin.adPlatforms.list(context.principal, { tenantId: context.tenantId });
        // The use case answers a bare array; the contract is `{ items }`.
        return res.status === 200 ? { ...res, body: { items: res.body } } : res;
      },
    }),
    defineRoute({
      method: "PUT",
      path: "/ad-platforms/:platform",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary:
        "Save one platform's connection: public ids, enabled, an optional write-only token (409 when stale)",
      schema: { params: platformParams, body: saveBody },
      handle: ({ params, body, context }) =>
        admin.adPlatforms.save(context.principal, {
          tenantId: context.tenantId,
          platform: params.platform,
          enabled: body.enabled,
          // The path names the platform; a body that names another one fails validation (422).
          publicConfig:
            body.publicConfig === null ? null : { platform: params.platform, ...body.publicConfig },
          ...(body.secret === undefined ? {} : { secret: body.secret }),
          ...(body.clearSecret === undefined ? {} : { clearSecret: body.clearSecret }),
          ...(body.testEventCode === undefined ? {} : { testEventCode: body.testEventCode }),
          expectedVersion: body.expectedVersion,
        }),
    }),
  ] as readonly RouteDefinition[];
}
