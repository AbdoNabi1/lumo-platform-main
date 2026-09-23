# @platform/psp-paymob

`PaymentProvider` adapter (`@platform/contracts`) for Paymob — raw REST over `fetch`, no SDK
(D-048). Sits behind the same port as `@platform/psp-stripe`; the port is unchanged.

**Built per request, per merchant.** One `PaymobPaymentProvider` holds one merchant's secret key,
HMAC secret and public key. `services/payments`' `TenantPaymentProviderResolver` constructs it from
that merchant's sealed credentials on each request (ADR-0014) — never a process-wide singleton.

## Source of every shape

Paymob developer docs, read 2026-09-23: _Create Intention_, _HMAC Transaction Callback_ (last
updated 2026-06-01), _Unified Checkout (Redirection)_; and Paymob's official
`PaymobAccept/API-Postman-Collections` ("Refund & Void & Capture APIs"). `src/__fixtures__/` holds
the recorded create-intention response and the sample transaction callback from those pages (PII
scrubbed). Tests never make a live call.

## Webhook signing is not Stripe's

`webhook-signature.ts`: HMAC-SHA512, keyed with the merchant's HMAC secret, over the values of 20
named fields concatenated in a fixed order with no separator, hex-encoded, compared with the `hmac`
query parameter. No timestamp. **The HMAC covers only those 20 fields** — `merchant_order_id` and
`extra` are unsigned — so correlation must use the signed `order.id` (`extractSignedTransaction`).
A callback missing or nulling a signed field fails closed (the docs do not say how Paymob renders
those). Only the POST "Processed" callback is supported; the GET redirect is client-side and never
drives state.

## Where the port does not fit (each marked in the code)

- `capture` — throws. A Paymob sale is captured when the customer pays; the callback is the signal.
- `cancel` — throws. No cancel-intention call exists; a silent no-op would be a lie.
- `refund` — addresses a Paymob _transaction_ id (from the callback), not the intention's order id.
  Paymob's refund call takes no idempotency key, so the domain's refund reservation is the only
  double-refund guard.

## Unverified assumptions (no live call was possible)

- `billing_data` is required by the API but the port carries no customer identity: filled with
  Paymob's `"NA"` placeholder convention. Whether Paymob accepts `"NA"` as `phone_number` is unverified.
- The refund response body is unpublished; an explicit `success: false` is treated as failure.
- Oman is not supported (OMR has 3 decimals; what "cents" means there is undocumented).
