# CRITICAL-4 REPORT — MFA accepts a hardcoded code on a live production route

**Finding closed:** C2-4, `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`
**Type:** Injection seam + fail-closed boot guard. No authentication redesign — `MfaProviderPort`,
`MfaProviderResolver`, the MFA use cases, and the enrollment domain aggregate are all untouched.

## Investigate

- `services/security/src/infrastructure/in-memory-auth-adapters.ts:132` —
  `constructor(private readonly validCode = "123456")`.
- Lines 139-141 — `verify(input) { return input.code === this.validCode; }`.
- `services/security/src/composition.ts` (pre-fix, ~429-431) — `new InMemoryTotpMfaProvider()` and
  `new MapMfaProviderResolver([totpProvider])` constructed **unconditionally**, with **no
  `deps.X ?? default` seam** — unlike `kms`, `crypto`, `identityDirectory`, `consentStore`, and
  `sessionRevocation` in the same file, which all have one.
- `apps/admin/src/http/security-sessions-routes.ts:237-244` — `POST
/security/mfa/enrollments/:enrollmentId/verify` is a live, routed, permission-checked endpoint.
- **Reachability chain, traced hop by hop:** `apps/runtime/src/api.ts:31` → `createAdminHttpApi`
  (`apps/admin/src/http/server.ts:40`) → `wireAdmin(deps)` → `wireSecurity(deps)`
  (`apps/admin/src/composition.ts:309`). This is the graph `api.ts` actually boots — not
  `apps/runtime/src/security/wire-security-runtime.ts`, which has zero callers (H2-3) and was not the
  path in question.
- `AdminWiringDeps` (pre-fix) had no field through which a real MFA provider could reach
  `wireSecurity`, even in principle.

**Conclusion: reachable, confirmed.** Any authenticated principal holding
`security:verify_mfa_enrollment` activates any pending MFA enrollment by submitting the literal string
`123456` — in the process the shipped runtime actually boots into.

## Prove

No counter-evidence found: `git grep -n "123456"` across all non-test `.ts` files returns exactly one
source hit, the constructor default cited above (the remaining hits are test payloads and unrelated
tracking-number/phone fixtures, listed and ruled out individually).

## Implement

**1. Injection seam** (`services/security/src/composition.ts`) — same `deps.X ?? default` convention
already used five times in this file:

```ts
readonly mfaProviders?: MfaProviderResolver; // on SecurityWiringDeps

const mfaProviders: MfaProviderResolver =
  deps.mfaProviders ?? new MapMfaProviderResolver([totpProvider]);
```

`totpProvider` (the reference stub) is still constructed and still returned on `WiredSecurity` so
tests/local dev can keep seeding it directly — only the resolver actually wired into
`SecurityDeps.mfaProviders` (the one live verification calls) changes.

**2. Thread it to the reachable production composition root** (`apps/admin/src/composition.ts`) —
`AdminWiringDeps` gained `mfaProviders?: MfaProviderResolver`; `wireSecurity(deps)` (line 309) already
passes the whole `deps` object through, so no call-site change was needed once the field existed.

**3. Fail closed at boot** (`apps/runtime/src/api.ts`, in `startApi`, before `createAdminHttpApi` is
called):

```ts
if (config.APP_ENV === "local") {
  logger.warn("MFA is permissive: no production mfaProviders configured, APP_ENV=local");
} else {
  throw new Error(
    "api: no production MfaProviderResolver is configured. The in-memory reference TOTP " +
      "provider (hardcoded validCode) must never answer MFA challenges outside APP_ENV=local " +
      "(C2-4). Pass mfaProviders in createAdminHttpApi's deps once a real provider exists.",
  );
}
```

Same convention as the adjacent `AUTH_JWKS_URL`/`KETO_READ_URL` checks. Nothing in this codebase
constructs a real `MfaProviderPort` today (a genuine TOTP/WebAuthn/authenticator-app adapter is
substantial new work, and the domain model deliberately never stores the raw secret — "`enroll`
returns a secret **reference** ... seed lives in KMS/authenticator" — so implementing one here would
mean inventing secret-storage infrastructure, which is exactly the redesign this task rules out). The
correct-scoped fix is: make the gap impossible to reach in production rather than inventing a
provider to fill it.

**What did not change:** `MfaProviderPort`, `MfaProviderResolver`, `EnrollMfa`/`VerifyMfaEnrollment`/
`DecideMfa` use cases, the `MfaEnrollment` domain aggregate, the HTTP route contract, and
`InMemoryTotpMfaProvider` itself (still the exact same reference stub — now optional instead of
mandatory).

## Run

**New tests, 3 total:**

`services/security/src/mfa-provider-injection.test.ts` (2 cases, via `wireSecurity` directly):

```
✓ uses the injected provider — the hardcoded reference code no longer verifies once one is supplied
✓ falls back to the in-memory reference stub only when nothing is injected — unchanged prior behavior
```

The first case enrolls a principal, injects a fake provider whose valid code is `"999999"`, then
proves `123456` is **rejected** and `999999` **activates** the enrollment — i.e. the injected provider
is authoritative, not merely present alongside the stub. The second case is a regression guard: with
no `mfaProviders` supplied, `123456` still activates the enrollment exactly as before this change (the
existing `authn.e2e.test.ts` e2e suite, unmodified, is further confirmation — it still passes).

`apps/runtime/src/composition.test.ts` (+1 case):

```
✓ FAILS CLOSED outside local without a production MFA provider (C2-4) — rejects before touching the network
```

Calls `startApi(prodConfig, core)` with a pre-built `local` `RuntimeCore` (so `buildRuntimeCore` itself
never needs a full production environment) and a `config` argument with `APP_ENV: "production"`;
asserts the promise rejects with `/MfaProviderResolver/` — proving the guard fires **before** any
Fastify server binds a port or `createAdminHttpApi` runs.

Quality gates:

| Gate      | Result                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------ |
| typecheck | ✅ 76/76                                                                                               |
| lint      | ✅ 76/76                                                                                               |
| test      | ✅ 76/76 tasks; security: 32 files/101 tests (+1 file/+2 tests); runtime: 25 files/121 tests (+1 test) |
| arch      | ✅ 0 violations (1,531 modules, 6,672 dependencies)                                                    |

## Scope note

A real MFA provider (TOTP/WebAuthn against an actual secret store or authenticator binding) is **not**
built here — per "do not redesign authentication," and because the domain model's own contract
(secret lives in KMS/authenticator, never in Security) means a genuine implementation is new
infrastructure, not a wiring change. This report closes the _reachability_ of the hardcoded code; it
does not add the missing production capability. That remains real, disclosed work — building and
injecting a real `MfaProviderPort` is now the only way to bring MFA back online outside `local`, which
is the point of the guard.

## Status: FIXED (fail-closed — see scope note for the deferred capability)
