import { z } from "zod";
import type { Cart } from "@platform/cart";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { mapPage } from "./public-catalog-routes";
import { resolvePrice, priceUnresolvedResponse } from "./pricing-resolution";

const createCartBody = z.object({
  customerRef: z.string().min(1).optional(),
  sessionRef: z.string().min(1),
  currency: z.string().length(3),
});
const cartIdParams = z.object({ cartId: z.string().min(1) });
const cartStatusEnum = z.enum(["active", "checked_out", "abandoned", "locked", "saved", "expired"]);
const cartListQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
  status: cartStatusEnum.optional(),
});

export interface CartItemDto {
  readonly productRef: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
  readonly lineTotalAmountMinor: number;
  readonly inventoryAvailable: number | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
}

export interface CartDto {
  readonly id: string;
  readonly customerRef: string | null;
  readonly sessionRef: string;
  readonly status: string;
  readonly currency: string;
  readonly isGuest: boolean;
  readonly items: readonly CartItemDto[];
  readonly subtotalAmountMinor: number;
}

/**
 * Admin cart projection — unlike the public `PublicCartDto` (`public-cart-routes.ts`), this
 * includes `customerRef`/`sessionRef`: the operator's abandoned-cart recovery workflow needs them
 * to reach the customer, whereas an anonymous caller already knows its own.
 */
function toCartDto(cart: Cart): CartDto {
  return {
    id: cart.id.toString(),
    customerRef: cart.customerRef ?? null,
    sessionRef: cart.sessionRef,
    status: cart.status,
    currency: cart.currency,
    isGuest: cart.isGuest,
    items: cart.items.map((item) => ({
      productRef: item.productRef.value,
      quantity: item.quantity.value,
      unitPriceAmountMinor: item.unitPrice.amountMinor,
      currency: item.unitPrice.currency,
      lineTotalAmountMinor: item.lineTotal.amountMinor,
      inventoryAvailable: item.inventoryAvailable ?? null,
      metadata: item.metadata ?? null,
    })),
    subtotalAmountMinor: cart.totalAmount().amountMinor,
  };
}
/**
 * `unitPriceAmountMinor`/`currency` are deliberately NOT accepted here (Phase 17.2 security
 * follow-up to H-01 — same defect on the admin-authenticated surface, same fix). `.strict()` means
 * a request still carrying either field fails zod validation (422) at the boundary; the price is
 * always resolved server-side from Pricing, see {@link resolvePrice} (`./pricing-resolution.ts`).
 */
