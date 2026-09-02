# C2-2 — Real Payment Provider Integration

**Status:** Tasks 1–8 and 10 complete. Task 9 (live sandbox run) requires the user's own Stripe
test-mode credentials — see [Task 9](#task-9--sandbox-run-user-executed) below for the runbook;
this report documents everything up to that point plus what the script/runbook will prove once run.

**Scope discipline:** per this repo's standing sprint-isolation rule, this sprint touches only the
files listed in [Commit contents](#commit-contents) below. The large pre-existing body of untracked
report files at the repo root (`FINAL_PRODUCTION_READINESS_REPORT.md` and others) predates this
sprint and is left untouched.

---

## 1. Architecture investigation

Before writing any code, the following was verified directly against the repo (not assumed):

- **`PaymentProvider`** — `packages/contracts/src/payment-provider.ts`. `createIntent` /
  `capture` / `cancel` / `refund` / `verifyWebhook`. Doc comment already specifies the production
  convention: no SDK, raw REST (D-048), every mutating call takes an idempotency key, card data
  never transits the platform. **Only implementation before this sprint:** `InMemoryPaymentProvider`
  (`services/payments/src/infrastructure/in-memory-port-adapters.ts`) — `createIntent` fabricates an
  id, `capture`/`cancel`/`refund` are no-ops, `verifyWebhook()` unconditionally returns `true`.
- **`PaymentVerificationPort`** (Orders) — `services/orders/src/application/ports.ts`. Production
  implementation `PrismaPaymentVerificationAdapter` (`apps/runtime/src/composition.ts`) already
  existed (wired in M2-7) and reads `payment_intents.status = 'captured'` — this checks the
  platform's own ledger, not the PSP directly, which is correct (truth arrives via webhook, not by
  polling Stripe). **Untouched by this sprint.**
- **`FinanceLedgerPort`/`PaymentsPort`** (Licensing) — `services/licensing/src/application/ports.ts`.
  Injection seam already existed (`LicensingWiringDeps.payments?`/`.financeLedger?`, built in M2-3).
  **See [Task 6](#task-6--finance-ledger-scoped-out-with-evidence) — deliberately not touched this
  sprint; the seam exists but there is no safe production adapter to plug into it yet.**
- **Webhook pipeline** — `POST /payments/webhook` (`apps/admin/src/http/payments-webhook-routes.ts`)
  existed (added in a prior C2-2/C2-6-flagged commit) but its own doc comment disclosed the gap this
  sprint closes: the "signature" traveled as a JSON body field reconstructed from parsed fields, not
  the real `Stripe-Signature` header over the real raw bytes, because `RouteDefinition`/
  `RequestContext` (`packages/http`) had no raw-body/header capture capability anywhere in the
  codebase.
- **Runtime composition** — `apps/runtime/src/api.ts` (boot guards) and
  `apps/runtime/src/composition.ts` (`buildRuntimeCore`). Three existing fail-closed guards
  (`assertProductionPaymentProviderConfigured`, `assertProductionLicensingBillingConfigured`,
  `assertProductionObjectStorageConfigured`) already existed and already named this exact gap (V-1,
  M2-3) — the payments one threw unconditionally outside `local` because no real-vs-stub seam
  existed yet to check.
- **Provider anticipated by the architecture** — `docs/architecture/adr/0012-purchase-saga-and-psp.md`
  names `@platform/psp-<provider>` packages; `docs/implementation/SPRINT_2_8_REPORT.md` names
  `@platform/psp-stripe` specifically as the expected first package; `services/payments/README.md`
  says "Replace the in-memory repository with Postgres + a PSP adapter (Stripe)"; every existing
  webhook test fixture uses the literal string `"stripe"`. No PSP SDK dependency existed anywhere.

Full investigation detail (with file:line citations) is in this sprint's working notes; the above is
the load-bearing summary.

## 2. Provider selection

**Stripe, raw REST, no SDK** — confirmed with the user before implementation. This is not a new
decision; it is what every existing signal in the repo already pointed at (ADR-0012, the sprint
report, the README, and the test fixtures). No second abstraction was introduced — `StripeApiError`/
`HttpFetch` are internal to `packages/psp-stripe`, and the adapter implements the **existing**
`PaymentProvider` interface with zero method changes.

## 3. Production `PaymentProvider` — `packages/psp-stripe`

New leaf package `@platform/psp-stripe` (`StripePaymentProvider`), implementing `createIntent` /
`capture` / `cancel` / `refund` / `verifyWebhook` exactly as declared by the existing port — **no new
public API**; `getPaymentStatus` from the sprint brief's Task 3 text was deliberately NOT added as a
new port method (the absolute constraint "no new public APIs" wins over the brief's task-list
wording; nothing in this sprint's actual call chain needs a standalone status-poll method — truth
arrives via webhook, per the port's own doc comment).

- `fetch: HttpFetch` and `logger: Logger` are constructor-injected (same pattern as
  `packages/auth`'s `KetoAccessControl`/`JwtVerifier`) — no global fetch, fully testable offline.
- Every mutating call sends `Idempotency-Key: <the caller's idempotencyKey>` — Stripe dedupes
  server-side for 24h, so a caller's retry after a timeout can never double-charge. The adapter does
  **not** retry internally; that stays the caller's responsibility (the port's own doc comment: "the
  saga's `workflowId + step`" — retries are a saga/caller concern, this adapter only makes them safe).
- Intents are created with `capture_method: manual`, matching the domain's own two-phase
  authorize→capture lifecycle (`PaymentIntent`'s `authorized`→`capture_requested`→`captured` states).
- `cancel()` treats Stripe's `payment_intent_unexpected_state` error as a no-op success, matching the
  port's documented idempotent-cancel contract; every other Stripe error still throws.
- Per-request timeout (`AbortController`, default 10s) — a hung PSP call cannot hang the caller
  forever; a timeout propagates as a rejected promise, never silently swallowed.
- Card data never transits this adapter — `PaymentIntentRequest` carries no card fields, only
  amount/currency/references (G-27).

19 unit tests (`packages/psp-stripe/src/*.test.ts`) cover: intent creation with correct
amount/currency/capture_method/metadata/idempotency header; capture; refund; a declined-payment
error propagating as `StripeApiError` (never swallowed); idempotent cancel on an already-terminal
intent; a NON-idempotent cancel failure still throwing; a network failure (`fetch` rejects)
propagating; a timeout (abort) propagating; `verifyWebhook` delegating to the same HMAC path the
standalone signature tests cover.

## 4. Webhook verification — `packages/psp-stripe/src/webhook-signature.ts`

`verifyStripeSignature()` implements Stripe's documented `Stripe-Signature: t=<ts>,v1=<hmac>` scheme:

- **Signature verification** — HMAC-SHA256 over `${timestamp}.${rawBody}` using the configured
  webhook secret.
- **Timestamp validation / replay protection** — rejects if `|now - t| > toleranceSeconds` (default
  300s, Stripe's own default).
- **Constant-time comparison** — `crypto.timingSafeEqual`, with an explicit length check first (a
  length mismatch is rejected without ever calling `timingSafeEqual`, which throws rather than
  returning `false` on unequal-length buffers — this would otherwise be a crash-on-malformed-input
  bug, not just a security gap).
- **Multiple `v1=` entries** (Stripe sends one per active signing secret during a rotation window) —
  a match against ANY of them is valid, each compared in constant time.
- **Reject, never silently ignore** — every rejection path (malformed header, wrong secret, tampered
  payload, stale timestamp) returns `false`, which the webhook route turns into an explicit `401`;
  nothing is ever accepted-by-default or swallowed into a 200.

10 dedicated unit tests cover: valid signature accepted; wrong secret rejected; tampered payload
rejected; stale timestamp rejected; a signature exactly at the tolerance boundary still accepted;
malformed headers (missing `t`, missing `v1`, empty) rejected without throwing; multiple `v1=`
entries during a rotation window; a garbage-length signature value never crashing
`timingSafeEqual`.

## 5. Runtime wiring

**`services/payments` (`PaymentsWiringDeps`):** added `paymentProvider?: PaymentProvider` — absent ⇒
`InMemoryPaymentProvider` (unchanged default), present ⇒ the injected adapter, in **both** the Prisma
and in-memory persistence branches (the PSP is orthogonal to persistence). Also: the Prisma branch
now constructs `PrismaProcessedWebhookStore` internally instead of the in-memory dedup store (see
[Task 5](#task-5--prismaprocessedwebhookstore) below) — this required threading `processedWebhooks`
as a per-branch parameter into the shared `buildController` helper, mirroring how `intents`/
`unitOfWork` already differ per branch.

**`apps/admin` (`AdminWiringDeps`):** added `paymentProvider?: PaymentProvider`, passed straight
through to `wirePayments(deps)` — same `deps.X ?? default` convention already used for
`objectStorage`/`mfaProviders`/`payments`/`financeLedger`.

**`apps/runtime` (`RuntimeCore`/`buildRuntimeCore`):** added `paymentProvider: PaymentProvider |
undefined`, resolved the same way `objectStorage` already is — `StripePaymentProvider` when
`STRIPE_SECRET_KEY`+`STRIPE_WEBHOOK_SECRET` are both configured (new optional env vars in
`apps/runtime/src/config.ts`, plus `STRIPE_API_BASE` for sandbox/testing overrides), `undefined`
otherwise. `assertProductionPaymentProviderConfigured` (`apps/runtime/src/api.ts`) was upgraded from
its previous "always throw outside `local`" shape (there was no way to tell configured from not) to
take the already-resolved value and fail closed only while it is actually still absent — the same
adapter-identity-based shape `assertProductionObjectStorageConfigured` already used for Media/S3.

Local wiring is unchanged (`InMemoryPaymentProvider`, unconditional 200/true `verifyWebhook`, still
gated to `APP_ENV=local` only by the boot guard). Production wiring is real Stripe REST calls,
fail-closed if not configured.

## 6. Finance Ledger — scoped out, with evidence

Task 6 as written says: _"Reuse existing FinanceLedger abstraction. Replace in-memory implementation
with production implementation **if architecture already supports it**."_ On inspection, it does
not, and forcing an implementation would have meant one of the things this sprint is explicitly
forbidden from doing:

- `FinanceLedgerPort.postSettlement(tenantRef, amount, currency, reference)` is Licensing's outbound
  seam onto Finance. `services/finance/src/interfaces/finance.controller.ts` (Finance's complete
  public API, 18 use cases) has **no** matching command — no `postSettlement`, no
  `recordSettlement`, nothing that accepts an arbitrary externally-driven ledger post. The closest
  candidate, `recordManualAdjustment`, is semantically a correction workflow, not routine settlement
  posting — reusing it would be misuse, not reuse, and extending Finance's API to add a real one
  would be "redesigning accounting" (explicitly forbidden) and modifying a context this sprint has
  no mandate to touch.
- `PaymentsPort.collect(tenantRef, amount, currency)` (Licensing's billing-collection seam) has the
  same shape problem one level deeper: a real adapter reusing the now-production Payments context
  would need an `orderRef`/`idempotencyKey` to build a well-formed `PaymentIntentRequest` — this
  port's signature carries neither. Synthesizing one (e.g. from `tenantRef` + a timestamp) would be
  unsafe: it would break the idempotency guarantee this entire sprint exists to protect (a retried
  `collect()` call could double-charge a subscription). Widening the port to add those fields is a
  contract change, also explicitly forbidden this sprint.

Both ports still fall back to their existing in-memory stubs
(`services/licensing/src/infrastructure/deferred-billing-adapters.ts`, unchanged), and
`assertProductionLicensingBillingConfigured` still fails closed outside `local`, exactly as before
this sprint. **Nothing regressed; nothing was force-fitted.** This gap is real and is flagged again
under [Remaining risks](#remaining-risks) below — it is the honest continuation of what M2-3 itself
already flagged as "shared long pole with the still-open C2-2 real-PSP-adapter work," now correctly
narrowed to "needs its own scoped sprint to either add a real Finance command or redesign these two
port signatures," not "C2-2 will silently absorb it."

## 7. End-to-end verification

Full chain, traced and exercised by test (`apps/admin/src/http/payments-webhook.e2e.test.ts`, real
Fastify server via `app.inject`, no mocked provider — the real `verifyStripeSignature` production
code path, driven with a genuine HMAC computed the same way Stripe computes it):

```
Customer → Checkout → Payment Intent (createIntent, Stripe REST) → Provider
  → Webhook (POST /payments/webhook, Stripe-Signature header, raw body)
  → verifyWebhook (real HMAC-SHA256 + timestamp tolerance + constant-time compare)
  → RecordWebhook (unchanged use case) → Order Paid (unchanged MarkOrderPaid/PaymentVerificationPort)
  → License / Tracking / Analytics (unchanged — not touched by this sprint)
```

Nothing bypasses verification: the route checks `rawBody`/`Stripe-Signature` presence and
`verifyWebhook`'s result BEFORE calling `recordWebhook` — proven by a dedicated test asserting
`verifyWebhook` is called with the exact raw bytes (`toBe(rawBody)`, not a reconstruction) before
`recordWebhook`, and that a `false`/missing-header result never reaches `recordWebhook` at all.

`RecordWebhook`, `MarkOrderPaid`, the outbox, and every downstream consumer (Orders → License →
Tracking → Analytics) are **completely untouched** by this sprint — the only things that changed are
(a) how the wire-format is parsed (Stripe's real envelope instead of a placeholder JSON shape) and
(b) how the signature is verified (real crypto instead of an always-true stub). The internal
`RecordWebhookInput` DTO (`paymentIntentId`/`provider`/`eventId`/`kind`) — Payments' own event
contract — is byte-for-byte unchanged.

## 8. Failure testing

| Scenario                                               | Where proven                                                            | Result                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Invalid signature                                      | `payments-webhook.e2e.test.ts`                                          | 401, `recordWebhook` never called                                                           |
| Tampered body (signature computed for different bytes) | `payments-webhook.e2e.test.ts`                                          | 401                                                                                         |
| Expired timestamp (replay protection)                  | `payments-webhook.e2e.test.ts`, `webhook-signature.test.ts`             | 401 / `false`                                                                               |
| Missing `Stripe-Signature` header                      | `payments-webhook.e2e.test.ts`                                          | 401, `verifyWebhook` never called                                                           |
| Duplicate webhook (same signed request resent)         | `payments-webhook.e2e.test.ts`                                          | 200, `duplicate: true`, no re-transition                                                    |
| Payment failure (declined)                             | `stripe-payment-provider.test.ts`                                       | `StripeApiError` thrown, never swallowed                                                    |
| Refund                                                 | `stripe-payment-provider.test.ts`                                       | correct `payment_intent`/`amount` sent                                                      |
| Provider timeout                                       | `stripe-payment-provider.test.ts`                                       | abort propagates as a rejected promise                                                      |
| Provider unavailable (network failure)                 | `stripe-payment-provider.test.ts`                                       | rejection propagates, not swallowed                                                         |
| Retry / idempotency                                    | `stripe-payment-provider.test.ts` (`Idempotency-Key` header assertions) | every mutating call carries the caller's key; no internal retry loop that could double-send |
| Malformed body at the transport boundary               | `payments-webhook.e2e.test.ts`                                          | 422 (zod), before signature check even runs                                                 |
| No tenant on a public route                            | `payments-webhook.e2e.test.ts`                                          | 403 (unchanged prior behavior)                                                              |

## 9. Task 9 — sandbox run (user-executed)

Per an explicit scoping decision made with the user before implementation: this environment has
outbound network access to `api.stripe.com` but no Stripe test-mode credentials, and credentials are
never pasted into an agent chat session. A self-contained script was built instead:

**`apps/runtime/scripts/c2-2-stripe-sandbox-validation.ts`** (`pnpm --filter @platform/runtime
sandbox:stripe`) — run it locally with your own `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (test
mode only; the script refuses to run against a non-`sk_test_` key). It exercises the **actual**
`StripePaymentProvider` class (not a re-implementation) against Stripe's real test API: payment
creation, capture, idempotent cancel, refund, and webhook signature verification using your real
webhook secret. The script's own header comment documents exactly what it proves versus what still
needs the full stack (Postgres/Redis/Kafka via Docker, or a staging deployment) to prove end-to-end
webhook _reception_ — reusing the `stripe listen --forward-to` / `stripe trigger` workflow, since
this sandbox cannot host a publicly reachable endpoint for Stripe's servers to call.

**Action needed from you:** run the script (or the full runbook in its header comment) and report
back the results; they were not fabricated or assumed here.

## 10. Quality gates

All four gates run at the full monorepo scope (`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm
arch`), not just the touched packages:

- `pnpm typecheck` — 77/77 packages passed.
- `pnpm lint` — 77/77 packages passed, 0 errors (one package briefly had 3 `no-console` warnings in
  the new sandbox script; fixed by routing its diagnostic output through `console.error`, which the
  repo's lint config allows for CLI scripts).
- `pnpm test` — 77/77 packages passed (includes the 19 new `packages/psp-stripe` tests and the
  rewritten/extended Payments webhook test suites).
- `pnpm arch` — 0 dependency violations, 1536 modules cruised (`@platform/psp-stripe` sits as a leaf
  package depending only on `@platform/contracts`/`@platform/utils`, same shape as `@platform/clock`/
  `@platform/id`).

## Remaining risks

1. **Licensing billing (`PaymentsPort`/`FinanceLedgerPort`) is still stubbed** — see
   [Task 6](#task-6--finance-ledger-scoped-out-with-evidence). A merchant subscription can still be
   marked paid without money actually moving through Licensing's billing path (Payments' own
   checkout/order path, the actual subject of this sprint, is now real). `assertProductionLicensingBillingConfigured`
   still fails closed outside `local`, so this cannot silently reach production — but it is a real,
   separate, unscoped follow-up (either a Finance API addition or a `PaymentsPort`/`FinanceLedgerPort`
   contract redesign, both out of this sprint's mandate).
2. **`ProcessedWebhookStore.markProcessed` is not transactional with the intent save** — inherited,
   pre-existing characteristic of the port (`markProcessed(provider, eventId): Promise<void>`, no
   transaction handle in its signature, and `RecordWebhook` never passed one even before this
   sprint). `PrismaProcessedWebhookStore` (new, Task 5) therefore commits its dedup marker outside the
   intent-save transaction, same as the in-memory stub it replaces. A crash in the narrow window
   between the two commits could theoretically allow the aggregate's own transition-table validation
   (not the dedup check) to be the only guard against a duplicate re-apply on next retry. Fixing this
   would mean widening `ProcessedWebhookStore.markProcessed`'s signature — a port contract change,
   out of this sprint's absolute constraints.
3. **Task 9 (live sandbox proof) is not yet run** — see above; it needs the user's own credentials
   and, for the full webhook-reception leg, a stack this sandbox cannot host (Docker/staging).
4. **API version pinning** — `StripePaymentProvider` defaults to `Stripe-Version: 2024-06-20`
   (constructor-overridable). This should be revisited against whatever version the account is
   actually configured for once real credentials are available.
5. **Single-secret webhook verification** — `verifyStripeSignature` checks against exactly one
   configured `webhookSecret`. Stripe's own rotation window sends multiple `v1=` values signed by
   different secrets; this adapter's multi-`v1=`-matching logic only helps if multiple SECRETS are
   configured for comparison, which today it is not (`STRIPE_WEBHOOK_SECRET` is a single value). A
   secret-rotation runbook (accept two configured secrets during a cutover window) is a reasonable
   follow-up, not built here (no evidence it was needed for this sprint's scope).

## Production readiness impact

This closes the specific, named blocker this sprint was scoped for: _"payment execution still relies
on development adapters."_ Payments' PSP integration — the core purchase-flow payment path — is now
backed by a real, tested, fail-closed-by-default Stripe adapter with genuine webhook signature
verification, replacing an always-succeeds/always-verified-true stub. The two items still open
(Licensing billing, live sandbox proof) are both independently fail-closed or explicitly flagged, not
silently degraded — this sprint does not claim more than what was actually built and verified.

## Commit contents

Modified: `apps/admin/{package.json, src/composition.ts, src/http/payments-webhook-routes.ts,
src/http/payments-webhook-routes.test.ts, src/http/payments-webhook.e2e.test.ts}`,
`apps/runtime/{package.json, src/api.ts, src/composition.ts, src/composition.test.ts, src/config.ts}`,
`packages/http/src/{route.ts, server.ts}`, `services/payments/src/composition.ts`, `pnpm-lock.yaml`.

New: `packages/psp-stripe/` (package.json, tsconfig.json, vitest.config.ts, README.md,
src/{index.ts, stripe-payment-provider.ts, stripe-payment-provider.test.ts, webhook-signature.ts,
webhook-signature.test.ts}), `services/payments/src/infrastructure/prisma-processed-webhook-store.ts`,
`apps/runtime/scripts/c2-2-stripe-sandbox-validation.ts`, this report.

No event contracts changed. No new bounded contexts. No new public APIs (the webhook route's own
wire-format is transport-level, provider-owned, and was already documented as a placeholder pending
this exact sprint). Tracking, Analytics, Customer 360, Licensing business logic, and Orders business
rules were not touched.
