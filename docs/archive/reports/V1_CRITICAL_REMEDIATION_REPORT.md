# V-1 CRITICAL REMEDIATION REPORT — Payments Webhook route has no production boot guard

**Finding closed:** V-1, discovered during the Post-Critical Verification Sprint that followed
Critical-1..6 (`POST_CRITICAL_VERIFICATION_REPORT.md`).
**Type:** Adds one fail-closed boot guard, mirroring the existing MFA guard (C2-4). **No PSP
implementation introduced, no architecture change, no route/API change** —
`InMemoryPaymentProvider` is unchanged and still answers `verifyWebhook` identically in every
environment; the only new behavior is that the runtime now refuses to start outside `local` while
it is the active provider.

## Investigate

**Is the Payments Webhook route reachable while a stub `PaymentProvider` is active? Yes — proven
by tracing the exact boot path with no guard anywhere on it.**

- `apps/runtime/src/api.ts` (`startApi`, the API entrypoint's composition root) previously ran
  exactly one fail-closed check before mounting the admin HTTP surface: the MFA guard (lines
  32-45, `C2-4`) — `if (config.APP_ENV === "local") { warn } else { throw }`. Nothing else in this
  function gated on `APP_ENV`.
- `startApi` then called `createAdminHttpApi({...})` (`apps/admin/src/http/server.ts:62`) →
  `wireAdmin(deps)` (`apps/admin/src/composition.ts:63/306`) → `wirePayments(deps)`
  (`apps/admin/src/composition.ts:318`).
- `services/payments/src/composition.ts` — `buildController` (lines 75-136) line 80:
  `const paymentProvider = new InMemoryPaymentProvider();`, constructed **unconditionally** in the
  one shared helper used by both the Prisma and in-memory branches of `wirePayments`. There is no
  `APP_ENV`/`NODE_ENV` check anywhere in `services/payments/src` or `apps/admin/src` (confirmed by
  grep — zero matches). No real PSP implementation exists anywhere in the repository (grep for
  `PaymentProvider`/`InMemoryPaymentProvider`: 9 hits total, all either the stub class itself, its
  interface, or wiring/route code — no alternate implementation, no `@platform/psp-*` package).
- `services/payments/src/infrastructure/in-memory-port-adapters.ts:34-36`:
  `async verifyWebhook(): Promise<boolean> { return true; }` — ignores both arguments,
  unconditionally `true`.
- `apps/admin/src/composition.ts:513-517` binds `admin.paymentsWebhook.verifyWebhook` directly to
  `payments.paymentProvider.verifyWebhook`, i.e. to that stub.
- `apps/admin/src/http/admin-routes.ts:22,1148` spreads `...paymentsWebhookRoutes(admin)`
  (`apps/admin/src/http/payments-webhook-routes.ts:33-68`, `POST /payments/webhook`,
  `public: true` — bypasses `AdminGuard`) into the route table passed to `registerRoutes` in
  `server.ts:89`. This route was added by Critical-6 and, per its own report, was correctly wired
  to call `verifyWebhook` — but `verifyWebhook` itself was never gated on being a real
  implementation.
- **Confirmed absence of an existing guard:** grepped `apps/runtime` (where the MFA guard and the
  Ory H-2 `superRefine` guard in `apps/runtime/src/config.ts:161-172` both live) for
  `payments`/`PaymentProvider`/`webhook` — zero matches. `apps/runtime` builds `RuntimeCore`
  (DB/Redis/Kafka/auth) and hands it to `apps/admin`'s `createAdminHttpApi`; it never touches
  Payments composition, so nothing on the boot path stops a stub `PaymentProvider` from backing a
  public, unauthenticated webhook route in every environment, including `APP_ENV=production`.

**Conclusion:** the finding is real. The MFA guard currently masks it only as a side effect — it
throws unconditionally outside `local`, so today the API process never reaches
`createAdminHttpApi` in production at all. The moment that guard's condition changes (e.g. a real
MFA provider is wired in — separate, future work), the payments gap becomes live with nothing else
blocking it, exactly as described in the finding.

## Prove

Exhaustive grep across `apps/runtime`, `apps/admin/src`, `services/payments/src` for
`APP_ENV`/`NODE_ENV`/`PaymentProvider`/`InMemoryPaymentProvider`/`webhook` (cited above) — not
sampled. Confirmed via direct file reads of every hop in the boot path from `startApi` through to
route registration.

## Implement

One additive change, mirroring the existing C2-4 pattern exactly:

**`apps/runtime/src/api.ts`** — added `assertProductionPaymentProviderConfigured(appEnv)`, same
shape as the inline MFA check it sits next to: `if (appEnv === "local") { logger.warn(...) } else
{ throw new Error(...) }`. Called from `startApi` immediately after the MFA guard and before
`createAdminHttpApi(...)` is invoked, so the admin HTTP surface — and with it the webhook route —
is never mounted outside `local` while the only `PaymentProvider` in the codebase is the
unconditionally-`true` stub.

