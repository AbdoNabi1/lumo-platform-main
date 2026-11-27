import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";
import { uncached } from "./uncached-response";

/**
 * Lead Site Part D1: the shop's enabled ad platforms' PUBLIC ids, for the storefront's browser tags (D2).
 * `public: true` means no guard runs (`permission` is advisory, as on every public route), so the route
 * has no body and reads through the `publicReads.adPlatforms` closure with the request's tenant: only
 * pixel/measurement/conversion ids can leave. No token, no test event code, no sealed value, and the
 * answer is `private, no-store` because it is per shop.
 */
export function publicAdPlatformsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/public/ad-platforms",
      version: 1,
      permission: "settings:read",
      public: true,
      summary:
        "Public: the shop's enabled ad platforms' public ids (pixel ids only, never a token)",
      schema: {},
      handle: async ({ context }) =>
        uncached(await admin.publicReads.adPlatforms.publicView(context.tenantId)),
    }),
  ] as readonly RouteDefinition[];
}
