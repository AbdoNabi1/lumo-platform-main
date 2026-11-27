# Shopify parity — Wave 1f: two-step verification mandatory for every merchant and staff member

`OPUS: AGREED (self-review below) · reviewer: Opus (owner ruling 2026-11-24: Opus plans and reviews, Sonnet implements)`

**Owner request (2026-11-26):** "التحقق بخطوتين إجباري على الكل سواء تاجر أو موظف" — two-step verification is mandatory for everyone who signs in to the merchant dashboard (store owners and staff).
**Branch / worktree:** `morbeh/shopify-parity-w1f` in `F:/New folder/morbeh-shopify-parity-w1b`, BASE `6417d733` (main with Waves 1a-1e, deployed).
**Built on Wave 1e:** `services/security/src/application/{own-mfa,mfa-login,staff-policy,staff-support}.use-cases.ts`, `apps/admin/src/interfaces/staff-auth.admin-controller.ts`, `apps/admin/src/http/{staff-login-verify,public-staff-auth-routes,public-merchant-routes,staff-account-routes,staff-routes}.ts`, `packages/auth/src/native-token-issuer.ts`, admin-web `app/login/verify`, `app/auth/native-login/*`, `lib/auth/mfa-*`, `components/account/two-step-panel.tsx`, `components/settings/users/*`.

**Decisions (defaults taken; owner may reverse):**

- D25 Platform-wide, not per store: every dashboard sign-in (merchant login and staff login, owner included) requires two-step. Storefront CUSTOMERS are NOT affected (customer sign-in never passes the staff flags; Wave 1e F1 rule stays).
- D26 Set up at sign-in: someone without two-step who enters the right password is taken straight to a setup screen (key + link + code), shown their 10 backup codes once, and only then signed in. Nobody is locked out by the rule itself.
- D27 Turning two-step off is impossible while the rule is on; "Get new backup codes" stays.
- D28 Recovery: an admin can reset a colleague's two-step (their next sign-in sets it up again; their sessions are revoked). Nobody can reset the store owner's or their own; the owner's recovery is the backup codes (support can reset via a script — follow-up, not in this wave).
- D29 The per-store "Require two-step for everyone" switch is replaced, while the platform rule is on, by a read-only note "Two-step verification is required for everyone on Morbeh". The stored per-store flag and its 1e refusals stay in code but cannot be reached from the UI.
- D30 Existing signed-in sessions of people without two-step stay valid until they expire (≤ the staff token TTL); the next sign-in forces setup. (No forced sign-out on deploy.)
- D31 Rule switch: runtime config `STAFF_TWO_STEP` = `required` | `optional`, default `required`. The rule is enforced only when the code step is available (`mfaConfigured` + issuer). In a non-local deployment with `STAFF_TWO_STEP=required` and the code step unavailable (no `MFA_TOTP_KEY` / real provider), the runtime refuses to boot with a clear error (fail closed, never silently optional). Production already has `MFA_TOTP_KEY`.

**Precedence:** amendments > task text. **Implementers:** all `impl-sonnet`.

## Global Constraints

Same as Wave 1e G1-G9 (`docs/superpowers/plans/2026-11-25-shopify-parity-w1e-two-step.md`): hard git rules, no migration in this wave (none needed), tenant from context or the verified challenge, secrets only on non-idempotent no-store responses and client state, uniform failures, brand lock + en/ar + Dialog rules + revalidation, never value-import `@/lib/api/*` from a `"use client"` file, the pnpm command prefix, package names `@platform/security|auth|admin|runtime`, `admin-web`. Commit trailer `Co-Authored-By: Claude Sonnet <noreply@anthropic.com>`. No new lint warnings (cap 473).

---

### Task 1 — security + admin + runtime: enforce, set up at sign-in, admin reset (implementer: sonnet)