It is a named function rather than inlined (the MFA check's shape) purely so it can be unit-tested
independently of the MFA guard, which otherwise always throws first outside `local` and would
shadow it in an end-to-end test. This is the only structural deviation from the MFA guard's
inlined form; the check's own logic, tone, and fail-closed behavior are identical.

**What did not change:** `PaymentProvider`, `InMemoryPaymentProvider`, `wirePayments`,
`paymentsWebhookRoutes`, `admin-routes.ts`, any HTTP route, any event contract, any public export
from `apps/runtime`'s `index.ts` (the new function is exported from `api.ts` for testability but
not re-exported from the package entrypoint). No architecture, bounded context, or feature flag
was introduced.

## Verify

- **Stub provider (every environment today) → runtime refuses to expose the webhook.** Outside
  `local`, `assertProductionPaymentProviderConfigured` throws before `createAdminHttpApi` runs, so
  the process never listens and the route is never mounted. Test:
  `apps/runtime/src/composition.test.ts` — _"FAILS CLOSED outside local without a production
  PaymentProvider (V-1)"_ asserts the thrown error matches both `/PaymentProvider/` and
  `/payments\/webhook/`.
- **Real provider → webhook mounts normally.** No real PSP adapter exists in this codebase (out of
  scope to build, per the sprint constraints), so this cannot be exercised end-to-end with an
  actual PSP — the same limitation the MFA guard already has (no real `MfaProviderResolver`
  exists either, and its own test only proves the outside-`local` failure). What is proven: in
  `local`, the guard takes its permissive branch and does not throw (test: _"stays permissive in
  local (matches the MFA guard's dev-mode behavior)"_), and the existing full end-to-end webhook
  tests (`payments-webhook-routes.test.ts`, `payments-webhook.e2e.test.ts`) continue to exercise
  the route unmodified. Once a real `PaymentProvider` implementation exists, swapping the
  unconditional throw for a type/instance check (as the MFA guard's own doc comment anticipates
  for `mfaProviders`) is the follow-up — explicitly out of scope here.
- **Existing webhook tests still pass:** `payments-webhook-routes.test.ts` (3 cases) and
  `payments-webhook.e2e.test.ts` (3 cases) — untouched, still green (see gate table).
- **Existing payment flow still passes:** all `services/payments` tests (20 tests, 4 files) and
  `apps/admin` payments-adjacent tests — untouched, still green (see gate table).
- **No public API changes:** no route added/removed/renamed, no HTTP contract changed, no export
  added to any package's public entrypoint.
- **No event contract changes:** no `.v1` event schema touched; grep confirms no changes outside
  `apps/runtime/src/api.ts` and `apps/runtime/src/composition.test.ts`.

## Run

| Gate      | Result                                                                          |
| --------- | ------------------------------------------------------------------------------- |
| typecheck | ✅ 76/76 tasks (`pnpm typecheck`)                                               |
| lint      | ✅ 76/76 tasks (`pnpm lint`)                                                    |
| test      | ✅ 76/76 tasks; `@platform/runtime`: 25 files / 123 tests (+2 new, all passing) |
| arch      | ✅ 0 violations (1,531 modules, 6,672 dependencies cruised)                     |

## Remaining risks

- **Env-gated, not type-gated.** Like the MFA guard it mirrors, this check cannot distinguish a
  future real `PaymentProvider` from the stub by inspection — it only knows "no real
  implementation exists yet" and blocks unconditionally outside `local`. This is correct today
  (there is exactly one implementation, the stub) but the guard must be revisited — narrowed to an
  `instanceof`/marker check — the same day a real PSP adapter is wired in, or production will
  never boot again for an unrelated reason. This mirrors the MFA guard's own documented follow-up
  and is not a new class of risk.
- **Currently redundant with the MFA guard.** Because the MFA guard already throws unconditionally
  outside `local`, this new guard has no observable effect on the running system today — it only
  becomes load-bearing once the MFA guard's condition is relaxed (real MFA provider wired in).
  This is intentional defense-in-depth per the finding's own framing ("as soon as a real MFA
  provider is injected, the webhook route becomes reachable"), not dead code — it is exercised
  directly by its own unit tests independent of MFA state.
- **Webhook signature verification itself is still a stub** (`verifyWebhook` always returns
  `true`) whenever the guard's permissive branch is taken, i.e. in `local`. This is unchanged,
  pre-existing, disclosed behavior (see `CRITICAL_6_REPORT.md`'s own scope note) — building a real
  PSP adapter remains explicitly out of scope for this fix.

## Status: FIXED
