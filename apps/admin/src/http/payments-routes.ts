import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Order } from "@platform/orders";
import type { PaymentIntent } from "@platform/payments";
import { ValidationError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";

/**
 * Phase A.1 security fix (F-03): this used to accept a caller-supplied `amountMinor`/`currency`
 * with no server-side check against the order it names, so a manipulated amount flowed straight
 * into the opened payment intent. The fix drops both from the accepted shape; the handler
 * re-derives them from the authoritative `Order` (`orders:read`'s own `getOrder`, already wired on
 * this same admin composition) named by `orderRef`.
 */
const createIntentBody = z.object({ orderRef: z.string().min(1) }).strict();
const paymentIntentIdParams = z.object({ paymentIntentId: z.string().min(1) });
const authorizeBody = z.object({
  pspReference: z.string().min(1),
  paymentMethodToken: z.string().min(1),
  paymentMethodBrand: z.string().optional(),
  authorizedAmountMinor: z.number().int().positive(),
});
const refundBody = z.object({
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
});

/**
 * `PaymentIntent` (`@platform/payments`) is an `Entity`: `props`/`_id` are only TS-`protected`,
 * erased at runtime, so returning it directly would serialize its internals verbatim over the
 * wire — the same defect `admin-routes.ts`'s `toOrderListItemDto` documents and fixes for Orders.
 * This route is authenticated, not public, but the same leak applies, so it gets the same explicit,
 * flat, hand-typed DTO rather than a passthrough.
 */
export interface PaymentIntentDto {
  readonly id: string;
  readonly orderRef: string;
  readonly status: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly authorizedAmountMinor: number | null;
  readonly capturedAmountMinor: number;
  readonly refundedAmountMinor: number;
  readonly pspReference: string | null;
  /** The first charge's own timestamp — real, derived from `charges`, never fabricated. */
  readonly capturedAt: string | null;
  /** The most recent refund's own timestamp — real, derived from `refunds`, never fabricated. */
  readonly refundedAt: string | null;
}

function toPaymentIntentDto(intent: PaymentIntent): PaymentIntentDto {
  const refunds = [...intent.refunds].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  return {
    id: intent.id.toString(),
    orderRef: intent.orderRef,
    status: intent.status.value,
    currency: intent.amount.currency,
    amountMinor: intent.amount.amountMinor,
    authorizedAmountMinor: intent.authorizedAmount?.amountMinor ?? null,
    capturedAmountMinor: intent.charges.reduce((sum, charge) => sum + charge.amount.amountMinor, 0),
    refundedAmountMinor: intent.refunds.reduce((sum, refund) => sum + refund.amount.amountMinor, 0),
    pspReference: intent.pspReference?.value ?? null,
    capturedAt: intent.charges[0]?.occurredAt.toISOString() ?? null,
    refundedAt: refunds[refunds.length - 1]?.occurredAt.toISOString() ?? null,
  };
}

/**
 * The Payments admin HTTP surface (Sprint 4.8 — Payments' first HTTP transport, per
 * `SPRINT_4_8_PAYMENTS_CORE_REPORT.md` §2: "new PaymentsAdminController + payments-routes (5
 * versioned zod routes under /payment-intents)"). Pure delegation — zod validates the boundary,
 * the facade authorizes + audits (AdminGuard), the context owns all behavior.
 */
export function paymentsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/payment-intents",
      version: 1,
      permission: "payments:create_intent",
      idempotent: true,
      summary: "Open a payment intent for an order (creates the PSP-side intent too)",
      schema: { body: createIntentBody },
      handle: async ({ body, context }): Promise<AdminResponse> => {
        const orderResponse = await admin.orders.getOrder(context.principal, {
          tenantId: context.tenantId,
          orderId: body.orderRef,
        });
        if (orderResponse.status < 200 || orderResponse.status >= 300) {
          return orderResponse;
        }
        const order = orderResponse.body as Order;
        return admin.payments.createIntent(context.principal, {
          orderRef: body.orderRef,
          amountMinor: order.totalAmount().amountMinor,
          currency: order.currency,
          tenantId: context.tenantId,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/payment-intents/:paymentIntentId/authorize",
      version: 1,
      permission: "payments:authorize",
      idempotent: true,
      summary: "Record the PSP's authorization (reference + tokenized method)",
      schema: { params: paymentIntentIdParams, body: authorizeBody },
      handle: ({ params, body, context }) =>
        admin.payments.authorize(context.principal, {
          paymentIntentId: params.paymentIntentId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/payment-intents/:paymentIntentId/capture",
      version: 1,
      permission: "payments:capture",
      idempotent: true,
      summary: "Request capture from the PSP",
      schema: { params: paymentIntentIdParams },
      handle: ({ params, context }) =>
        admin.payments.capture(context.principal, { ...params, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/payment-intents/:paymentIntentId/refund",
      version: 1,
      permission: "payments:refund",
      summary: "Request a refund from the PSP (requires an Idempotency-Key header)",
      schema: { params: paymentIntentIdParams, body: refundBody },
      /**
       * Phase A.6 fix: this route used to call `refundLifecycle` with no `idempotencyKey` at all,
       * so every client retry (timeout, double-click, at-least-once delivery) minted a BRAND NEW
       * `Refund` reservation and a brand new PSP idempotency key — `RefundPaymentLifecycle` and
       * `PaymentIntent.requestRefund` already fully support a caller-supplied `idempotencyKey`
       * (Phase A.5, proven safe for the Returns path's `<returnId>:refund`); this route simply
       * never fed one in. The fix is additive-only at this HTTP boundary: read the standard
       * `Idempotency-Key` header (same convention `stripe-signature` uses, `payments-webhook-
       * routes.ts`) and thread it straight into the existing, already-safe domain mechanism — no
       * new idempotency system. Deliberately NOT using the generic `idempotent: true` transport
       * response-cache (used by `create`/`authorize`/`capture` above): that mechanism blindly
       * replays a cached response for a REUSED key regardless of body content, which would silently
       * mask a same-key-different-amount tamper attempt instead of rejecting it — the domain-level
       * check (`PaymentIntent.requestRefund`) already does the correct thing. A missing/empty key
       * fails closed (422 VALIDATION, this repo's existing convention for a boundary validation
       * failure — `pricing-resolution.ts`'s `priceUnresolvedResponse`) rather than silently
       * defaulting to unsafe no-dedup behavior, per this mutation's real external PSP effect.
       */
      handle: ({ params, body, context }) => {
        const idempotencyKey = firstHeader(context.headers?.["idempotency-key"]);
        if (idempotencyKey === undefined || idempotencyKey.length === 0) {
          return Promise.resolve({
            status: 422,
            body: toErrorEnvelope(
              new ValidationError("Idempotency-Key header is required for refund requests", [
                { field: "idempotency-key", message: "Idempotency-Key header is required" },
              ]),
            ),
          });
        }
        return admin.payments.refund(context.principal, {
          paymentIntentId: params.paymentIntentId,
          ...body,
          idempotencyKey,
          tenantId: context.tenantId,
        });
      },
    }),
    defineRoute({
      method: "GET",
      path: "/payment-intents/:paymentIntentId",
      version: 1,
      permission: "payments:read",
      summary: "Get a single payment intent",
      schema: { params: paymentIntentIdParams },
      handle: async ({ params, context }): Promise<AdminResponse> => {
        const response = await admin.payments.getPaymentIntent(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) {
          return response;
        }
        return { status: 200, body: toPaymentIntentDto(response.body as PaymentIntent) };
      },
    }),
  ] as readonly RouteDefinition[];
}

/** Same convention as `payments-webhook-routes.ts`'s own `firstHeader` — self-contained per file, not exported. */
function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  // Not `Array.isArray(value)`: its stdlib type guard narrows to `any[]`, not `readonly string[]`
  // (a long-standing TS lib gap), which would make `value[0]` below resolve to `any`.
  if (typeof value === "string") return value;
  if (value === undefined) return undefined;
  return value[0];
}
