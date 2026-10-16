import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { ValidationError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { discountInputSchema, type DiscountInput } from "../interfaces/discounts/discount-input";

const listQuery = z.object({
  view: z.enum(["all", "active", "scheduled", "expired"]).default("all"),
  q: z.string().max(100).optional(),
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
});
const discountIdParams = z.object({ discountId: z.string().min(1) });

/** Parses the form here as well, so a per-type error is a 422 whatever the transport does first. */
function parseInput(body: unknown): DiscountInput | AdminResponse {
  const parsed = discountInputSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  return {
    status: 422,
    body: toErrorEnvelope(
      new ValidationError(
        "Invalid discount",
        parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      ),
    ),
  };
}

const isResponse = (value: DiscountInput | AdminResponse): value is AdminResponse =>
  "status" in value;

/** The admin Discounts API (Phase 2): Shopify's discounts over Promotions + Coupons. */
export function discountsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/discounts",
      version: 1,
      permission: "promotions:read",
      summary:
        "List discounts (Shopify tabs: all, active, scheduled, expired; search by title or code)",
      schema: { querystring: listQuery },
      handle: ({ query, context }) =>
        admin.discounts.list(context.principal, {
          tenantId: context.tenantId,
          view: query.view ?? "all",
          ...(query.q === undefined ? {} : { q: query.q }),
          ...(query.first === undefined ? {} : { first: query.first }),
          ...(query.after === undefined ? {} : { after: query.after }),
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/discounts/:discountId",
      version: 1,
      permission: "promotions:read",
      summary: "Get a discount",
      schema: { params: discountIdParams },
      handle: ({ params, context }) =>
        admin.discounts.get(context.principal, {
          tenantId: context.tenantId,
          discountId: params.discountId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/discounts",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Create a discount (code or automatic)",
      schema: { body: z.unknown() },
      handle: ({ body, context }) => {
        const input = parseInput(body);
        if (isResponse(input)) return Promise.resolve(input);
        return admin.discounts.create(context.principal, { tenantId: context.tenantId, input });
      },
    }),
    defineRoute({
      method: "PUT",
      path: "/discounts/:discountId",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Edit a discount (its type and method cannot change)",
      schema: { params: discountIdParams, body: z.unknown() },
      handle: ({ params, body, context }) => {
        const input = parseInput(body);
        if (isResponse(input)) return Promise.resolve(input);
        return admin.discounts.update(context.principal, {
          tenantId: context.tenantId,
          discountId: params.discountId,
          input,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/discounts/:discountId/deactivate",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Deactivate a discount",
      schema: { params: discountIdParams },
      handle: ({ params, context }) =>
        admin.discounts.deactivate(context.principal, {
          tenantId: context.tenantId,
          discountId: params.discountId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/discounts/:discountId/activate",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Reactivate a deactivated discount",
      schema: { params: discountIdParams },
      handle: ({ params, context }) =>
        admin.discounts.activate(context.principal, {
          tenantId: context.tenantId,
          discountId: params.discountId,
        }),
    }),
    defineRoute({
      method: "DELETE",
      path: "/discounts/:discountId",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Delete a discount",
      schema: { params: discountIdParams },
      handle: ({ params, context }) =>
        admin.discounts.remove(context.principal, {
          tenantId: context.tenantId,
          discountId: params.discountId,
        }),
    }),
  ];
}
