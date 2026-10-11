import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

/**
 * Plan 3C — the one public question about the shop's shipping setup: which countries it ships to, so
 * the storefront's country select offers exactly those. `{ countries, restOfWorld }` and nothing else:
 * no zone names, no rates, no provinces. Public the same way the other storefront reads are — the
 * pipeline skips authentication and the permission guard, and the route is declared public in code.
 */
export function publicShippingRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/public/shipping/countries",
      version: 1,
      permission: "checkout:read",
      public: true,
      summary:
        "Public: the countries the shop ships to (from its shipping zones), and whether it ships to the rest of the world",
      schema: {},
      handle: ({ context }) => admin.publicReads.shippableCountries(context.tenantId),
    }),
  ] as readonly RouteDefinition[];
}
