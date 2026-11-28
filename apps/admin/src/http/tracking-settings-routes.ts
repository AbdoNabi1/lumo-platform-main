import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { TrackingSettingsService, TrackingStoreSettings } from "@platform/tracking";
import { uncached } from "./uncached-response";

/**
 * Tracking P2-D1: Settings → Tracking → consent and cookie notice. One document per store, read and saved whole.
 *
 * - `GET /tracking/settings` (`settings:read`): the store's settings; a store that never saved any gets the defaults
 *   at `version: 0` (`notice_only`, notice shown).
 * - `PUT /tracking/settings` (`settings:update`, idempotent): `{ consentPolicy, cookieNoticeEnabled, expectedVersion }`,
 *   `.strict()` — a tenant, or any unknown key, is 422 and nothing is written. `expectedVersion` is the version the page
 *   loaded (0 for the defaults); a stale one is `409 CONFLICT` carrying the current settings, never an overwrite.
 * - `GET /public/tracking/settings` (public, per request tenant): `{ cookieNoticeEnabled }` and nothing else — the
 *   storefront decides whether to show its notice. Never the policy, the version or the tenant.
 *
 * The tenant is always the request's (`context.tenantId`), never the body's.
 */

const settingsBody = z
  .object({
    consentPolicy: z.enum(["notice_only", "opt_in"]),
    cookieNoticeEnabled: z.boolean(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();

function view(settings: TrackingStoreSettings) {
  return {
    consentPolicy: settings.consentPolicy,
    cookieNoticeEnabled: settings.cookieNoticeEnabled,
    version: settings.version,
    updatedAt: settings.updatedAt,
  };
}

export function trackingSettingsRoutes(
  service: TrackingSettingsService,
): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/tracking/settings",
      version: 1,
      permission: "settings:read",
      summary:
        "The store's tracking settings: consent policy and cookie notice (defaults at version 0)",
      schema: {},
      handle: async ({ context }) => ({
        status: 200,
        body: view(await service.get(context.tenantId)),
      }),
    }),
    defineRoute({
      method: "PUT",
      path: "/tracking/settings",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary:
        "Save the store's tracking settings whole (409 with the current settings when expectedVersion is stale)",
      schema: { body: settingsBody },
      handle: async ({ body, context }) => {
        const result = await service.update(context.tenantId, {
          consentPolicy: body.consentPolicy,
          cookieNoticeEnabled: body.cookieNoticeEnabled,
          expectedVersion: body.expectedVersion,
        });
        if (result.status === "conflict") {
          return {
            status: 409,
            body: {
              code: "CONFLICT",
              message: "Tracking settings changed since they were read; reload and try again",
              retryable: false,
              current: view(result.current),
            },
          };
        }
        return { status: 200, body: view(result.settings) };
      },
    }),
  ] as readonly RouteDefinition[];
}

/** The one switch the storefront reads. Public: no guard runs, so only the notice flag can leave. */
export function publicTrackingSettingsRoutes(
  service: TrackingSettingsService,
): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/public/tracking/settings",
      version: 1,
      permission: "settings:read",
      public: true,
      summary: "Public: whether the storefront shows its cookie notice (that switch only)",
      schema: {},
      handle: async ({ context }) =>
        uncached({
          status: 200,
          body: { cookieNoticeEnabled: await service.cookieNoticeEnabledFor(context.tenantId) },
        }),
    }),
  ] as readonly RouteDefinition[];
}
