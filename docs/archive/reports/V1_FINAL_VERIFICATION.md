# V1 FINAL VERIFICATION — commit `37f0074`

**Scope:** read-only verification of `fix(runtime): fail closed when payment provider is stub`
(`apps/runtime/src/api.ts`, `apps/runtime/src/composition.test.ts`,
`V1_CRITICAL_REMEDIATION_REPORT.md`). No code changed, no commit created by this verification.

---

## 1. Is the Payment Provider guard completely independent from the MFA guard?

**Answer: No shared coupling in logic, but there is a reachability dependency — see explanation.**

Evidence (`apps/runtime/src/api.ts`, committed content of `37f0074`):

```ts
export function assertProductionPaymentProviderConfigured(appEnv: RuntimeConfig["APP_ENV"]): void {
  if (appEnv === "local") {
    logger.warn(...);
  } else {
    throw new Error(...);
  }
}
```

is a standalone function that takes only `appEnv` as a parameter. It does not read any
MFA-related variable, does not call the MFA guard, is not called from inside the MFA guard's
branches, and does not share any mutable state with it. Inside `startApi`:

```ts
if (config.APP_ENV === "local") {
  logger.warn("MFA is permissive: ...");
} else {
  throw new Error("api: no production MfaProviderResolver is configured. ...");
}

assertProductionPaymentProviderConfigured(config.APP_ENV);

const app = await createAdminHttpApi({ ... });
```

Both checks independently evaluate the same input (`config.APP_ENV`) — they are two separate,
uncoupled assertions, not one guard calling or depending on the other's internal state.

**The nuance:** because the MFA guard's `else` branch throws unconditionally today, execution
never actually reaches the `assertProductionPaymentProviderConfigured` call in `startApi` for any
`APP_ENV !== "local"` — the function unwinds out of `startApi` before that line runs. So while the
two checks are logically independent (no code coupling), their _current end-to-end observability_
through `startApi` is not: today, in production, you always see the MFA error, never the payments
one, because the MFA guard runs first and always fires. This is why `assertProductionPaymentProviderConfigured` was extracted into a named, directly-callable function rather than left inline like the MFA check — so its own behavior could be verified in isolation (`composition.test.ts:91-97`)
without needing the MFA guard to first be satisfied.

## 2. If a real MFA provider is injected tomorrow while the Payment Provider remains the stub implementation, will runtime startup still fail?

**Answer: Yes, it will still fail — confirmed by code structure, not by a test that exercises this exact future scenario (no real MFA provider exists yet, so it cannot be tested today).**

`assertProductionPaymentProviderConfigured(config.APP_ENV)` (`api.ts` line 74, per current
numbering) is a plain sequential statement placed immediately after the MFA guard block and before
`const app = await createAdminHttpApi(...)`. In JavaScript/TypeScript, if the preceding statement
(the MFA block) does not throw — which is exactly the scenario "a real MFA provider is injected
and the guard no longer throws" — control proceeds unconditionally to the next statement. That
next statement is the payments guard, which reads `config.APP_ENV` directly from the function's
own parameter (not from anything the MFA block computed or set) and throws whenever
`APP_ENV !== "local"`. Tomorrow-in-production means `APP_ENV !== "local"`, so it throws, and
`createAdminHttpApi(...)` — and with it the webhook route — is never reached.

This conclusion follows from the unconditional, parameter-only nature of the check; it has not
been (and cannot currently be) exercised as a true end-to-end scenario, because no code path in
this repository today lets the MFA guard pass outside `local` (confirmed by grep: `mfaProviders`
is never passed into `createAdminHttpApi` from `api.ts`, and the MFA guard's `else` branch has no
condition on it — see `CRITICAL_4_REPORT.md` and the guard's own comment, "No real provider is
wired anywhere in this codebase yet").

## 3. Is there any execution path that allows the webhook route to become reachable while the stub provider is active?

**Answer: No production/network-reachable path. One test-only in-process path exists and is pre-existing, unchanged, and never binds a network port.**

Repo-wide search for every caller of `createAdminHttpApi` (the function that mounts
`paymentsWebhookRoutes`, per `apps/admin/src/http/server.ts:89` → `admin-routes.ts:1148`):

```
apps/admin/src/index.ts:9        — re-export only, not a call
apps/admin/src/http/server.ts:62 — the function's own definition
apps/runtime/src/api.ts:76       — the ONLY production call site, guarded (this fix)
apps/admin/src/http/tenant-guard.e2e.test.ts:63   — test file
apps/admin/src/http/payments-webhook.e2e.test.ts:58 — test file
apps/admin/src/http/admin-http.e2e.test.ts:59     — test file
```

- `apps/admin/package.json` has no `start`/`dev`/`bin` script — `@platform/admin` is a library
  package with no way to run as a standalone server; it cannot itself become a production
  entrypoint.
- `apps/runtime/src/worker.ts` and `apps/runtime/src/scheduler.ts` were grepped for
  `createAdminHttpApi`/`PaymentProvider`/`paymentsWebhook` — zero matches in either. Neither
  entrypoint touches Payments composition or mounts any HTTP routes.
- The three `*.e2e.test.ts` files call `createAdminHttpApi` directly, bypassing `startApi` and
  both its guards entirely — but they interact with the resulting Fastify instance exclusively via
  `app.inject(...)` (confirmed in `payments-webhook.e2e.test.ts` lines 75, 89, 101, 121, 138, 154),
  Fastify's in-process request simulator. None of these files call `app.listen(...)`; no network
  port is ever bound. This is test harness code, not a runtime execution path, and it is identical
  to how the MFA guard has always been bypassed by the same test files — not a new gap introduced
  by this fix.

Within the actual runtime (`apps/runtime`'s three entrypoints: `api.ts`, `worker.ts`,
`scheduler.ts`), `api.ts` is the only one that can mount the webhook route, and
`assertProductionPaymentProviderConfigured` runs unconditionally on every call to `startApi`
before `createAdminHttpApi` is invoked, with no `if`/early-return/try-catch between them that
could skip it (confirmed by direct read of the committed function body, lines 56–74 through
line 76).

## 4. Does the new guard rely on any implicit behavior or ordering assumptions?

**Answer: Yes.**

- **Statement order, not structural enforcement.** The guard's protection is achieved purely by
  where the line `assertProductionPaymentProviderConfigured(config.APP_ENV);` sits, textually,
  inside `startApi` — before `const app = await createAdminHttpApi(...)`. Nothing in the type
  system, the function signature of `createAdminHttpApi`, or any wrapper enforces this ordering;
  it is an implicit convention, identical in kind to how the pre-existing MFA guard protects the
  same call. If the two statements were reordered, or the guard call were moved into a branch that
  isn't always taken, nothing would flag it at compile time.
- **Trust in `config.APP_ENV`.** The guard trusts that `RuntimeConfig["APP_ENV"]`, as produced by
  `loadRuntimeConfig()`, correctly reflects the real deployment environment. This is the same
  trust boundary every other fail-closed check in this file and in
  `apps/runtime/src/config.ts` (the Ory H-2 guard) already depends on — not a new assumption
  introduced by this fix, but still a real, implicit dependency.
- **Caller-side, not callee-side.** The check lives in `api.ts`, the one current caller of
  `createAdminHttpApi`, not inside `createAdminHttpApi`/`wirePayments`/`paymentsWebhookRoutes`
  themselves. `createAdminHttpApi` will happily mount the stub-backed webhook route for _any_
  caller, in any environment — the safety property holds only because `api.ts` is, today, the
  only production caller. This mirrors the existing MFA guard's placement exactly (same
  caller-side pattern), so it introduces no new architectural precedent — but it is an implicit
  assumption worth naming explicitly, see Q5.

