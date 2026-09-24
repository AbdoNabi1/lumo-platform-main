import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

/** Paymob's callback carries no field this route reads: the use case parses the verified, signed ones. */
const cardTokenCallbackBody = z.object({}).passthrough();
const cardTokenCallbackQuery = z.object({ hmac: z.string().min(1) });

/**
 * Morbeh's OWN billing ingress — deliberately not `payments-webhook-routes.ts`. A merchant's store
 * callback (`/payments/webhook/paymob`) is verified against the RECEIVING MERCHANT's HMAC secret and
 * lands in Payments; this one is verified against MORBEH's billing-account secret, by the card-token
 * scheme (a different signing scheme from the transaction callback), and lands in Licensing's
 * platform-scoped saved-card store. Sharing a handler is how a merchant's chargeback ends up looking
 * like a Morbeh billing event (WP-14 trap), so the two paths share no route, secret or row.
 *
 * `public: true`: Paymob presents no admin Bearer token. Its authentication IS the callback HMAC,
 * checked inside `RecordCardToken` before anything is stored; the scope written is pinned to the
 * platform tenant by `LicensingController.recordCardToken`, whatever tenant the request resolved to.
 */
export function platformBillingRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/platform-billing/paymob/card-token",
      version: 1,
      permission: "licensing:billing:manage",
      public: true,
      summary:
        "Paymob card-token callback for Morbeh's own billing account (signature-verified via the `hmac` query parameter, not staff-authenticated)",
      schema: { body: cardTokenCallbackBody, querystring: cardTokenCallbackQuery },
      handle: async ({ query, context }) => {
        if (context.rawBody === undefined) {
          return {
            status: 401,
            body: { code: "UNAUTHORIZED", message: "Missing request body" },
          };
        }
        return await admin.licensing.recordCardToken({
          tenantId: context.tenantId,
          rawBody: context.rawBody,
          signature: query.hmac,
        });
      },
    }),
  ] as readonly RouteDefinition[];
}
