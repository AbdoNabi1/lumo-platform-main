import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const invoiceParams = z.object({ invoiceId: z.string().min(1) });
const changePlanBody = z.object({ planKey: z.string().min(1).max(64) }).strict();

/**
 * Merchant billing. Billing data is platform-owned: the merchant is the `tenantRef` on each row and
 * the rows live under the platform scope. Every route therefore passes `context.tenantId` as the ref
 * and `admin.platformScope(context.tenantId)` as the scope — a client never names the shop, a price,
 * a subscription or the scope. An invoice id that is not the caller's own is a 404 and starts nothing.
 */
export function storeBillingRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/store/billing",
      version: 1,
      permission: "settings:read",
      summary: "The shop's plan, status, next charge, card-on-file flag and invoices",
      schema: {},
      handle: ({ context }) =>
        admin.licensing.getMerchantBilling(
          context.principal,
          context.tenantId,
          admin.platformScope(context.tenantId),
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/store/billing/plans",
      version: 1,
      permission: "settings:read",
      summary: "The published plans the shop can choose between",
      schema: {},
      handle: ({ context }) => admin.licensing.listPublishedPlans(context.principal),
    }),
    defineRoute({
      method: "POST",
      path: "/store/billing/plan",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Move the shop's own subscription to another published plan, by plan key",
      schema: { body: changePlanBody },
      handle: ({ body, context }) =>
        admin.licensing.changeMerchantPlan(
          context.principal,
          context.tenantId,
          admin.platformScope(context.tenantId),
          body.planKey,
        ),
    }),
    defineRoute({
      method: "POST",
      path: "/store/billing/invoices/:invoiceId/pay",
      version: 1,
      permission: "settings:update",
      summary: "Start the card checkout for one of the shop's own invoices (404 for anyone else's)",
      schema: { params: invoiceParams },
      handle: ({ params, context }) =>
        admin.licensing.payMerchantInvoice(
          context.principal,
          context.tenantId,
          admin.platformScope(context.tenantId),
          params.invoiceId,
        ),
    }),
  ] as readonly RouteDefinition[];
}
