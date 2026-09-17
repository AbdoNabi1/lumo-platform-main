import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Cart } from "@platform/cart";
import type { Wishlist } from "@platform/wishlist";
import { NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { PageResponse } from "./public-catalog-routes";
import { resolveCustomerSessionId } from "./public-auth-routes";
import { priceUnresolvedResponse, resolvePrice } from "./pricing-resolution";

/**
 * The **customer's own wishlist** surface (T5.17 Part B) — the first feature built on the customer
 * authentication foundation Part A established, and the proof that it works.
 *
 * Mounted the same way as every other `public/*-routes.ts` file, and reaching the domain through
 * `admin.publicReads.wishlist` (the raw, unguarded `WishlistController`) rather than the guarded
 * `WishlistAdminController` — the same reasoning `public-reviews-routes.ts` documents for Reviews:
 * calling the guarded controller would require fabricating a `Principal`, which silently allows
 * everything under `AllowAllAccessControl` and silently denies everything under Keto.
 *
 * But unlike Reviews' display surface, **nothing here is anonymous.** Every route runs
 * `admin.customerAuth.requireSession(...)` first and fails closed with `CustomerGuard`'s shared 401.
 * `public: true` means only that the *admin* Bearer/RBAC pipeline does not apply.
 *
 * ── The one rule this whole file exists to enforce ──
 * **The `customerRef` is ALWAYS the session's.** `wishlist-routes.ts` takes it from the request
 * (`createWishlistBody`, `customerRefParams`) because an operator legitimately acts on behalf of any
 * customer. Here that would be a horizontal-privilege-escalation hole: anyone with an account could
 * read or edit anyone else's wishlist by changing a string. So no schema below has a `customerRef`
 * field at all, and — critically — **no route below accepts a `wishlistId` either.** The wishlist is
 * always re-resolved from the session's `customerRef` via `findByCustomerRef` on every single
 * request ({@link requireOwnWishlist}), so there is no id for a caller to tamper with and no
 * ownership check that could be forgotten. A customer has at most one wishlist
 * (`@@unique([tenantId, customerRef])`), which is what makes this possible.
 */

const productRefBody = z.object({ productRef: z.string().min(1) }).strict();

/**
 * Moving an item to the cart additionally needs proof of CART ownership. `sessionRef` is the guest
 * cart token — the same proof `public-cart-routes.ts` requires — because a customer's cart is still
 * resolved by `sessionRef` today (see the `moveToCart` route's comment on the repository gap).
 */
const moveToCartBody = z
  .object({ productRef: z.string().min(1), sessionRef: z.string().min(1) })
  .strict();

export interface PublicWishlistItemDto {
  readonly productRef: string;
  readonly addedAt: string;
  /** `null` until the owner generates one. Present only on the owner's own wishlist (this surface). */
  readonly shareToken: string | null;
}

/**
 * The customer's own wishlist projection. `customerRef` is deliberately omitted — same reasoning as
 * `PublicCartDto`: the caller cannot be anyone else here, so echoing their own id back serves no
 * rendering need, and a DTO that never carries it cannot leak it into a log, a cache key, or a
 * client-side store that later gets sent back as input.
 */
export interface PublicWishlistDto {
  readonly id: string;
  readonly status: string;
  readonly items: readonly PublicWishlistItemDto[];
}

function toPublicWishlistDto(wishlist: Wishlist): PublicWishlistDto {
  return {
    id: wishlist.id.toString(),
    status: wishlist.status.value,
    items: wishlist.items.map((item) => ({
      productRef: item.productRef,
      addedAt: item.addedAt.toISOString(),
      shareToken: item.shareToken ?? null,
    })),
  };
}

function wishlistNotFound(): PageResponse {
  return { status: 404, body: toErrorEnvelope(new NotFoundError("Wishlist not found")) };
}

/**
 * Resolves the signed-in customer's own wishlist, **creating it on first access**. A customer has at
 * most one wishlist, and an account that has simply never used the feature is not an error state —
 * so `GET` returns an empty wishlist rather than a 404 the UI would have to special-case.
 *
 * Creation is racy-safe by construction: `CreateWishlist` refuses a second wishlist for the same
 * customer with a 409 (`ConflictError`), so if two concurrent requests both see "none", the loser's
 * create fails and the re-read below returns the winner's wishlist. That is why this re-reads after
 * creating rather than trusting its own create response.
 */
async function requireOwnWishlist(
  admin: WiredAdmin,
  customerRef: string,
  tenantId: string,
  createIfMissing: boolean,
): Promise<
  | { readonly ok: true; readonly wishlist: Wishlist }
  | { readonly ok: false; readonly response: PageResponse }
> {
  const existing = await admin.publicReads.wishlist.getByCustomer({ customerRef, tenantId });
  if (existing.status >= 200 && existing.status < 300) {
    return { ok: true, wishlist: existing.body as Wishlist };
  }
  if (!createIfMissing) return { ok: false, response: wishlistNotFound() };

  await admin.publicReads.wishlist.create({ customerRef, tenantId });
  const created = await admin.publicReads.wishlist.getByCustomer({ customerRef, tenantId });
  if (created.status < 200 || created.status >= 300) {
    return { ok: false, response: created };
  }
  return { ok: true, wishlist: created.body as Wishlist };
}

export function publicWishlistRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  /**
   * Every route's opening move: resolve the session, then resolve THAT customer's own wishlist.
   * Written once so no route can accidentally skip either half.
   */
  const own = async (
    context: Parameters<typeof resolveCustomerSessionId>[0],
    createIfMissing: boolean,
  ): Promise<
    | { readonly ok: true; readonly wishlist: Wishlist; readonly customerRef: string }
    | { readonly ok: false; readonly response: PageResponse }
  > => {
    const guarded = await admin.customerAuth.requireSession(
      resolveCustomerSessionId(context),
      context.tenantId,
    );
    if (!guarded.ok) return { ok: false, response: guarded.response };
    const wishlist = await requireOwnWishlist(
      admin,
      guarded.session.customerRef,
      context.tenantId,
      createIfMissing,
    );
    if (!wishlist.ok) return wishlist;
    return { ok: true, wishlist: wishlist.wishlist, customerRef: guarded.session.customerRef };
  };

  /** Re-reads and projects the wishlist after a mutation, so a caller never has to re-fetch. */
  const reread = async (customerRef: string, tenantId: string): Promise<PageResponse> => {
    const response = await admin.publicReads.wishlist.getByCustomer({ customerRef, tenantId });
    if (response.status < 200 || response.status >= 300) return response;
    return { status: 200, body: toPublicWishlistDto(response.body as Wishlist) };
  };

  return [
    defineRoute({
      method: "GET",
      path: "/public/wishlists/me",
      version: 1,
      permission: "wishlist:read",
      public: true,
      summary: "Public: the signed-in customer's own wishlist (created on first access)",
      schema: {},
      handle: async ({ context }) => {
        const resolved = await own(context, true);
        if (!resolved.ok) return resolved.response;
        return { status: 200, body: toPublicWishlistDto(resolved.wishlist) };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/wishlists/me/items",
      version: 1,
      permission: "wishlist:add-item",
      public: true,
      idempotent: true,
      summary: "Public: add a product to the signed-in customer's own wishlist",
      schema: { body: productRefBody },
      handle: async ({ body, context }) => {
        const resolved = await own(context, true);
        if (!resolved.ok) return resolved.response;

        const added = await admin.publicReads.wishlist.addItem({
          wishlistId: resolved.wishlist.id.toString(),
          productRef: body.productRef,
          tenantId: context.tenantId,
        });
        if (added.status < 200 || added.status >= 300) return added;
        return reread(resolved.customerRef, context.tenantId);
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/wishlists/me/items/remove",
      version: 1,
      permission: "wishlist:remove-item",
      public: true,
      idempotent: true,
      summary: "Public: remove a product from the signed-in customer's own wishlist",
      schema: { body: productRefBody },
      handle: async ({ body, context }) => {
        // `createIfMissing: false` — removing from a wishlist that does not exist is a 404, not a
        // reason to create one. Only reads and adds bring a wishlist into being.
        const resolved = await own(context, false);
        if (!resolved.ok) return resolved.response;

        const removed = await admin.publicReads.wishlist.removeItem({
          wishlistId: resolved.wishlist.id.toString(),
          productRef: body.productRef,
          tenantId: context.tenantId,
        });
        if (removed.status < 200 || removed.status >= 300) return removed;
        return reread(resolved.customerRef, context.tenantId);
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/wishlists/me/items/share",
      version: 1,
      permission: "wishlist:share-item",
      public: true,
      idempotent: true,
      summary: "Public: generate (or replay) a share token for one of the customer's own items",
      schema: { body: productRefBody },
      /**
       * `ShareWishlistItem` is idempotent in the domain — it replays the item's existing token
       * rather than minting a second one — so re-sharing never invalidates a link already given out.
       *
       * **No route resolves a share token, and that is not an oversight.** The Wishlist context has
       * no capability to look one up: `WishlistRepository` exposes `save`/`findById`/
       * `findByCustomerRef`/`list` only, with no `findByShareToken`, and no use case takes a token as
       * input (verified by reading `wishlist-repository.ts` and `wishlist.use-cases.ts`). A token can
       * be minted and shown to its owner but not yet redeemed by a recipient. Building the redeem
       * side needs a new repository method + use case in `services/wishlist`, recorded in
       * `docs/plans/BLOCKERS.md`'s T5.17 entry. Returning the token here is still useful and honest —
       * it is real, persisted, and stable — but the storefront must not imply a working share link.
       */
      handle: async ({ body, context }) => {
        const resolved = await own(context, false);
        if (!resolved.ok) return resolved.response;

        const shared = await admin.publicReads.wishlist.shareItem({
          wishlistId: resolved.wishlist.id.toString(),
          productRef: body.productRef,
          tenantId: context.tenantId,
        });
        if (shared.status < 200 || shared.status >= 300) return shared;

        const { shareToken } = shared.body as { shareToken: string };
        const projected = await reread(resolved.customerRef, context.tenantId);
        if (projected.status !== 200) return projected;
        return { status: 200, body: { ...(projected.body as PublicWishlistDto), shareToken } };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/wishlists/me/items/move-to-cart",
      version: 1,
      permission: "wishlist:move-item-to-cart",
      public: true,
      idempotent: true,
      summary: "Public: move one of the customer's own wishlist items into their cart",
      schema: { body: moveToCartBody },
      /**
       * **Deliberately does NOT call `MoveWishlistItemToCart`**, even though that use case exists and
       * does exactly this in name. Wishlist reaches Cart through `CartPort`, and `wireWishlist` in
       * `composition.ts` is given no `cart` adapter, so the port resolves to `InMemoryCartPort` — a
       * stub that pushes `{customerRef, productRef}` onto an in-process array and touches no cart at
       * all. Routing this through the use case would remove the item from the wishlist and add
       * nothing to any real cart: the shopper would watch an item vanish and their cart stay empty,
       * while the API reported success. That is precisely the fabricated round trip this task's
       * rules forbid.
       *
       * So the route composes the two REAL operations instead, in the safe order — add to the cart
       * first, and only remove from the wishlist once the add has actually succeeded, so a failure
       * leaves the item where it was rather than losing it. `resolvePrice` re-derives the price
       * server-side (H-01: no caller ever chooses a cart line's price), reusing the same helper
       * `public-cart-routes.ts` uses.
       *
       * Cart ownership is proven by `sessionRef` exactly as every other public cart route proves it,
       * because a customer's cart is still keyed by `sessionRef`: `CartRepository` has no
       * `findByCustomerRef`. Both that gap and the missing `CartPort` adapter are recorded in
       * `docs/plans/BLOCKERS.md`'s T5.17 entry.
       */
      handle: async ({ body, context }) => {
        const resolved = await own(context, false);
        if (!resolved.ok) return resolved.response;

        const current = await admin.publicReads.cart.getCurrent({ sessionRef: body.sessionRef });
        if (current.status < 200 || current.status >= 300) return current;
        const cart = current.body as Cart | null;
        if (cart === null) {
          return { status: 404, body: toErrorEnvelope(new NotFoundError("Cart not found")) };
        }

        const price = await resolvePrice(admin, body.productRef);
        if (price.status !== "ok") return priceUnresolvedResponse();

        const added = await admin.publicReads.cart.add({
          cartId: cart.id.toString(),
          productId: body.productRef,
          quantity: 1,
          unitPriceAmountMinor: price.amountMinor,
          currency: price.currency,
        });
        if (added.status < 200 || added.status >= 300) return added;

        const removed = await admin.publicReads.wishlist.removeItem({
          wishlistId: resolved.wishlist.id.toString(),
          productRef: body.productRef,
          tenantId: context.tenantId,
        });
        if (removed.status < 200 || removed.status >= 300) return removed;
        return reread(resolved.customerRef, context.tenantId);
      },
    }),
  ] as readonly RouteDefinition[];
}
