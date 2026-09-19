import { z } from "zod";
import { defineRoute, type RequestContext, type RouteDefinition } from "@platform/http";
import type { Cart, CartStatus } from "@platform/cart";
import { logger, NotFoundError, toErrorEnvelope, ValidationError } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { PageResponse } from "./public-catalog-routes";
import { resolvePrice, priceUnresolvedResponse } from "./pricing-resolution";

const cartIdParams = z.object({ cartId: z.string().min(1) });
/**
 * H-05 (audit): `sessionRef` is `requireOwnedCart`'s sole proof of cart ownership (below) — it
 * used to be a required *querystring* field on both GET routes, which put it in `request.url`
 * (and therefore in `onResponse`'s request log, verbatim — see packages/http/src/server.ts's own
 * H-05 fix — and in any reverse-proxy/CDN access log in front of this service, neither of which
 * this codebase controls the retention of). Now optional here: `resolveSessionRef` below prefers
 * the `x-cart-session` header (apps/storefront/src/lib/runtime-api.ts sends it there) and falls
 * back to this querystring field, with a deprecation warning, only for a caller still on the old
 * contract. Drop this field once nothing sends it anymore.
 */
const sessionRefQuery = z.object({ sessionRef: z.string().min(1).optional() });

/**
 * H-05 (audit): resolves the caller's `sessionRef` from the `x-cart-session` header first
 * (never logged, never in a URL); the querystring is a deprecated fallback, logged once per
 * request so the cutover to zero remaining callers is observable rather than assumed. Throws
 * `ValidationError` (422, same shape zod's own boundary failures produce) when neither is present
 * — this is a REQUIRED proof-of-ownership field, not an optional one; only its transport moved.
 */
