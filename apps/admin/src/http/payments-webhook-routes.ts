import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
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

        const verified = await admin.paymentsWebhook.verifyWebhook(
          context.rawBody,
          signatureHeader,
        );
        if (!verified) {
          return {
            status: 401,
            body: { code: "UNAUTHORIZED", message: "Webhook signature verification failed" },
          };
        }

        return admin.paymentsWebhook.recordWebhook({
          paymentIntentId: body.data.object.id,
          provider: "stripe",
          eventId: body.id,
          kind: STRIPE_TYPE_TO_KIND[body.type] ?? body.type,
        });
      },
    }),
  ] as readonly RouteDefinition[];
}

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  // Not `Array.isArray(value)`: its stdlib type guard narrows to `any[]`, not `readonly string[]`
  // (a long-standing TS lib gap), which would make `value[0]` below resolve to `any`.
  if (typeof value === "string") return value;
  if (value === undefined) return undefined;
  return value[0];
}
