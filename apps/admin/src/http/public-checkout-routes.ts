import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Cart } from "@platform/cart";
import { CheckoutSession, type CheckoutAddress } from "@platform/checkout";
import { NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { resolveSessionRef } from "./public-cart-routes";

const checkoutSessionIdParams = z.object({ checkoutSessionId: z.string().min(1) });
/** Same H-05 rationale as `public-cart-routes.ts`'s identical field — see its doc comment. */
const sessionRefQuery = z.object({ sessionRef: z.string().min(1).optional() });

/** `customerRef` is deliberately NOT accepted — a guest checkout has none, and accepting one here would let a caller attach their session to another person's customer record. */
const startCheckoutBody = z
  .object({
    sessionRef: z.string().min(1),
    cartRef: z.string().min(1),
    currency: z.string().length(3),
  })
  .strict();
/**
 * Mirrors `checkout-routes.ts`'s Phase 17.2 fix: the caller supplies only `cartId`, never line
 * items or prices. The handler re-derives `items` from that Cart's own stored lines, the same way
 * the admin route does.
 */
const itemsBody = z.object({ sessionRef: z.string().min(1), cartId: z.string().min(1) }).strict();
const addressBody = z.object({
  sessionRef: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(1),
});
/** Mirrors `checkout-routes.ts`'s Phase A.1 F-01 fix: the caller supplies only `method`, never a rate — `SelectShipping` re-derives the authoritative rate itself. */
const shippingSelectionBody = z
  .object({ sessionRef: z.string().min(1), method: z.string().min(1) })
  .strict();
const paymentSelectionBody = z.object({
  sessionRef: z.string().min(1),
  paymentMethodRef: z.string().min(1),
  provider: z.string().min(1),
});
const sessionRefOnlyBody = z.object({ sessionRef: z.string().min(1) });
/** See the C-2 note on `completeBody` in `checkout-routes.ts` — the same field, same caveat. */
const completeBody = z.object({
  sessionRef: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

/**
 * The public, unauthenticated Checkout surface (Phase 2 — Public checkout). Mounted the same way
 * `public-cart-routes.ts` is: `public: true` so the pipeline skips authentication and the
 * permission guard, `admin.publicReads.checkout` (the raw, unguarded `CheckoutController` — see its
 * doc comment in `composition.ts`) rather than the guarded `CheckoutAdminController`, which requires
 * an admin `Principal` a shopper will never have.
 *
 * **Ownership model** (identical to `public-cart-routes.ts`, reused verbatim): `sessionRef` is the
 * caller's sole proof of ownership, minted server-side by Next.js and carried in the `x-cart-session`
 * header (never a querystring — H-05) on reads and in the body on writes. Every route below except
 * `POST /public/checkouts` calls {@link requireOwnedSession} first, and a session owned by another
 * `sessionRef` resolves to the SAME 404 an unknown id would — this surface never reveals whether a
 * session exists to a caller who cannot prove they own it.
 *
 * **Exposed surface** — exactly the 12 guest-completable routes below. Deliberately NOT exposed here,
 * left admin-only (`checkout-routes.ts`):
 * - `validate` / `promotion` — reachable through `recalculate` for the guest flow; a guest never
 *   needs to call them directly.
 * - `lock` / `expire` / `fail` — operator/saga actions, not something a shopper triggers.
 * - `order-draft` — exposes internal order construction; a guest never needs to see it (the
 *   confirmation screen renders from the checkout session DTO's `orderRef`/`totals` instead).
 *
 * Do not "complete" this set by adding any of the above without re-reading this reasoning.
 *
 * **Prices, rates, and amounts are never accepted from the caller** — `items` is re-derived from the
 * caller's own cart (mirroring `checkout-routes.ts`'s Phase 17.2 fix) and shipping rates are
 * re-derived from `ShippingCalculationPort` (mirroring its Phase A.1 F-01 fix). See each body
 * schema's own comment.
 *
 * Domain aggregates are never put on the wire (same rule as `public-catalog-routes.ts`/
 * `public-cart-routes.ts`) — `CheckoutSession` is projected to `PublicCheckoutSessionDto` below
 * before it reaches any handler's return value. `sessionRef` is never included in the DTO — echoing
 * the ownership secret back defeats its purpose.
 */

export interface PublicAddressDto {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface PublicCheckoutSessionDto {
  readonly id: string;
  readonly status: string;
  readonly currency: string;
  readonly items: readonly {
    readonly productId: string;
    readonly quantity: number;
    readonly unitPriceAmountMinor: number;
  }[];
  readonly totals: {
    readonly subtotalMinor: number;
    readonly shippingMinor: number;
    readonly taxMinor: number;
    readonly grandTotalMinor: number;
  } | null;
  readonly shippingAddress: PublicAddressDto | null;
  readonly billingAddress: PublicAddressDto | null;
  readonly selectedShippingMethod: string | null;
  readonly orderRef: string | null;
}

function toAddressDto(address: CheckoutAddress): PublicAddressDto {
  return {
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    postalCode: address.postalCode,
    country: address.country,
  };
}

/** Projects a `CheckoutSession` aggregate to its public, fully-primitive wire shape — no `sessionRef`, no `props`/`_id`/`_domainEvents`/`_version`. */
function toPublicCheckoutSessionDto(session: CheckoutSession): PublicCheckoutSessionDto {
  return {
    id: session.id.toString(),
    status: session.state.value,
    currency: session.currency,
    items: session.items.map((item) => ({
      productId: item.productRef,
      quantity: item.quantity,
      unitPriceAmountMinor: item.unitPriceAmountMinor,
    })),
    totals:
      session.totals === undefined
        ? null
        : {
            subtotalMinor: session.totals.subtotalMinor,
            shippingMinor: session.totals.shippingMinor,
            taxMinor: session.totals.taxMinor,
            grandTotalMinor: session.totals.totalMinor,
          },
    shippingAddress:
      session.shippingAddress === undefined ? null : toAddressDto(session.shippingAddress),
    billingAddress:
      session.billingAddress === undefined ? null : toAddressDto(session.billingAddress),
    selectedShippingMethod: session.shippingSelection?.method ?? null,
    orderRef: session.orderRef,
  };
}

/** The identical envelope every unknown/cross-owned checkout id resolves to — see the file header's ownership model. */
function notFoundResponse(): AdminResponse {
  return { status: 404, body: toErrorEnvelope(new NotFoundError("Checkout session not found")) };
}

/** Projects a single-session (non-paginated) controller response through `toDto`, same non-2xx passthrough rule as `public-cart-routes.ts`'s `mapItem`. */
function mapSession(
  response: AdminResponse,
  toDto: (session: CheckoutSession) => PublicCheckoutSessionDto,
): AdminResponse {
  if (response.status < 200 || response.status >= 300) return response;
  return { status: response.status, body: toDto(response.body as CheckoutSession) };
}

/**
 * `sessionRef` is the caller's sole proof of ownership. Loads the session and returns it only when
 * `session.sessionRef === sessionRef`. A mismatch, a session from another tenant, and an unknown id
 * all resolve to the SAME 404 — this surface never reveals whether a session exists to a caller who
 * cannot prove they own it.
 */
async function requireOwnedSession(
  admin: WiredAdmin,
  checkoutSessionId: string,
  sessionRef: string,
  tenantId: string,
): Promise<CheckoutSession | AdminResponse> {
  const response = await admin.publicReads.checkout.get({ tenantId, checkoutSessionId });
  if (response.status < 200 || response.status >= 300) {
    return response;
  }
  const session = response.body as CheckoutSession;
  if (session.sessionRef !== sessionRef) {
    return notFoundResponse();
  }
  return session;
}

export function publicCheckoutRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/public/checkouts",
      version: 1,
      permission: "checkout:start",
      public: true,
      idempotent: true,
      summary:
        "Public: start a checkout session for the caller's own cart (guest — no customerRef)",
      schema: { body: startCheckoutBody },
      handle: async ({ body, context }) => {
        const started = await admin.publicReads.checkout.start({
          tenantId: context.tenantId,
          cartRef: body.cartRef,
          sessionRef: body.sessionRef,
          currency: body.currency,
        });
        if (started.status < 200 || started.status >= 300) return started;
        const { checkoutSessionId } = started.body as { checkoutSessionId: string };
        const projected = mapSession(
          await admin.publicReads.checkout.get({ tenantId: context.tenantId, checkoutSessionId }),
          toPublicCheckoutSessionDto,
        );
        return projected.status === 200 ? { status: 201, body: projected.body } : projected;
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/checkouts/:checkoutSessionId",
      version: 1,
      permission: "checkout:read",
      public: true,
      summary: "Public: get a checkout session the caller's session owns",
      schema: { params: checkoutSessionIdParams, querystring: sessionRefQuery },
      handle: async ({ params, query, context }) => {
        const sessionRef = resolveSessionRef(context, query.sessionRef);
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        return { status: 200, body: toPublicCheckoutSessionDto(owned) };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/checkouts/:checkoutSessionId/items",
      version: 1,
      permission: "checkout:load_items",
      public: true,
      idempotent: true,
      summary:
        "Public: load an item snapshot into the caller's own checkout session, re-derived server-side from the given cart",
      schema: { params: checkoutSessionIdParams, body: itemsBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          body.sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        const cartResponse = await admin.publicReads.cart.get({
          tenantId: context.tenantId,
          cartId: body.cartId,
        });
        if (cartResponse.status < 200 || cartResponse.status >= 300) return cartResponse;
        const cart = cartResponse.body as Cart;
        // The cart must also belong to the caller — otherwise a guest could load a stranger's cart
        // contents into their own checkout session. Same 404-on-mismatch rule as everywhere else.
        if (cart.sessionRef !== body.sessionRef) return notFoundResponse();
        const items = cart.items.map((item) => ({
          productId: item.productRef.value,
          quantity: item.quantity.value,
          unitPriceAmountMinor: item.unitPrice.amountMinor,
          currency: item.unitPrice.currency,
        }));
        const result = await admin.publicReads.checkout.loadItems({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
          items,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapSession(
          await admin.publicReads.checkout.get({ ...params, tenantId: context.tenantId }),
          toPublicCheckoutSessionDto,
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/checkouts/:checkoutSessionId/billing-address",
      version: 1,
      permission: "checkout:set_billing_address",
      public: true,
      idempotent: true,
      summary: "Public: set the caller's own checkout session's billing address snapshot",
      schema: { params: checkoutSessionIdParams, body: addressBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          body.sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        const result = await admin.publicReads.checkout.setBillingAddress({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
          line1: body.line1,
          line2: body.line2,
          city: body.city,
          postalCode: body.postalCode,
          country: body.country,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapSession(
          await admin.publicReads.checkout.get({ ...params, tenantId: context.tenantId }),
          toPublicCheckoutSessionDto,
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/checkouts/:checkoutSessionId/shipping-address",
      version: 1,
      permission: "checkout:set_shipping_address",
      public: true,
      idempotent: true,
      summary: "Public: set the caller's own checkout session's shipping address snapshot",
      schema: { params: checkoutSessionIdParams, body: addressBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          body.sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        const result = await admin.publicReads.checkout.setShippingAddress({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
          line1: body.line1,
          line2: body.line2,
          city: body.city,
          postalCode: body.postalCode,
          country: body.country,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapSession(
          await admin.publicReads.checkout.get({ ...params, tenantId: context.tenantId }),
          toPublicCheckoutSessionDto,
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/checkouts/:checkoutSessionId/shipping-quote",
      version: 1,
      permission: "checkout:request_shipping_quote",
      public: true,
      idempotent: true,
      summary: "Public: request shipping rate quotes for the caller's own checkout session",
      schema: { params: checkoutSessionIdParams, body: sessionRefOnlyBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          body.sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        return admin.publicReads.checkout.requestShippingQuote({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/checkouts/:checkoutSessionId/shipping-selection",
      version: 1,
      permission: "checkout:select_shipping",
      public: true,
      idempotent: true,
      summary: "Public: record the shipping method chosen for the caller's own checkout session",
      schema: { params: checkoutSessionIdParams, body: shippingSelectionBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          body.sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        const result = await admin.publicReads.checkout.selectShipping({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
          method: body.method,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapSession(
          await admin.publicReads.checkout.get({ ...params, tenantId: context.tenantId }),
          toPublicCheckoutSessionDto,
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/checkouts/:checkoutSessionId/tax",
      version: 1,
      permission: "checkout:request_tax",
      public: true,
      idempotent: true,
      summary: "Public: request a tax snapshot for the caller's own checkout session",
      schema: { params: checkoutSessionIdParams, body: sessionRefOnlyBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          body.sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        return admin.publicReads.checkout.requestTaxCalculation({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/checkouts/:checkoutSessionId/payment-selection",
      version: 1,
      permission: "checkout:select_payment",
      public: true,
      idempotent: true,
      summary: "Public: record the payment method chosen for the caller's own checkout session",
      schema: { params: checkoutSessionIdParams, body: paymentSelectionBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          body.sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        const result = await admin.publicReads.checkout.selectPayment({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
          paymentMethodRef: body.paymentMethodRef,
          provider: body.provider,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapSession(
          await admin.publicReads.checkout.get({ ...params, tenantId: context.tenantId }),
          toPublicCheckoutSessionDto,
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/checkouts/:checkoutSessionId/recalculate",
      version: 1,
      permission: "checkout:recalculate",
      public: true,
      idempotent: true,
      summary: "Public: recalculate totals for the caller's own checkout session",
      schema: { params: checkoutSessionIdParams, body: sessionRefOnlyBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          body.sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        const result = await admin.publicReads.checkout.recalculateTotals({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapSession(
          await admin.publicReads.checkout.get({ ...params, tenantId: context.tenantId }),
          toPublicCheckoutSessionDto,
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/checkouts/:checkoutSessionId/complete",
      version: 1,
      permission: "checkout:complete",
      public: true,
      idempotent: true,
      summary: "Public: complete the caller's own checkout session, materializing the order",
      schema: { params: checkoutSessionIdParams, body: completeBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          body.sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        const result = await admin.publicReads.checkout.complete({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
          idempotencyKey: body.idempotencyKey,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapSession(
          await admin.publicReads.checkout.get({ ...params, tenantId: context.tenantId }),
          toPublicCheckoutSessionDto,
        );
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/checkouts/:checkoutSessionId/payment-intent-request",
      version: 1,
      permission: "checkout:generate_payment_intent_request",
      public: true,
      summary: "Public: assemble the payment-intent-request snapshot for the caller's own session",
      schema: { params: checkoutSessionIdParams, querystring: sessionRefQuery },
      handle: async ({ params, query, context }) => {
        const sessionRef = resolveSessionRef(context, query.sessionRef);
        const owned = await requireOwnedSession(
          admin,
          params.checkoutSessionId,
          sessionRef,
          context.tenantId,
        );
        if (!(owned instanceof CheckoutSession)) return owned;
        return admin.publicReads.checkout.generatePaymentIntentRequest({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
        });
      },
    }),
  ] as readonly RouteDefinition[];
}
