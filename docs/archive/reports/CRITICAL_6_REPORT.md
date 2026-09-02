# CRITICAL-6 REPORT — `verifyWebhook` had zero call sites; no webhook route existed

**Finding closed:** C2-2 (webhook half), `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`
**Type:** Wires the EXISTING verification port + the EXISTING `RecordWebhook` use case behind one new
HTTP route. **No real PSP implementation introduced** — `InMemoryPaymentProvider` (the offline stub)
is exactly what answers `verifyWebhook` in every environment, unchanged.

## Investigate

- `services/payments/src/infrastructure/in-memory-port-adapters.ts:14` — the only
  `implements PaymentProvider` in the repository.
- Lines 34-36 — `verifyWebhook(): Promise<boolean> { return true; }` — the stub doesn't even read its
  declared `(payload, signature)` parameters.
- `git grep -n "verifyWebhook"` repository-wide: exactly two non-test hits before this fix — the
  interface declaration (`packages/contracts/src/payment-provider.ts:29`) and the stub above. **Zero
  call sites.**
- `services/payments/src/composition.ts` (pre-fix): `buildController` constructed `paymentProvider`
  locally and never exposed it on `WiredPayments` — there was no way for anything outside the
  function to reach it, even in principle.
- `services/payments/src/interfaces/payment.controller.ts:87-89` — `PaymentController.recordWebhook`
  exists and delegates to the EXISTING `RecordWebhook` use case
  (`services/payments/src/application/record-webhook.use-case.ts`, replay-safe via
  `ProcessedWebhookStore`, idempotently transitions the intent).
- `apps/admin/src/interfaces/payments.admin-controller.ts:11-17` — its own doc comment: `recordWebhook`
  (and `advance`) are **"saga/PSP-internal, not exposed here"** — deliberately excluded from the
  guarded admin facade, correctly, because a PSP has no admin Bearer token to present.
- `apps/admin/src/http/payments-routes.ts` — 5 routes (create/authorize/capture/refund/get), no
  webhook route.

**Conclusion:** the verification port, the use case, and the presenter all already existed and were
correctly designed — nothing downstream of an HTTP boundary was missing. What was missing was the
boundary itself: no route ever called `verifyWebhook`, and no route ever called `recordWebhook`
either, because the one place `recordWebhook` _could_ have been exposed (`PaymentsAdminController`)
deliberately excludes it for the right reason (it must not require staff auth).

## Prove

Exhaustive `git grep` for `verifyWebhook` and `recordWebhook` across the repository (cited above) —
not sampled.

## Implement

Three additive changes, each reusing something that already existed:

**1. Expose the PSP port** (`services/payments/src/composition.ts`) — `buildController` now returns
`{ controller, paymentProvider }` instead of just the controller; both `wirePayments` branches
(Prisma and in-memory) return `paymentProvider` on `WiredPayments`. No behavior change to either
branch's construction — `InMemoryPaymentProvider` is still built exactly the same way in both; it is
now _reachable_, not reconstructed or replaced.

**2. Expose an unguarded webhook seam** (`apps/admin/src/composition.ts`) — added
`paymentsWebhook: { recordWebhook, verifyWebhook }` to `WiredAdmin`, sourced from the raw
`payments.payments`/`payments.paymentProvider` (the same unguarded, framework-agnostic objects
`publicReads` already exposes for the public catalog routes — same pattern, not a new one).

**3. The route** (`apps/admin/src/http/payments-webhook-routes.ts`, new file) —
`POST /api/v1/payments/webhook`, `public: true` (skips `AdminGuard`/Bearer auth, matching the reason
`recordWebhook` was excluded from the guarded facade in the first place). The handler:

```ts
const verified = await admin.paymentsWebhook.verifyWebhook(payload, body.signature);
if (!verified) {
  return {
    status: 401,
    body: { code: "UNAUTHORIZED", message: "Webhook signature verification failed" },
  };
}
return admin.paymentsWebhook.recordWebhook({ paymentIntentId, provider, eventId, kind });
```

`verifyWebhook` is now called on **every** request to this route, and gates whether `recordWebhook`
ever runs — this is the wiring the finding was about.

