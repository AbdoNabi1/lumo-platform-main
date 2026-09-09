# WP-13 — Merchant payments: Paymob and cash-on-delivery

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** `WP-1` (guest checkout must be closed first — a payment-method decision made on
> checkout session state that `WP-1` still redefines would need redoing).
> **Conflicts with:** `WP-4`, `WP-5`, `WP-6`, `WP-8`, `WP-9`, `WP-14`, `WP-15`
> (`apps/admin/src/http/admin-routes.ts`) and any WP touching `apps/storefront/src` at checkout time.
> **Closes:** Morbeh F-19 (only `packages/psp-stripe` exists; no merchant payment configuration, no
> Paymob adapter, no COD lifecycle).

## Why this exists

`services/payments` is a complete, well-modelled bounded context (`PaymentIntent`, `Charge`,
`Refund`, a `PaymentProvider` port in `@platform/contracts`) with exactly one adapter behind it:
`packages/psp-stripe`. A merchant cannot accept a second payment method, and a shopper cannot pay
cash on delivery — verified: `ls packages | grep -i psp` returns only `psp-stripe`; grep the repo for
`paymob` returns nothing outside this plan.

## Decisions, already made

1. **Paymob goes behind the same `PaymentProvider` port Stripe already implements**, in
   `@platform/contracts`. Read `packages/psp-stripe/src/stripe-payment-provider.ts` and
   `webhook-signature.ts` first — they are the reference for "real external provider behind a
   port," including signature verification. Do not widen or fork the port to fit Paymob; if Paymob
   genuinely cannot express something Stripe's shape assumes, that is a real finding — narrow the
   gap in the port's contract deliberately and document why, rather than adding a Paymob-specific
   escape hatch.
2. **Cash on delivery is a payment method, not a bypass of payment.** Selecting COD creates an
   order in an unpaid state; only a confirmed collection event (an operator action, or a courier
   webhook if one exists — check `services/logistics`/`services/shipping` for an existing courier
   integration before assuming there is none) marks it paid. A COD order must never be created
   already marked paid.
3. **The shopper selects the method explicitly; the orchestrator never chooses one.** Whatever
   directs checkout to a provider (read `services/payments/src/application/
payment-lifecycle.use-cases.ts` and `create-payment-intent.use-case.ts` to find it) takes the
   method as an input, never infers it.
4. **Merchant payment credentials live in the secrets envelope**, the same one Stripe's key
   presumably already goes through — find it (`packages/secrets`) and use the identical path.
   Never plaintext, never a bare Postgres column, never logged.

## Tasks

- [ ] **T13.1 — Read the existing contract and orchestrator.**
      `@platform/contracts`' `PaymentProvider` port definition; `packages/psp-stripe/src/
  stripe-payment-provider.ts` and `webhook-signature.ts` in full; `services/payments/src/
  application/{create-payment-intent,capture-payment,refund-payment,fail-payment,
  record-webhook}.use-case.ts`; `services/payments/src/application/ports.ts`. Identify exactly
      where a provider is selected today (it is presumably hardcoded to Stripe, since it is the
      only implementation) and what has to change for that to be a real choice.

- [ ] **T13.2 — Merchant payment settings.**
      A place for a merchant to configure which providers are enabled and store their provider
      credentials. Model it in `services/payments` (or wherever the existing settings-style
      aggregates for this context live — check for a `*-settings.ts` or `*-configuration.ts`
      pattern in a neighbouring context, e.g. `services/shipping` or `services/tax`, before
      inventing a new shape). Credentials through `packages/secrets`, never plaintext.

- [ ] **T13.3 — The Paymob adapter.**
      New package `packages/psp-paymob`, mirroring `packages/psp-stripe`'s file layout exactly:
      an adapter implementing `PaymentProvider` (create, capture, refund, verify), a
      `webhook-signature.ts` doing Paymob's actual signature scheme (not Stripe's — read Paymob's
      real webhook signing documentation; do not assume it matches Stripe's HMAC shape), and
      `index.ts`. Register the package in `.dependency-cruiser.cjs`'s layer rules the way an
      existing `packages/*` addition was registered — find the most recent example and copy it.

- [ ] **T13.4 — Cash on delivery as a payment method.**
      A `CashOnDeliveryProvider` (or equivalent) satisfying the same `PaymentProvider` port where
      that makes sense, or a documented, deliberate exception where COD's semantics genuinely don't
      map onto "create/capture/refund/verify" (e.g. there is no "capture" — say so, in a comment,
      at the exact point the shape doesn't fit). `create` produces an unpaid order. Only an explicit
      "confirmed collection" action transitions it to paid — this transition needs its own use case,
      following the shape of `capture-payment.use-case.ts` but sourced from a collection
      confirmation, not a provider webhook.

- [ ] **T13.5 — Wire provider selection through checkout.**
      The shopper's explicit choice (from `services/checkout`'s session, extended with a payment
      method field the way `WP-1`'s `contactEmail` addition modelled adding a field) selects which
      provider the orchestrator invokes. `apps/admin/src/http/public-checkout-routes.ts` and its
      neighbours are the place to add the method-selection route, copying an existing route's shape
      exactly (session-ownership check, zod validation, idempotency flag) per `../README.md`'s
      "conventions to copy" table.

- [ ] **T13.6 — Storefront payment method selection.**
      `apps/storefront/src/app/checkout/page.tsx` and its `actions.ts`: render the enabled methods
      for the merchant, let the shopper choose, call the new selection route. Strings in both
      `apps/storefront/src/messages/en.ts` and `ar.ts`.

- [ ] **T13.7 — Webhook idempotency and signature verification for Paymob.**
      Every provider webhook is signature-verified and idempotent, matching the existing Stripe
      webhook's guarantees — reuse `record-webhook.use-case.ts`'s idempotency mechanism, do not
      write a second one.

- [ ] **T13.8 — Tests.**
      Adapter tests against a recorded Paymob response shape (never a live call). A test proving a
      COD order is never marked paid before an explicit collection confirmation. A test proving the
      shopper's selected method determines the adapter invoked (not, e.g., merchant configuration
      order or provider priority).

## Definition of done

- [ ] A shopper's explicit choice at checkout determines the payment adapter executed.
- [ ] A COD order is created unpaid and only marked paid by an explicit confirmed-collection
      action — never by order creation itself.
- [ ] Every provider webhook (Stripe and Paymob) is signature-verified and idempotent.
- [ ] Merchant payment credentials are never in a Postgres column, a log, or a DTO — prove it with a
      test, the same way `WP-9`'s T9 tasks (a different WP, same standard) require for ad-platform
      credentials.
- [ ] Morbeh F-19 closed in `docs/architecture/23-platform-gap-register.md` and
      `docs/KNOWN_GAPS.md`.
- [ ] Repo-wide gates green per `../UNIFIED-ROADMAP.md` §3, plus `pnpm arch`.

## Known traps

- **Do not let the orchestrator choose a provider "intelligently."** Decision 3 above is
  non-negotiable — an orchestrator that picks Stripe over Paymob for its own reasons (lower fees,
  higher success rate) is a silent behaviour change the merchant did not ask for.
- **Do not assume Paymob's webhook signing matches Stripe's.** Copying `webhook-signature.ts`
  verbatim without adapting the actual algorithm is a security control that looks present and
  verifies nothing.
- **This WP's file surface overlaps `admin-routes.ts` and `apps/storefront/src` with several other
  WPs** (see `../UNIFIED-ROADMAP.md` §5's extended conflict table) — coordinate before running this
  in parallel with `WP-4`, `WP-5`, `WP-6`, `WP-8`, or `WP-9`.
