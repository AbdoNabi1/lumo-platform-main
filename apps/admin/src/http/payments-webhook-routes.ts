import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { extractSignedTransaction, type SignedTransaction } from "@platform/psp-paymob";
import type { WiredAdmin } from "../composition";

/**
 * Stripe's real webhook envelope (C2-2) — minimal parse of only the fields this route uses.
 * Deliberately `.passthrough()`: Stripe's `data.object` shape varies per event `type`, and this
 * route only ever reads its `id`.
 */
const stripeEventBody = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    data: z.object({ object: z.object({ id: z.string().min(1) }).passthrough() }),
  })
  .passthrough();

/**
 * Maps a Stripe event `type` to Payments' own internal webhook `kind` vocabulary
 * (`services/payments/src/application/record-webhook.use-case.ts`'s `KIND_TO_STATUS`). An
 * unrecognized type (e.g. `charge.refunded`, which confirms a refund we already initiated
 * ourselves rather than driving a NEW transition) falls through to the raw Stripe type string —
 * `RecordWebhook` still records it (audit trail), it just does not force a transition, exactly the
 * documented behavior for "unrecognized kinds".
 */
const STRIPE_TYPE_TO_KIND: Readonly<Record<string, string>> = {
  "payment_intent.amount_capturable_updated": "authorized",
  "payment_intent.succeeded": "captured",
  "payment_intent.payment_failed": "failed",
  "payment_intent.canceled": "cancelled",
};

/**
 * PSP webhook ingress (C2-2/C2-6 — closes "`verifyWebhook` has zero call sites, no route exists",
 * then C2-2 replaces the placeholder body-field-carried "signature" with the real thing: Stripe's
 * `Stripe-Signature` HEADER, verified against the RAW request bytes via `context.rawBody`/
 * `context.headers` (added to `RequestContext` by this same change, `packages/http/src/route.ts`).
 * `public: true`: a PSP presents no admin Bearer token, so this route cannot go through `AdminGuard`
 * the way every other Payments action does — its authentication IS `paymentProvider.verifyWebhook`,
 * checked explicitly below before anything is recorded. Reuses the EXISTING `RecordWebhook` use case
 * verbatim via `admin.paymentsWebhook.recordWebhook` — no new business logic, no event-contract
 * change; only the wire-format this route accepts (a placeholder shape, per the prior version's own
 * doc comment) and how the signature is verified.
 */
export function paymentsWebhookRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/payments/webhook",
      version: 1,
      permission: "payments:record_webhook",
      public: true,
      summary:
        "PSP webhook ingress (Stripe; signature-verified via Stripe-Signature, not staff-authenticated)",
      schema: { body: stripeEventBody },
      handle: async ({ body, context }) => {
        const signatureHeader = firstHeader(context.headers?.["stripe-signature"]);
        if (signatureHeader === undefined || context.rawBody === undefined) {
          return {
            status: 401,
            body: {
              code: "UNAUTHORIZED",
              message: "Missing Stripe-Signature header or request body",
            },
          };
        }

        const verified = await admin.paymentsWebhook.verifyWebhook({
          tenantId: context.tenantId,
          provider: "stripe",
          payload: context.rawBody,
          signature: signatureHeader,
        });
        if (!verified) {
          return {
            status: 401,
            body: { code: "UNAUTHORIZED", message: "Webhook signature verification failed" },
          };
        }

        return admin.paymentsWebhook.recordWebhook({
          tenantId: context.tenantId,
          paymentIntentId: body.data.object.id,
          provider: "stripe",
          eventId: body.id,
          kind: STRIPE_TYPE_TO_KIND[body.type] ?? body.type,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/payments/webhook/paymob",
      version: 1,
      permission: "payments:record_webhook",
      public: true,
      summary:
        "Paymob transaction-processed callback (signature-verified via the `hmac` query parameter against the receiving merchant's own HMAC secret, not staff-authenticated)",
      schema: { body: paymobCallbackBody, querystring: paymobCallbackQuery },
      handle: async ({ query, context }) => {
        if (context.rawBody === undefined) {
          return {
            status: 401,
            body: { code: "UNAUTHORIZED", message: "Missing request body" },
          };
        }
        // Verified against the RECEIVING TENANT's own HMAC secret. A callback signed for merchant A
        // and replayed at merchant B's endpoint fails here: B's secret is different.
        const verified = await admin.paymentsWebhook.verifyWebhook({
          tenantId: context.tenantId,
          provider: "paymob",
          payload: context.rawBody,
          signature: query.hmac,
        });
        if (!verified) {
          return {
            status: 401,
            body: { code: "UNAUTHORIZED", message: "Webhook signature verification failed" },
          };
        }

        // Everything below reads SIGNED fields only. The HMAC does not cover `merchant_order_id`
        // or `extra`, so those are attacker-controlled even on a genuine callback.
        const transaction = extractSignedTransaction(context.rawBody);
        if (transaction === null) {
          return {
            status: 422,
            body: { code: "VALIDATION", message: "Not a Paymob transaction callback" },
          };
        }
        const kind = paymobKind(transaction);
        return admin.paymentsWebhook.recordWebhook({
          tenantId: context.tenantId,
          // Paymob's order id = the `intention_order_id` we stored as the intent's PSP reference.
          paymentIntentId: transaction.orderId,
          provider: "paymob",
          // Paymob sends no event id; a transaction's outcome is unique per (transaction, kind).
          eventId: `${transaction.transactionId}:${kind}`,
          kind,
          providerTransactionRef: transaction.transactionId,
          amountMinor: transaction.amountCents,
          currency: transaction.currency,
        });
      },
    }),
  ] as readonly RouteDefinition[];
}

/** Paymob's callback carries no fields we read beyond the signed ones; the body is validated as JSON only. */
const paymobCallbackBody = z.object({}).passthrough();
const paymobCallbackQuery = z.object({ hmac: z.string().min(1) });

/**
 * Maps a VERIFIED Paymob transaction to Payments' webhook `kind` vocabulary, from signed fields only.
 * Only a plain successful sale drives a transition (`captured`). Everything else is recorded for
 * audit but does not move the intent:
 *  - a failed attempt leaves the intent `created` — Paymob lets the customer retry on the same
 *    intention, so a failure is not terminal;
 *  - voids, refunds and child transactions (a refund/void/capture is its own transaction with a
 *    parent) are recorded, not applied: dashboard-initiated reversals are not reconciled here (see
 *    the WP-13 decision entry) — refunds we initiate are already recorded by `RefundPaymentLifecycle`;
 *  - an auth-only transaction is recorded: this adapter supports Paymob sale integrations only.
 */
function paymobKind(t: SignedTransaction): string {
  if (t.pending) return "pending";
  if (t.isVoided) return "voided";
  if (t.isRefunded) return "refunded";
  if (t.hasParentTransaction) return "child_transaction";
  if (!t.success) return "attempt_failed";
  if (t.isAuth && !t.isCapture) return "auth_only";
  return "captured";
}

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  // Not `Array.isArray(value)`: its stdlib type guard narrows to `any[]`, not `readonly string[]`
  // (a long-standing TS lib gap), which would make `value[0]` below resolve to `any`.
  if (typeof value === "string") return value;
  if (value === undefined) return undefined;
  return value[0];
}