**Disclosed limitation, not a redesign.** `RouteDefinition.handle` (`packages/http/src/route.ts`)
only ever receives the already zod-parsed body — no route in this codebase has ever had access to raw
request bytes or headers, and adding that would touch the transport for every route, not just this
one (explicitly out of scope: "do not redesign architecture"). Real webhook schemes carry the
signature in a header over raw bytes; here it travels as a `signature` body field, and the "payload"
passed to `verifyWebhook` is the parsed fields re-encoded as JSON, not the original bytes. This is not
a regression against what exists — the current stub doesn't inspect either argument — and is called
out in the route file's own doc comment so it isn't mistaken for a real signature-verification
implementation. Building one is C2-2's remaining, larger work (a real PSP adapter), explicitly out of
scope here per "do not introduce a real PSP implementation."

**What did not change:** `PaymentProvider`, `RecordWebhook`, `ProcessedWebhookStore`,
`PaymentsAdminController` (still excludes `recordWebhook`, correctly), and every existing Payments
route/test.

## Run

**7 new tests, all passing, none touching a real PSP:**

`apps/admin/src/http/payments-webhook-routes.test.ts` (3 cases — direct route-handler unit tests
with a spied `paymentsWebhook` seam):

```
✓ calls verifyWebhook with the payload + signature BEFORE recording, and records on success
✓ rejects with 401 and NEVER calls recordWebhook when verifyWebhook returns false
✓ is declared public — a PSP webhook carries no admin Bearer token to check
```

The first case asserts `verifyWebhook` was called exactly once with the signature and a `Uint8Array`
payload whose decoded JSON matches the webhook fields, and that `recordWebhook` receives the
structured input — proving the wiring is real, not decorative. The second proves the gate: a false
result **never reaches** `recordWebhook`.

`apps/admin/src/http/payments-webhook.e2e.test.ts` (3 cases — real HTTP requests against the actual
`createAdminHttpApi` server, real in-memory `RecordWebhook`, no mocks):

```
✓ records a webhook with NO Authorization header — unlike every other Payments route
✓ still requires a tenant — public does not mean unscoped
✓ rejects a malformed body at the boundary (zod) — no signature, no paymentIntentId
```

The first case creates a payment intent through the normal authenticated flow, confirms
`/payment-intents/:id/capture` still 401s without a Bearer token (the contrast the webhook route is
supposed to break), then POSTs to `/api/v1/payments/webhook` with **no** `Authorization` header and
gets a real `200` with the intent transitioned — end to end, through the actual composition graph.
(`kind: "cancelled"` was used rather than `"captured"`: a freshly created intent's Sprint-4.8
lifecycle status is `"created"`, whose transition table only allows `processing`/`cancelled` directly
— reaching `"captured"` requires the pre-existing authorize→capture admin flow, which this finding
does not touch. This sidesteps an unrelated, pre-existing gap rather than fixing or hiding it.) A
replayed identical webhook correctly reports `duplicate: true`, proving `ProcessedWebhookStore`
idempotency is intact and unmodified.

Quality gates:

| Gate      | Result                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| typecheck | ✅ 76/76                                                                                                      |
| lint      | ✅ 76/76                                                                                                      |
| test      | ✅ 76/76 tasks; admin: 5 files/41 tests (+2 files/+6 tests); payments: 4 files/20 tests (unchanged, additive) |
| arch      | ✅ 0 violations (1,531 modules, 6,672 dependencies)                                                           |

## Scope note

This closes the _wiring_ half of C2-2 — `verifyWebhook` now has a real call site and gates a real
route. It does not close the _PSP_ half: `InMemoryPaymentProvider.verifyWebhook()` still returns
`true` unconditionally regardless of the signature presented, `capture()` is still a no-op, and no
`stripe`/`adyen`/any-PSP string exists anywhere in the repository. A PSP still cannot reach this
platform, and this platform still cannot charge a card. Building a real adapter — and, with it,
raw-body/header capture through the transport so a real HMAC signature can be checked byte-exactly —
remains disclosed, larger work, explicitly excluded from this task's scope.

## Status: FIXED (wiring only — see scope note for the deferred PSP capability)