const addItemBody = z
  .object({
    productId: z.string().min(1),
    quantity: z.number().int().positive(),
    inventoryAvailable: z.number().int().min(0).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
const removeItemBody = z.object({ productId: z.string().min(1) });
const changeQuantityBody = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});
/** Same H-01-style remediation as {@link addItemBody} — `unitPriceAmountMinor`/`currency` are never accepted. */
const replaceVariantBody = z
  .object({
    oldProductId: z.string().min(1),
    newProductId: z.string().min(1),
    quantity: z.number().int().positive(),
    inventoryAvailable: z.number().int().min(0).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
const mergeBody = z.object({ sourceCartId: z.string().min(1) });

/**
 * The Cart admin HTTP surface (Sprint 4.5 — Cart's first HTTP transport, per
 * `SPRINT_4_5_CART_CORE_REPORT.md` §2: "new CartAdminController + cart-routes... wired into the
 * admin transport"). Pure delegation — zod validates the boundary, the facade authorizes + audits
 * (AdminGuard), the context owns all behavior.
 */
export function cartRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/carts",
      version: 1,
      permission: "cart:create",
      idempotent: true,
      summary: "Open a new cart (customerRef optional — guest cart)",
      schema: { body: createCartBody },
      handle: ({ body, context }) => admin.cart.create(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/items",
      version: 1,
      permission: "cart:add_item",
      summary: "Add a line to a cart (merges quantity if the product is already present)",
      schema: { params: cartIdParams, body: addItemBody },
      handle: async ({ params, body, context }): Promise<AdminResponse> => {
        const price = await resolvePrice(admin, body.productId, context.tenantId);
        if (price.status !== "ok") return priceUnresolvedResponse();
        return admin.cart.addItem(context.principal, {
          cartId: params.cartId,
          ...body,
          unitPriceAmountMinor: price.amountMinor,
          currency: price.currency,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/items/remove",
      version: 1,
      permission: "cart:remove_item",
      idempotent: true,
      summary: "Remove a line from a cart",
      schema: { params: cartIdParams, body: removeItemBody },
      handle: ({ params, body, context }) =>
        admin.cart.removeItem(context.principal, { cartId: params.cartId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/items/quantity",
      version: 1,
      permission: "cart:change_quantity",
      idempotent: true,
      summary: "Change a line's quantity",
      schema: { params: cartIdParams, body: changeQuantityBody },
      handle: ({ params, body, context }) =>
        admin.cart.changeItemQuantity(context.principal, { cartId: params.cartId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/items/replace",
      version: 1,
      permission: "cart:replace_variant",
      summary: "Replace a line's product (e.g. a different variant)",
      schema: { params: cartIdParams, body: replaceVariantBody },
      handle: async ({ params, body, context }): Promise<AdminResponse> => {
        const price = await resolvePrice(admin, body.newProductId, context.tenantId);
        if (price.status !== "ok") return priceUnresolvedResponse();
        return admin.cart.replaceVariant(context.principal, {
          cartId: params.cartId,
          ...body,
          unitPriceAmountMinor: price.amountMinor,
          currency: price.currency,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/merge",
      version: 1,
      permission: "cart:merge",
      summary: "Merge a guest cart's lines into this (customer) cart",
      schema: { params: cartIdParams, body: mergeBody },
      handle: ({ params, body, context }) =>
        admin.cart.merge(context.principal, { targetCartId: params.cartId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/lock",
      version: 1,
      permission: "cart:lock",
      idempotent: true,
      summary: "Lock a cart against further modification",
      schema: { params: cartIdParams },
      handle: ({ params, context }) => admin.cart.lock(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/unlock",
      version: 1,
      permission: "cart:unlock",
      idempotent: true,
      summary: "Unlock a previously-locked cart",
      schema: { params: cartIdParams },
      handle: ({ params, context }) => admin.cart.unlock(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/save",
      version: 1,
      permission: "cart:save_for_later",
      idempotent: true,
      summary: "Save an active cart for later",
      schema: { params: cartIdParams },
      handle: ({ params, context }) => admin.cart.saveForLater(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/restore",
      version: 1,
      permission: "cart:restore",
      idempotent: true,
      summary: "Restore a saved cart back to active",
      schema: { params: cartIdParams },
      handle: ({ params, context }) => admin.cart.restore(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/expire",
      version: 1,
      permission: "cart:expire",
      idempotent: true,
      summary: "Expire a still-live cart",
      schema: { params: cartIdParams },
      handle: ({ params, context }) => admin.cart.expire(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/clear",
      version: 1,
      permission: "cart:clear",
      idempotent: true,
      summary: "Clear all lines from an active cart",
      schema: { params: cartIdParams },
      handle: ({ params, context }) => admin.cart.clear(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/checkout",
      version: 1,
      permission: "cart:checkout",
      idempotent: true,
      summary: "Check out a cart",
      schema: { params: cartIdParams },
      handle: ({ params, context }) => admin.cart.checkOut(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/carts/:cartId/abandon",
      version: 1,
      permission: "cart:abandon",
      idempotent: true,
      summary: "Abandon an active cart",
      schema: { params: cartIdParams },
      handle: ({ params, context }) => admin.cart.abandon(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/carts",
      version: 1,
      permission: "cart:read",
      summary:
        "List carts (cursor pagination; an optional status filter is abandoned-cart recovery)",
      schema: { querystring: cartListQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.cart.list(context.principal, query), toCartDto),
    }),
    defineRoute({
      method: "GET",
      path: "/carts/:cartId",
      version: 1,
      permission: "cart:read",
      summary: "Get one cart by id",
      schema: { params: cartIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.cart.get(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toCartDto(response.body as Cart) };
      },
    }),
  ] as readonly RouteDefinition[];
}
