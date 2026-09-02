# V1 FINAL CLOSURE REPORT

**Closes:** the verification gap identified in `V1_FINAL_VERIFICATION.md` (Q4/Q5) against commit
`37f0074` (`fix(runtime): fail closed when payment provider is stub`).
**Type:** test-only. **Zero production code changed** — no route, no composition, no config
schema, no public export, no runtime behavior. One new test file.

## The gap, restated precisely

`V1_FINAL_VERIFICATION.md` found that `composition.test.ts`'s only `startApi()`-level test
(`"FAILS CLOSED outside local without a production MFA provider (C2-4)"`) always fails on the MFA
guard first, because the MFA guard's `else` branch throws unconditionally outside `local`. That
meant the payments guard (`assertProductionPaymentProviderConfigured`, called at
`apps/runtime/src/api.ts` line 74) was never actually exercised through `startApi()` itself in any
test — only through direct calls to the extracted helper function. Concretely: **deleting the
single line `assertProductionPaymentProviderConfigured(config.APP_ENV);` from `startApi` would
not have failed any existing test**, because the MFA guard alone was already sufficient to make
every existing production-config test throw.

## Implement

One new file, `apps/runtime/src/api.v1-guard-regression.test.ts`. No production file touched.

**Technique — two problems, two mechanisms, both test-only:**

1. **"Was `createAdminHttpApi` actually invoked?"** cannot be observed without a spy, and nothing
   in the current codebase exposes a seam for that without changing `startApi`'s signature (out of
   scope — "do not change public APIs"). Resolved with `vi.mock("@platform/admin", ...)` replacing
   `createAdminHttpApi` with a `vi.fn()` spy. This is the first use of `vi.mock` in this
   repository; it was chosen because it requires zero production-code changes, unlike adding an
   injectable parameter to `startApi`.

2. **"Is it specifically the payments guard, not the MFA guard, causing the block?"** cannot be
   answered by simply calling `startApi()` with a production config, because the MFA guard's
   `else` branch throws unconditionally for any `APP_ENV !== "local"` — it would always fire first
   and mask the payments guard entirely, exactly the gap being closed. Resolved with a `Proxy`
   around the `RuntimeConfig` object: `startApi` reads `config.APP_ENV` exactly twice before
   reaching `createAdminHttpApi` — once in the MFA guard's `if` condition, once as the argument to
   `assertProductionPaymentProviderConfigured(config.APP_ENV)`. The proxy's `get` trap counts reads
   of `APP_ENV` and answers `"local"` to the first (letting the MFA guard take its permissive
   `warn` branch) and `"production"` to every read after (so the payments guard still sees
   production). No other property is intercepted — `Reflect.get` passes everything else through
   unchanged. This isolates the payments guard's effect from the MFA guard's using only the real
   `startApi()` function, no test-only branching inside production code.

Two tests:

- **`"startApi() never reaches createAdminHttpApi() in production while the stub PaymentProvider
is active"`** — plain production config, asserts `startApi(...)` rejects and
  `mockCreateAdminHttpApi` was never called. Proves requirements 1 and 2 for today's actual
  (MFA+payments, defense-in-depth) behavior.
- **`"isolates the payments guard from the MFA guard — the payments guard specifically (not MFA)
is what blocks createAdminHttpApi, proven through startApi() itself"`** — the proxied config,
  asserts `startApi(...)` rejects with `/PaymentProvider/` specifically (not the MFA error text),
  that at least 2 reads of `APP_ENV` occurred (proving both guards' checks ran), and that
  `mockCreateAdminHttpApi` was never called. Proves requirement 3 (validated through the real
  startup path, not the isolated helper) and is the test that actually depends on the payments
  guard's presence.

## Prove requirement 4 empirically

Rather than reason about it, the guard's call site was actually deleted and the new tests were
actually re-run, before being restored:

**Step 1 — removed** the line in `apps/runtime/src/api.ts`:

```ts
// TEMP-REMOVED-FOR-REGRESSION-PROOF: assertProductionPaymentProviderConfigured(config.APP_ENV);
```

**Step 2 — ran** `npx vitest run src/api.v1-guard-regression.test.ts`. Result: **1 of 2 tests
failed**, with this exact output:

```
❯ src/api.v1-guard-regression.test.ts (2 tests | 1 failed) 62ms
  × ... isolates the payments guard from the MFA guard ... 23ms
    → promise resolved "undefined" instead of rejecting

AssertionError: promise resolved "undefined" instead of rejecting
- Expected:
[Error: rejected promise]
+ Received:
undefined
```

The log line immediately preceding the failure — `{"level":"info","scope":"app","msg":"api
listening","port":3080,"env":"production"}` — shows the mocked `createAdminHttpApi` was reached
and `app.listen` returned, with `env` reported as `"production"`, i.e. the stub-backed admin
surface actually started in this run. This is the exact scenario V-1 was opened to prevent,
reproduced on demand and caught by the new test.

(The first, non-isolated test — plain production config — still passed even with the guard
removed, exactly as `V1_FINAL_VERIFICATION.md` predicted: the MFA guard alone was still enough to
block a plain production config. This is why isolation via the proxy was necessary — a
non-isolated test cannot detect this specific regression.)

**Step 3 — restored** the line exactly as committed in `37f0074` (`git diff` against HEAD showed
zero difference in `apps/runtime/src/api.ts` after restoring). **Step 4 — re-ran** the same test
file: both tests passed.

This is direct, reproduced evidence that requirement 4 holds: removing the guard's call site
inside `startApi` causes `src/api.v1-guard-regression.test.ts` to fail, which fails `pnpm test`
(turbo run test), which fails CI.

## Run

| Gate      | Result                                                                                    |
| --------- | ----------------------------------------------------------------------------------------- |
| typecheck | ✅ 76/76 tasks (`pnpm typecheck`)                                                         |
| lint      | ✅ 76/76 tasks (`pnpm lint`)                                                              |
| test      | ✅ 76/76 tasks; `@platform/runtime`: 26 files / 125 tests (+1 file/+2 tests, all passing) |
| arch      | ✅ 0 violations (1,531 modules, 6,672 dependencies cruised)                               |

## Verification checklist (against the original four requirements)

1. **`startApi()` cannot reach `createAdminHttpApi()` in production while the stub provider is
   active** — proven by both tests; `mockCreateAdminHttpApi` asserted never called in either.
2. **`createAdminHttpApi()` is never invoked when the guard throws** — same assertion, both tests.
3. **The protection is validated through the actual production startup path, not isolated helper
   functions** — both tests call `startApi()` directly; neither calls
   `assertProductionPaymentProviderConfigured` directly. (The pre-existing unit test of the
   isolated helper in `composition.test.ts` is untouched and still present — it is not what closes
   this gap, the new tests are.)
4. **Removing the guard must cause these tests to fail** — empirically demonstrated in the Prove
   section above, not merely asserted.

## What did not change

`apps/runtime/src/api.ts`, `apps/runtime/src/composition.test.ts`, every route, every event
contract, every public export, and the guard's own behavior (still the exact `if (appEnv ===
"local") { warn } else { throw }` shape from `37f0074`) — all byte-for-byte identical to commit
`37f0074`. The only diff introduced by this closure is the addition of one new test file.

## Status

**V1 is permanently closed.**