export function resolveSessionRef(context: RequestContext, queryValue: string | undefined): string {
  const header = context.headers?.["x-cart-session"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (headerValue !== undefined && headerValue.length > 0) return headerValue;
  if (queryValue !== undefined && queryValue.length > 0) {
    logger.warn("public cart route: sessionRef read from the deprecated querystring field", {
      requestId: context.requestId,
    });
    return queryValue;
  }
  throw new ValidationError("sessionRef is required (x-cart-session header)", [
    { field: "sessionRef", message: "Required" },
  ]);
}

/** `sessionRef` is the caller's proof of ownership everywhere below — never `customerRef`, never trusted from anywhere but this field. */
const createCartBody = z.object({
  sessionRef: z.string().min(1),
  currency: z.string().length(3),
});
/**
 * `unitPriceAmountMinor`/`currency` are deliberately NOT accepted here (H-01 remediation, Phase
 * 17.1 security follow-up). They used to be — the caller's own submitted amount was trusted
 * verbatim into the cart line. `.strict()` means an old-shaped request carrying either field now
 * fails zod validation (422) at the Fastify boundary rather than having them silently stripped;
 * the handler below also never reads them off `body` even when invoked directly (bypassing zod,
 * as `public-cart-routes.test.ts` does) — the price is always resolved server-side, see
 * {@link resolvePrice}.
 */
const addItemBody = z
  .object({
    sessionRef: z.string().min(1),
    productId: z.string().min(1),
    quantity: z.number().int().positive(),
    inventoryAvailable: z.number().int().min(0).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
const changeQuantityBody = z.object({
  sessionRef: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});
const removeItemBody = z.object({ sessionRef: z.string().min(1), productId: z.string().min(1) });
const sessionRefOnlyBody = z.object({ sessionRef: z.string().min(1) });

/**
 * The public, unauthenticated Cart surface (Phase 17.1 — Guest Cart Foundation). Mounted the same
 * way `public-catalog-routes.ts` is: same Runtime Gateway, `public: true` so the pipeline skips
 * authentication and the permission guard, `admin.publicReads.cart` (the raw, unguarded
 * `CartController` — see its doc comment in `composition.ts`) rather than the guarded
 * `CartAdminController`, which requires an admin `Principal` a storefront shopper will never have.
 *
 * **This file previously documented itself as read-only "by construction" and said it would never
 * grow a write route** (Productization Phase 3) — that was true only because no customer-facing
 * write transport/auth model existed yet. Phase 17.1 builds exactly that model: `sessionRef` is a
 * server-issued (Next.js, `apps/storefront/src/app/actions.ts`), unguessable, HttpOnly-cookie-backed
 * opaque identifier — never accepted from a browser directly (the browser only ever talks to the
 * storefront's own server, which is the one caller of this Runtime API). Every route below either
 * derives ownership from `sessionRef` at creation (`POST /public/carts`, `GET /public/carts/current`)
 * or enforces `sessionRef === cart.sessionRef` via {@link requireOwnedCart} before executing any
 * mutation or read of an existing cart (`GET /public/carts/:cartId` and every `POST` mutation route).
 * A mismatch or a cart from another tenant/session resolves to the SAME 404 an unknown cart id would
 * — this route never reveals whether a cart exists to a caller who cannot prove ownership of it.
 *
 * Only Cart's guest-safe surface is exposed: create / read (by id or "current") / add item / change
 * quantity / remove item / clear. `lock`/`unlock`/`checkout`/`expire`/`abandon`/`save`/`restore`/
 * `merge`/`replaceVariant`/`assignCustomer` stay admin-only (`cart-routes.ts`) — none of them are a
 * guest-cart requirement for this phase (login-merge, checkout, and cart-locking are explicitly out
 * of scope; see the Phase 17.1 report).
 *
 * Tenant isolation is unchanged from every other route: `PrismaCartRepository`/
 * `InMemoryCartRepository` already scope every lookup by the resolved tenant (ADR-0008), so a cart
 * from another tenant resolves to 404, exactly like a cross-tenant product or order would.
 *
 * Domain aggregates are never put on the wire (same rule as `public-catalog-routes.ts`) — `Cart`
 * is projected to `PublicCartDto` below before it reaches any handler's return value.
 */

export interface PublicCartItemDto {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
  readonly lineTotalAmountMinor: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PublicCartDto {
  readonly id: string;
  readonly status: CartStatus;
  readonly currency: string;
  readonly isGuest: boolean;
  readonly items: readonly PublicCartItemDto[];
  readonly subtotalAmountMinor: number;
}

/**
 * Public cart projection — no `customerRef`/`sessionRef` (the caller already knows its own; echoing
 * them back to an anonymous route serves no rendering need) and no `inventoryAvailable` snapshot
 * (Sprint 4.5's own rationale for withholding live-adjacent inventory data from public routes —
 * see `toInventoryDto` — applies here too; the Cart UI shows the price/quantity it already has,
 * not a stock claim). `totalAmount()` is Cart's own pre-existing subtotal-of-snapshots method
 * (Sprint 4.5), not a recomputed or checkout total.
 */
function toCartDto(cart: Cart): PublicCartDto {
  return {
    id: cart.id.toString(),
    status: cart.status,
    currency: cart.currency,
    isGuest: cart.isGuest,
    items: cart.items.map((item) => ({
      productId: item.productRef.value,
      quantity: item.quantity.value,
      unitPriceAmountMinor: item.unitPrice.amountMinor,
      currency: item.unitPrice.currency,
      lineTotalAmountMinor: item.lineTotal.amountMinor,
      metadata: item.metadata,
    })),
    subtotalAmountMinor: cart.totalAmount().amountMinor,
  };
}

/** Projects a single-item (non-paginated) controller response through `toDto`, same non-2xx passthrough rule as `mapPage`. */
function mapItem<TAggregate, TDto>(
  response: PageResponse,
  toDto: (aggregate: TAggregate) => TDto,
): PageResponse {
  if (response.status < 200 || response.status >= 300) return response;
  return { status: response.status, body: toDto(response.body as TAggregate) };
}

/** The identical envelope `GET /public/carts/:cartId` already returns for an unknown id — reused so a cross-owned cart is byte-for-byte indistinguishable from one that doesn't exist. */
function notFoundResponse(): PageResponse {
  return { status: 404, body: toErrorEnvelope(new NotFoundError("Cart not found")) };
}

/**
 * THE single ownership check every guest read/mutation route runs before touching a cart (Task 3 —
 * "one authoritative helper/policy over five slightly different implementations"). Loads the cart
 * via the same unguarded `CartController.get()` every route already has, then requires
 * `cart.sessionRef === sessionRef` — never the cart id, never a client-supplied `customerRef`, never
 * RBAC (the `Permission = string` / `authorize(principal, permission)` contract has no concept of
 * "this principal owns this resource" to lean on here). An unknown cart id and a cart owned by a
 * different session produce the exact same {@link notFoundResponse} — existence is never leaked.
 */
async function requireOwnedCart(
  admin: WiredAdmin,
  cartId: string,
  sessionRef: string,
  tenantId: string,
): Promise<
  | { readonly ok: true; readonly cart: Cart }
  | { readonly ok: false; readonly response: PageResponse }
> {
  const response = await admin.publicReads.cart.get({ tenantId, cartId });
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, response };
  }
  const cart = response.body as Cart;
  if (cart.sessionRef !== sessionRef) {
    return { ok: false, response: notFoundResponse() };
  }
  return { ok: true, cart };
}

export function publicCartRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/public/carts/current",
      version: 1,
      permission: "cart:read",
      public: true,
      summary: "Public: get the caller's current cart for its session (clean empty state if none)",
      schema: { querystring: sessionRefQuery },
      handle: async ({ query, context }) => {
        const sessionRef = resolveSessionRef(context, query.sessionRef);
        const response = await admin.publicReads.cart.getCurrent({
          tenantId: context.tenantId,
          sessionRef,
        });
        if (response.status < 200 || response.status >= 300) return response;
        const cart = response.body as Cart | null;
        return { status: 200, body: { cart: cart === null ? null : toCartDto(cart) } };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/carts/:cartId",
      version: 1,
      permission: "cart:read",
      public: true,
      summary: "Public: get a single cart the caller's session owns",
      schema: { params: cartIdParams, querystring: sessionRefQuery },
      handle: async ({ params, query, context }) => {
        const sessionRef = resolveSessionRef(context, query.sessionRef);
        const owned = await requireOwnedCart(admin, params.cartId, sessionRef, context.tenantId);
        if (!owned.ok) return owned.response;
        return { status: 200, body: toCartDto(owned.cart) };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/carts",
      version: 1,
      permission: "cart:create",
      public: true,
      idempotent: true,
      summary: "Public: open a new guest cart for the caller's session",
      schema: { body: createCartBody },
      handle: async ({ body, context }) => {
        const created = await admin.publicReads.cart.create({
          tenantId: context.tenantId,
          sessionRef: body.sessionRef,
          currency: body.currency,
        });
        if (created.status < 200 || created.status >= 300) return created;
        const { cartId } = created.body as { cartId: string };
        const projected = mapItem<Cart, PublicCartDto>(
          await admin.publicReads.cart.get({ tenantId: context.tenantId, cartId }),
          toCartDto,
        );
        return projected.status === 200 ? { status: 201, body: projected.body } : projected;
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/carts/:cartId/items",
      version: 1,
      permission: "cart:add_item",
      public: true,
      summary: "Public: add an item to the caller's own guest cart",
      schema: { params: cartIdParams, body: addItemBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedCart(
          admin,
          params.cartId,
          body.sessionRef,
          context.tenantId,
        );
        if (!owned.ok) return owned.response;
        const price = await resolvePrice(admin, body.productId, context.tenantId);
        if (price.status !== "ok") return priceUnresolvedResponse();
        const result = await admin.publicReads.cart.add({
          tenantId: context.tenantId,
          cartId: params.cartId,
          productId: body.productId,
          quantity: body.quantity,
          unitPriceAmountMinor: price.amountMinor,
          currency: price.currency,
          inventoryAvailable: body.inventoryAvailable,
          metadata: body.metadata,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapItem<Cart, PublicCartDto>(
          await admin.publicReads.cart.get({ ...params, tenantId: context.tenantId }),
          toCartDto,
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/carts/:cartId/items/quantity",
      version: 1,
      permission: "cart:change_quantity",
      public: true,
      idempotent: true,
      summary: "Public: change a line's quantity in the caller's own guest cart",
      schema: { params: cartIdParams, body: changeQuantityBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedCart(
          admin,
          params.cartId,
          body.sessionRef,
          context.tenantId,
        );
        if (!owned.ok) return owned.response;
        const result = await admin.publicReads.cart.changeQuantity({
          tenantId: context.tenantId,
          cartId: params.cartId,
          productId: body.productId,
          quantity: body.quantity,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapItem<Cart, PublicCartDto>(
          await admin.publicReads.cart.get({ ...params, tenantId: context.tenantId }),
          toCartDto,
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/carts/:cartId/items/remove",
      version: 1,
      permission: "cart:remove_item",
      public: true,
      idempotent: true,
      summary: "Public: remove a line from the caller's own guest cart",
      schema: { params: cartIdParams, body: removeItemBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedCart(
          admin,
          params.cartId,
          body.sessionRef,
          context.tenantId,
        );
        if (!owned.ok) return owned.response;
        const result = await admin.publicReads.cart.remove({
          tenantId: context.tenantId,
          cartId: params.cartId,
          productId: body.productId,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapItem<Cart, PublicCartDto>(
          await admin.publicReads.cart.get({ ...params, tenantId: context.tenantId }),
          toCartDto,
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/carts/:cartId/clear",
      version: 1,
      permission: "cart:clear",
      public: true,
      idempotent: true,
      summary: "Public: clear all lines from the caller's own guest cart",
      schema: { params: cartIdParams, body: sessionRefOnlyBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedCart(
          admin,
          params.cartId,
          body.sessionRef,
          context.tenantId,
        );
        if (!owned.ok) return owned.response;
        const result = await admin.publicReads.cart.clear({
          tenantId: context.tenantId,
          cartId: params.cartId,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapItem<Cart, PublicCartDto>(
          await admin.publicReads.cart.get({ ...params, tenantId: context.tenantId }),
          toCartDto,
        );
      },
    }),
  ] as readonly RouteDefinition[];
}