## 5. Could a future refactor accidentally bypass the Payment guard?

**Answer: Yes — and, concretely, no test in the current suite would catch the most likely form of that regression.**

Two distinct mechanisms, both real:

**a) A new caller of `createAdminHttpApi`.** Per Q4, the guard protects one call site
(`api.ts:76`), not `createAdminHttpApi` itself. If any future code — a new app, a new script, a
refactor that moves route mounting earlier in `apps/admin`'s own composition — calls
`createAdminHttpApi` directly without going through `startApi`, it would not inherit this
protection. This is an inherent property of a caller-side guard and is identical to the
pre-existing MFA guard's own exposure; it is not unique to this fix, but it is a real bypass
vector for both guards alike.

**b) Silent removal of the call site inside `startApi`, undetected by the test suite.** This is
the more concrete, fix-specific finding. Read `composition.test.ts` lines 80–98:

```ts
it("FAILS CLOSED outside local without a production MFA provider (C2-4) — rejects before touching the network", async () => {
  ...
  await expect(startApi(prodConfig, core)).rejects.toThrow(/MfaProviderResolver/);
});

it("FAILS CLOSED outside local without a production PaymentProvider (V-1) — same shape as the MFA guard, checked independently of it", () => {
  expect(() => assertProductionPaymentProviderConfigured("production")).toThrow(/PaymentProvider/);
  expect(() => assertProductionPaymentProviderConfigured("production")).toThrow(/payments\/webhook/);
});
```

The first test drives `startApi` end-to-end but only asserts the MFA error message — it passes
regardless of whether `assertProductionPaymentProviderConfigured(config.APP_ENV)` is present in
`startApi` at all, because the MFA guard throws first and `startApi` never reaches the payments
line. The second test calls `assertProductionPaymentProviderConfigured` **directly**, not through
`startApi` — it proves the function's own logic is correct, but not that `startApi` actually
invokes it.

**Consequence, stated precisely:** if a future edit deleted the single line
`assertProductionPaymentProviderConfigured(config.APP_ENV);` from `startApi` (e.g. during an
unrelated refactor of the function), every test in this repository would continue to pass —
`pnpm test` would stay green — because no existing test observes `startApi`'s behavior with the
MFA guard satisfied and the payments guard exercised in sequence. This is not a flaw in the
guard's own logic (Q1–Q4 hold), it is a gap in end-to-end test coverage for the composed function,
and it exists precisely because today's MFA guard shadows the scenario the V-1 finding itself
warns about ("as soon as a real MFA provider is injected, the webhook route becomes reachable").

---

## Certification

**V1 is NOT unconditionally, permanently closed with zero residual risk.** Questions 4 and 5
are "yes":

- Q4: the guard's safety depends on implicit source-order positioning within `startApi` and on
  `createAdminHttpApi` having exactly one production caller — not on any structural or
  compiler-enforced guarantee.
- Q5: a one-line deletion of the guard's call site inside `startApi` would go undetected by the
  current test suite, because the MFA guard's unconditional throw currently makes the payments
  guard unreachable — and therefore unobserved — in every existing end-to-end test.

Questions 1–3 are answered "no" (with the stated nuances) — the guard logic itself is correctly
independent, correctly fails closed if the MFA guard is ever satisfied, and there is no
network-reachable production path that mounts the webhook route against the stub provider today.

**No code was changed and no commit was created to produce this verification**, per instruction.
The two residual risks above (Q4/Q5) are reported as findings for the next scoped piece of work,
not remediated here.