1. **Authenticate** (`services/security/src/application/authentication.use-cases.ts`): new `AuthenticateInput.requireFactorEnrollment?: boolean`. When true and the principal has NO active enrolment, no session is created (requirement `"required"`, `hasActiveEnrollment: false`). Default false. Customers never pass it. Tests: unenrolled + flag → `sessionId: null`; enrolled + both flags → code path as 1e; flag absent → unchanged; a customer principal is unaffected.
2. **Setup challenge** (`packages/auth/src/native-token-issuer.ts`): `issueChallenge(claims, ttlSeconds?, purpose?: "staff-login-mfa" | "staff-login-mfa-setup")` (default `"staff-login-mfa"`, setup TTL 600 s) and `verifyChallenge(token, purpose?)` that only accepts the requested purpose (a code challenge is refused as a setup challenge and vice versa). Tests for the cross-refusal.
3. **Controller** (`staff-auth.admin-controller.ts`), deps gain `twoStepRequired: boolean` (= `STAFF_TWO_STEP === "required"` AND code step available):
   - `login` passes `requireFactorEnrollment: twoStepRequired`. When `sessionId === null` and `!hasActiveEnrollment` and `twoStepRequired` → 403 `{ error: { code: "MFA_SETUP_REQUIRED", message: "Set up two-step verification to continue" }, setupChallenge, setupChallengeExpiresIn }`. Enrolled → the 1e 403 `MFA_REQUIRED` + `challenge`.
   - `startSetupAtLogin(setupChallenge)` → `verifyChallenge(…, "staff-login-mfa-setup")` (null → 401 `CHALLENGE_EXPIRED`) → `security.startOwnTwoStep({ tenantId, principalExternalId: sub, email })` → 201 `{ enrollmentId, manualKey, provisioningUri }`, no-store.
   - `confirmSetupAtLogin(setupChallenge, enrollmentId, code)` → verify the setup challenge → `security.confirmOwnTwoStep(...)` (wrong code → 401 `INVALID_CODE`) → `establishSession` → `issueSession` (active + role re-check) → 200 `{ accessToken, tokenType, expiresIn, backupCodes }`, no-store. The setup challenge is burned after success (`rl:mfa-setup:<jti>`, like the 1e burn).
   - `disableOwnTwoStep` → 409 `{ code: "TWO_STEP_REQUIRED", message: "Two-step verification is required for everyone, so it can't be turned off" }` when `twoStepRequired` (before the password check).
4. **Routes** (public, not idempotent, rate-limited per member from the signed claims, 6 per 10 min, fail closed; tenant rule exactly as the 1e verify routes: staff route requires challenge tenant = request tenant; merchant route runs `gate(context)` then trusts the signed tenant): `POST /public/auth/staff/login/setup/start` `{ setupChallenge }`, `POST /public/auth/staff/login/setup/confirm` `{ setupChallenge, enrollmentId: uuid, code }`, and the merchant twins `/public/auth/merchant/login/setup/start|confirm`. Reuse `staff-login-verify.ts` helpers (extract shared pieces; do not copy).
5. **Admin reset** (security use case `ResetStaffTwoStep { tenantId; actorExternalId; targetExternalId }` inside `runStaffCommand`): actor must be active admin-level; target not found → NOT_FOUND; target is owner → `BusinessRuleError("The store owner's two-step verification can't be reset")`; target is actor → `BusinessRuleError("Reset your own two-step from your account page")`; revoke the target's active and pending enrolments + revoke all the target's sessions; audit `security.staff.two_step_reset` `{ actor, target }`; activity kind `two_step_reset` ("Sam reset Mona's two-step verification"). Route `POST /staff/:principalExternalId/two-step/reset` `{}` (permission `staff:reset_two_step`, admin-only, idempotent, registered before other `/staff/:id/...` routes as needed); controller calls `liveAccess.invalidate`.
6. **Policy read**: `GET /staff/security-policy` gains `platformRequired: boolean`; `POST /staff/security-policy` → 409 `{ code: "TWO_STEP_REQUIRED", … }` when platform-required. `GET /auth/staff/two-step` gains `platformRequired: boolean` (the panel hides Turn off).
7. **Runtime** (`apps/runtime/src/config.ts`, `composition.ts`): `STAFF_TWO_STEP: z.enum(["required","optional"]).default("required")`; thread `staffTwoStepRequired` into the admin wiring; boot guard: non-local env + `required` + code step unavailable → throw `Error("STAFF_TWO_STEP=required needs MFA_TOTP_KEY and the TOTP provider")` (list it with the other boot guards so one error names all). Local/test defaults: `optional` in the existing local env templates and test configs where tests sign in without two-step (do not break existing suites); document in `.env.example`.

**Tests** (in-process `createAdminHttpApi`, in-memory security with `InMemoryTotpMfaProvider`, `mfaConfigured: true`, `twoStepRequired: true` unless stated): unenrolled staff login → 403 `MFA_SETUP_REQUIRED` + setupChallenge, no token; setup start → key + URI (label = email); confirm wrong → 401 `INVALID_CODE`; confirm right → 200 token + 10 backup codes, and the next login → 403 `MFA_REQUIRED` + challenge (now enrolled); setup challenge reused after success → 401 `CHALLENGE_EXPIRED`; a code challenge used on setup routes → 401 and vice versa; setup challenge for tenant A on tenant B's staff route → 401; merchant setup twins in the multi-tenant harness; 7th setup attempt → 429; customer login unaffected with the rule on; owner (bootstrap, `tenantRef` null) is forced too; `twoStepRequired: false` → 1e behaviour unchanged; disable → 409 `TWO_STEP_REQUIRED`; policy POST → 409; reset: admin resets operator → enrolments revoked, the operator's existing token denied on its next request, their next login → `MFA_SETUP_REQUIRED`; reset owner → 409; reset self → 409; operator/viewer → 403; runtime boot guard (required + no key in production → throws; optional → boots; local → boots).

