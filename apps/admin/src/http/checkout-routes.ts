import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Cart } from "@platform/cart";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";

const startBody = z.object({
  cartRef: z.string().min(1),
  customerRef: z.string().min(1).optional(),
  sessionRef: z.string().min(1),
  currency: z.string().length(3),
});
const checkoutSessionIdParams = z.object({ checkoutSessionId: z.string().min(1) });
/**
 * Phase 17.2 security fix: this used to accept a fully caller-supplied `items` array — including
 * `unitPriceAmountMinor`/`currency` per line — and load it into the session verbatim, with nothing
 * downstream (`ValidateCheckout`'s `PricingValidationPort` is an offline stub that only checks
 * `amount >= 0`) re-deriving it from Pricing. That forged snapshot flowed, unchanged, all the way
 * into `generatePaymentIntentRequest`'s `amountMinor` — the exact amount handed to Payments. The
 * fix mirrors H-01: the caller no longer supplies prices at all. It supplies `cartId`, and the
 * route re-derives `items` from that Cart's own stored lines (`admin.publicReads.cart.get`, the
 * same existing, already-wired read `public-cart-routes.ts` uses) — which are themselves
 * Pricing-authoritative as of the `cart-routes.ts`/`public-cart-routes.ts` fixes. No new Pricing
 * abstraction, no Checkout domain/use-case change: `LoadItems`'s `items` input shape is untouched,
 * only what the HTTP boundary is willing to accept as the source of those items changed.
 */
const loadItemsBody = z.object({ cartId: z.string().min(1) }).strict();
const addressBody = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(1),
});
/**
 * Phase A.1 security fix (F-01): this used to accept a caller-supplied `rateAmountMinor`/`currency`
 * and store it verbatim, with nothing downstream re-validating it against a real shipping quote —
 * a forged rate flowed unchanged into checkout totals and the payment-intent amount. The fix
 * mirrors Phase 17.2: the caller no longer supplies the rate at all, only the `method` it chose;
 * `SelectShipping` re-derives the authoritative rate by re-querying `ShippingCalculationPort` (the
 * same source `RequestShippingQuote` already uses) and matching it against `method`.
 */
const selectShippingBody = z.object({ method: z.string().min(1) }).strict();
const selectPaymentBody = z.object({
  paymentMethodRef: z.string().min(1),
  provider: z.string().min(1),
});
const validatePromotionBody = z.object({ promotionRef: z.string().min(1).optional() });
/**
 * C-2 note on what this field does and does not do: `idempotencyKey` is threaded into
 * `CompleteCheckout` and used as its `Guard.againstEmpty` subject and as the key passed down to
 * `OrderCreationPort`, but NOTHING currently dedupes on its value — `CompleteCheckout`'s
 * short-circuit keys on `session.orderRef !== null`, so a retry with a *different* body key is
 * short-circuited just the same, and a first call with a *repeated* key is not blocked. Real
 * request-level replay protection on this transport is the `Idempotency-Key` HTTP HEADER, enforced
 * centrally in `packages/http/src/server.ts` for routes declared `idempotent: true` (below). Kept
 * required because the use case's contract requires it and because a future
 * `findByIdempotencyKey`-backed dedupe would key on exactly this value.
 */
const completeBody = z.object({ idempotencyKey: z.string().min(1) });
const failBody = z.object({ reason: z.string().min(1) });

/**
 * The Checkout admin HTTP surface (Sprint 4.6 — Checkout's first HTTP transport, per
 * `SPRINT_4_6_CHECKOUT_CORE_REPORT.md` §2: "rich CheckoutController + CheckoutAdminController
 * facade + checkout-routes (16 versioned zod routes under /checkouts) on the admin transport").
 * Pure delegation — zod validates the boundary, the facade authorizes + audits (AdminGuard), the
 * context owns all behavior.
 */
