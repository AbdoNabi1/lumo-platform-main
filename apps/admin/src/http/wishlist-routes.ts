import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Wishlist } from "@platform/wishlist";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});
const createWishlistBody = z.object({ customerRef: z.string().min(1) });
const wishlistIdParams = z.object({ wishlistId: z.string().min(1) });
const customerRefParams = z.object({ customerRef: z.string().min(1) });
const advanceWishlistBody = z.object({ toStatus: z.enum(["active", "archived"]) });
const wishlistItemBody = z.object({ productRef: z.string().min(1) });

export interface WishlistItemDto {
  readonly productRef: string;
  readonly addedAt: string;
  readonly shareToken: string | null;
}

export interface WishlistDto {
  readonly id: string;
  readonly customerRef: string;
  readonly status: string;
  readonly items: readonly WishlistItemDto[];
}

function toWishlistDto(wishlist: Wishlist): WishlistDto {
  return {
    id: wishlist.id.toString(),
    customerRef: wishlist.customerRef,
    status: wishlist.status.value,
    items: wishlist.items.map((item) => ({
      productRef: item.productRef,
      addedAt: item.addedAt.toISOString(),
      shareToken: item.shareToken ?? null,
    })),
  };
}

/** The Wishlist admin HTTP surface (Sprint S1). Pure delegation. */
export function wishlistRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/wishlists",
      version: 1,
      permission: "wishlist:create",
      idempotent: true,
      summary: "Create a wishlist for a customer",
      schema: { body: createWishlistBody },
      handle: ({ body, context }) => admin.wishlist.create(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/wishlists/:wishlistId/transitions",
      version: 1,
      permission: "wishlist:advance",
      idempotent: true,
      summary: "Advance a wishlist's status (archive/reactivate)",
      schema: { params: wishlistIdParams, body: advanceWishlistBody },
      handle: ({ params, body, context }) =>
        admin.wishlist.advance(context.principal, { wishlistId: params.wishlistId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/wishlists/:wishlistId/items",
      version: 1,
      permission: "wishlist:add-item",
      idempotent: true,
      summary: "Add a product to the wishlist",
      schema: { params: wishlistIdParams, body: wishlistItemBody },
      handle: ({ params, body, context }) =>
        admin.wishlist.addItem(context.principal, { wishlistId: params.wishlistId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/wishlists/:wishlistId/items/remove",
      version: 1,
      permission: "wishlist:remove-item",
      idempotent: true,
      summary: "Remove a product from the wishlist",
      schema: { params: wishlistIdParams, body: wishlistItemBody },
      handle: ({ params, body, context }) =>
        admin.wishlist.removeItem(context.principal, { wishlistId: params.wishlistId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/wishlists/:wishlistId/items/share",
      version: 1,
      permission: "wishlist:share-item",
      idempotent: true,
      summary: "Generate (or replay) a share token for a wishlist item",
      schema: { params: wishlistIdParams, body: wishlistItemBody },
      handle: ({ params, body, context }) =>
        admin.wishlist.shareItem(context.principal, { wishlistId: params.wishlistId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/wishlists/:wishlistId/items/move-to-cart",
      version: 1,
      permission: "wishlist:move-item-to-cart",
      idempotent: true,
      summary: "Move a wishlist item to the customer's cart",
      schema: { params: wishlistIdParams, body: wishlistItemBody },
      handle: ({ params, body, context }) =>
        admin.wishlist.moveItemToCart(context.principal, {
          wishlistId: params.wishlistId,
          ...body,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/wishlists",
      version: 1,
      permission: "wishlist:read",
      summary: "List wishlists (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.wishlist.list(context.principal, query), toWishlistDto),
    }),
    defineRoute({
      method: "GET",
      path: "/wishlists/by-customer/:customerRef",
      version: 1,
      permission: "wishlist:read",
      summary: "Get the wishlist owned by one customer (at most one per customer)",
      schema: { params: customerRefParams },
      handle: async ({ params, context }) => {
        const response = await admin.wishlist.getByCustomer(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toWishlistDto(response.body as Wishlist) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/wishlists/:wishlistId",
      version: 1,
      permission: "wishlist:read",
      summary: "Get one wishlist by id",
      schema: { params: wishlistIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.wishlist.get(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toWishlistDto(response.body as Wishlist) };
      },
    }),
  ] as readonly RouteDefinition[];
}
