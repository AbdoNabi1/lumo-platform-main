# @platform/psp-stripe

Production `PaymentProvider` adapter (`@platform/contracts`) for Stripe — raw REST over `fetch`,
no Stripe SDK dependency (D-048's no-SDK convention). Implements `createIntent`/`capture`/`cancel`/
`refund`/`verifyWebhook` exactly as declared by the port; see ADR-0012 §4.

- Card data never transits this adapter (`PaymentIntentRequest` carries no card fields).
- Every mutating call sends `Idempotency-Key`; Stripe dedupes server-side, so a caller's retry
  after a timeout can never double-charge. This adapter does not retry internally.
- Intents are created with `capture_method: manual` so Stripe's own authorize→capture split
  matches the domain's two-phase lifecycle.
- `cancel()` treats Stripe's `payment_intent_unexpected_state` error as a no-op success, matching
  the port's documented idempotent-cancel contract.
- `verifyWebhook()` implements Stripe's `Stripe-Signature: t=<ts>,v1=<hmac>` scheme: HMAC-SHA256,
  constant-time comparison, and a timestamp-tolerance window (replay protection). The pure
  verification logic lives in `webhook-signature.ts`, independently unit-testable.

Composed at `apps/runtime`'s composition root when `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are
configured; falls back to `InMemoryPaymentProvider` (`services/payments`) otherwise. See
`C2_2_REPORT.md` at the repo root for the full investigation and wiring.