export function checkoutRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/checkouts",
      version: 1,
      permission: "checkout:start",
      idempotent: true,
      summary: "Start a checkout session for a cart (customerRef optional — guest checkout)",
      schema: { body: startBody },
      handle: ({ body, context }) => admin.checkout.start(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/items",
      version: 1,
      permission: "checkout:load_items",
      idempotent: true,
      summary: "Load an item snapshot into the session, re-derived server-side from the given Cart",
      schema: { params: checkoutSessionIdParams, body: loadItemsBody },
      handle: async ({ params, body, context }): Promise<AdminResponse> => {
        const cartResponse = await admin.publicReads.cart.get({ cartId: body.cartId });
        if (cartResponse.status < 200 || cartResponse.status >= 300) {
          return cartResponse;
        }
        const cart = cartResponse.body as Cart;
        const items = cart.items.map((item) => ({
          productId: item.productRef.value,
          quantity: item.quantity.value,
          unitPriceAmountMinor: item.unitPrice.amountMinor,
          currency: item.unitPrice.currency,
        }));
        return admin.checkout.loadItems(context.principal, {
          checkoutSessionId: params.checkoutSessionId,
          items,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/billing-address",
      version: 1,
      permission: "checkout:set_billing_address",
      idempotent: true,
      summary: "Set the session's billing address snapshot",
      schema: { params: checkoutSessionIdParams, body: addressBody },
      handle: ({ params, body, context }) =>
        admin.checkout.setBillingAddress(context.principal, {
          checkoutSessionId: params.checkoutSessionId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/shipping-address",
      version: 1,
      permission: "checkout:set_shipping_address",
      idempotent: true,
      summary: "Set the session's shipping address snapshot",
      schema: { params: checkoutSessionIdParams, body: addressBody },
      handle: ({ params, body, context }) =>
        admin.checkout.setShippingAddress(context.principal, {
          checkoutSessionId: params.checkoutSessionId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/validate",
      version: 1,
      permission: "checkout:validate",
      summary: "Request price + stock validation for the session's items",
      schema: { params: checkoutSessionIdParams },
      handle: ({ params, context }) => admin.checkout.validateCheckout(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/tax",
      version: 1,
      permission: "checkout:request_tax",
      summary: "Request a tax snapshot from Finance and store it",
      schema: { params: checkoutSessionIdParams },
      handle: ({ params, context }) =>
        admin.checkout.requestTaxCalculation(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/shipping-quote",
      version: 1,
      permission: "checkout:request_shipping_quote",
      summary: "Request shipping rate quotes from Shipping (does not select one)",
      schema: { params: checkoutSessionIdParams },
      handle: ({ params, context }) =>
        admin.checkout.requestShippingQuote(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/shipping-selection",
      version: 1,
      permission: "checkout:select_shipping",
      idempotent: true,
      summary: "Record the shipping method chosen, with its already-quoted rate",
      schema: { params: checkoutSessionIdParams, body: selectShippingBody },
      handle: ({ params, body, context }) =>
        admin.checkout.selectShipping(context.principal, {
          checkoutSessionId: params.checkoutSessionId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/payment-selection",
      version: 1,
      permission: "checkout:select_payment",
      idempotent: true,
      summary: "Record the payment method reference chosen",
      schema: { params: checkoutSessionIdParams, body: selectPaymentBody },
      handle: ({ params, body, context }) =>
        admin.checkout.selectPayment(context.principal, {
          checkoutSessionId: params.checkoutSessionId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/promotion",
      version: 1,
      permission: "checkout:validate_promotion",
      summary: "Request promotion/coupon validation and store the discount snapshot",
      schema: { params: checkoutSessionIdParams, body: validatePromotionBody },
      handle: ({ params, body, context }) =>
        admin.checkout.validatePromotion(context.principal, {
          checkoutSessionId: params.checkoutSessionId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/recalculate",
      version: 1,
      permission: "checkout:recalculate",
      idempotent: true,
      summary: "Recalculate totals as a sum of the session's stored snapshots",
      schema: { params: checkoutSessionIdParams },
      handle: ({ params, context }) => admin.checkout.recalculateTotals(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/lock",
      version: 1,
      permission: "checkout:lock",
      idempotent: true,
      summary: "Lock the session against further detail changes",
      schema: { params: checkoutSessionIdParams },
      handle: ({ params, context }) => admin.checkout.lock(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/expire",
      version: 1,
      permission: "checkout:expire",
      idempotent: true,
      summary: "Expire a still-open session",
      schema: { params: checkoutSessionIdParams },
      handle: ({ params, context }) => admin.checkout.expire(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/complete",
      version: 1,
      permission: "checkout:complete",
      idempotent: true,
      summary:
        "Complete the session, materializing the order via OrderCreationPort (C-2); returns orderRef",
      schema: { params: checkoutSessionIdParams, body: completeBody },
      handle: ({ params, body, context }) =>
        admin.checkout.complete(context.principal, {
          checkoutSessionId: params.checkoutSessionId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/checkouts/:checkoutSessionId/fail",
      version: 1,
      permission: "checkout:fail",
      idempotent: true,
      summary: "Fail the session (a saga step failed)",
      schema: { params: checkoutSessionIdParams, body: failBody },
      handle: ({ params, body, context }) =>
        admin.checkout.fail(context.principal, {
          checkoutSessionId: params.checkoutSessionId,
          ...body,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/checkouts/:checkoutSessionId/order-draft",
      version: 1,
      permission: "checkout:generate_order_draft",
      summary: "Assemble the order-draft snapshot handed to Orders",
      schema: { params: checkoutSessionIdParams },
      handle: ({ params, context }) => admin.checkout.generateOrderDraft(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/checkouts/:checkoutSessionId/payment-intent-request",
      version: 1,
      permission: "checkout:generate_payment_intent_request",
      summary: "Assemble the payment-intent-request snapshot handed to Payments",
      schema: { params: checkoutSessionIdParams },
      handle: ({ params, context }) =>
        admin.checkout.generatePaymentIntentRequest(context.principal, params),
    }),
  ] as readonly RouteDefinition[];
}
