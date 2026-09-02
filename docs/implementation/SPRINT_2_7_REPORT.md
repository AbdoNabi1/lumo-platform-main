# Sprint 2.7 Report — Authentication & Authorization Platform

> 2026-07-05. Everything behind the EXISTING ports (`Authenticator`/`AccessControl`/`AuditTrail`
>
> - Sprint-2.3 `Cache`); zero Ory SDK anywhere; business contexts remain Ory-unaware; no fake
>   identity provider, no hardcoded users, no temporary auth.

## Delivered — new package `@platform/auth`

**`JwtVerifier` (`ClaimsAuthenticator`):** JWKS-based (jose) verification of signature, issuer,
audience, exp/nbf with bounded clock tolerance (30s default); key rotation via remote JWKS
refresh-on-unknown-kid; claims mapped to `Principal` (`sub`/`kind`/`roles`) with `tenant_id`
and scopes exposed as verified claims; invalid tokens uniformly resolve `null` → 401 (flat
timing across failure reasons). Refresh tokens NEVER reach the verifier — rotation is the
issuer's contract (Kratos/Hydra), recorded explicitly.

**Kratos adapters (raw REST, injectable fetch):** `KratosSessionAuthenticator` (whoami →
principal + tenant claim, session-validation caching with a 15s TTL = the revocation-latency
window) and `KratosIdentityService` (identity lookup, session revocation — **audited** via the
`AuditTrail` port). Boundary honesty: registration/login/logout/password-reset/email-verification
/MFA/WebAuthn/passkeys/social/OIDC (and SAML via upstream IdP) are **Kratos self-service flows** —
configured, not coded; reimplementing them server-side would duplicate Kratos and re-own its
attack surface. Login/logout audit arrives via Kratos webhooks (seam documented; receiver is a
`defineRoute` away on the existing transport).

**Keto adapters:** `KetoAccessControl` implements the SAME `AccessControl` port `AdminGuard`
already consumes — swapping `AllowAllAccessControl` for real RBAC is one composition line.
Permission model unchanged (`"<module>:<action>"` — no second permission system): grant =
relation-tuple check; roles/hierarchy = Keto subject-sets (ReBAC-ready); tenant-scoped grants
extend the tuple object when Tenancy lands (no port change). **Fail-closed** on any error — an
authorization outage can never become a bypass. `CachedAccessControl` decorator (Sprint-2.3
`Cache` port) caches decisions; the TTL IS the revocation latency (30s default, per-surface).

**Contracts (additive):** `ClaimsAuthenticator`/`AuthenticatedContext` — optional extension;
every existing `Authenticator` stays valid.

**Transport activation:** the 2.6 pipeline now consumes verified claims — claim-based tenant
resolution is LIVE (`claimTenantResolver` reads `tenant_id` from the verified token), keeping
the mandated order: request-id → correlation → trace echo → authentication → tenant-first →
authorization → rate limit → idempotency → validation → application.

**Compose:** Kratos/Keto containers deliberately NOT added this session — the engine is down, so
an unvalidatable YAML block would be a fake; they join the stack in the first live session
(first-boot runbook addendum recorded there).

## Testing

**14 new tests, all genuinely green offline:** JWT (5 — valid mapping incl. tenant claim, wrong
aud/iss/expired → null, bounded clock skew, foreign-key signature rejection, kind defaulting),
Ory contract tests with injected fetch (6 — whoami mapping + session caching, 401/inactive →
null, audited revocation, Keto tuple-check shape, **fail-closed** on 500/ECONNREFUSED, decision
caching), tenant-resolution chain (3 — claim precedence, claim→header→domain fallthrough,
no-default-null). Honestly gated: live Kratos/Keto round-trips (Docker engine down — adapters +
contract tests exist; runtime validation joins the first-boot runbook).

## Validation

lint / typecheck / test / build **115/115** ✅ · dependency-cruiser **0 violations (440
modules)** ✅ · nothing faked.

## Decisions (D-048) / tradeoffs / deferred

Raw REST over Ory SDKs (3 endpoints used; injectable fetch = testable contract; SDK adds surface
without value here) · session/decision caches trade revocation latency (15s/30s) for hot-path
cost — per-surface TTLs, documented · CSRF seam: token-based APIs are CSRF-immune, cookie-based
storefront sessions get Kratos's CSRF handling (noted for the storefront phase). Deferred: Ory
containers in compose + live validation (first boot), Kratos webhook → audit receiver route,
Hydra (OAuth2 for third-party apps, doc 24) when the app platform ships, device-tracking
metadata (Kratos session metadata passthrough exists).