**Commands:** prefix as 1e. `--filter @platform/security exec vitest run`; `--filter @platform/auth exec vitest run`; `--filter @platform/admin exec vitest run staff public-staff public-merchant public-auth customer-auth live-staff two-step admin-http.e2e`; `--filter @platform/runtime exec vitest run composition config`; tsc for security, auth, admin, runtime; `arch`.

---

### Task 2 — admin-web: setup at sign-in, account page, Users page (implementer: sonnet, UI-only)

1. **Sign-in**: `lib/auth/native.ts` / `merchant.ts` parse 403 `MFA_SETUP_REQUIRED` (+ `setupChallenge`, `setupChallengeExpiresIn`). `app/auth/native-login/route.ts`: store it in httpOnly cookie `morbeh_mfa_setup` (+ the existing `morbeh_mfa_via`), 303 → `/login/setup` (+ safe `return_to`).
2. **`/login/setup`** page (public via the existing `/login` prefix) + route handlers `app/auth/native-login/setup/{start,confirm}/route.ts`: step 1 explains "Your store requires two-step verification. Set it up now." and shows the grouped key with Copy, the `otpauth://` link, and the code input; step 2 shows the 10 backup codes once (Copy all, Download .txt, required checkbox "I saved my backup codes"), then "Continue to dashboard" sets the session cookie that the confirm response returned (keep the access token server-side in the route handler until Continue: the confirm route handler sets the session cookie immediately and returns only the backup codes to the client; Continue just navigates). Errors: `INVALID_CODE` → "That code didn't work. Enter the 6-digit number your app shows now."; `CHALLENGE_EXPIRED` → `/login?error=expired`; 429 → "Too many attempts…". The key and codes never go into a URL or cookie other than the httpOnly challenge cookie.
3. **Code inputs everywhere** (login code step, account setup, setup at sign-in, new backup codes): the authenticator-code input accepts digits only (strip anything else as typed, max 6), placeholder "123456", helper text under the field "The 6-digit number from your app — not the setup key". If the typed value contains letters (pasted key), show inline "This looks like the setup key. Enter the 6-digit number your app shows." and do not submit. Backup-code mode keeps its own text input.
4. **Account page** (`components/account/two-step-panel.tsx`): when `platformRequired`, hide Turn off and show "Required for everyone on Morbeh".
5. **Users page**: when `platformRequired`, `TwoStepPolicyCard` renders the read-only note (no switch). Row action "Reset two-step" (admin, not on owner or self rows) with a destructive Dialog: "<email> will have to set up two-step verification again at their next sign-in. They are signed out now." Server action `resetStaffTwoStepAction` revalidates `/settings/users` and `/settings/users/activity`. Activity sentence for `two_step_reset` (en + ar).
6. Messages en + ar for every new string; Arabic mapping of the exact new server messages.

**Tests:** native/merchant parsing of `MFA_SETUP_REQUIRED`; login route sets the setup cookie and 303s to `/login/setup` (no challenge in Location); setup page flow (start shows key + link; letters in the code field → inline hint, no request; wrong code → message; right code → backup codes, Continue disabled until checkbox; session cookie set by the confirm route; codes absent from `document.body` after Continue); expired → redirect; account panel hides Turn off when platform-required; policy card read-only note; Reset Dialog contract (Cancel focus, Escape while pending, focus restore; owner/self rows have no Reset); activity sentence; middleware `/login/setup` public; i18n parity; client-boundary guard.

**Commands:** `--filter admin-web exec vitest run login auth account settings staff two-step middleware route-contract i18n client --maxWorkers=2 --minWorkers=1`; `--filter admin-web exec tsc --noEmit --incremental false`.

---

## Opus self-review (round 1)

- Lockout: the rule never blocks someone without two-step — setup happens at sign-in (D26). Owner included (bootstrap `tenantRef` null is irrelevant here: the flag is passed by the controller, not read from a tenant profile).
- Fail closed: rule on + code step unavailable in production refuses to boot (D31) instead of silently letting everyone in or locking everyone out; production already has `MFA_TOTP_KEY` (verified 2026-11-26: runtime boots with it set, schema enforces ≥32).
- Customers: untouched (flags only passed by the staff controller).
- Setup challenge cannot be used as a code challenge or a session (purpose + audience checks); burned after success; per-member limiter.
- Secrets: key/URI/backup codes only in no-store responses and client state; the setup confirm route handler sets the session cookie server-side.
- The pasted-key mistake seen in the owner's screenshot (2026-11-26) is handled by the digits-only input and inline hint (Task 2 item 3).
  VERDICT: AGREED.

## Execution order

Task 1 → Task 2 → Opus review per task (tests re-run on HEAD) → push → 13/13 CI → merge → owner publish go-ahead → joint test (the owner signs in and is taken to setup).
