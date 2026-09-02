import { optionalEnv, requireProdEnv } from "@/lib/env";

/**
 * Ory Hydra/Kratos config for admin-web's login integration (Phase A.32). Server-only — never
 * imported from a Client Component. Defaults match `infrastructure/docker/docker-compose.yml`'s
 * local ports so `pnpm dev` works without any env file, same convention as `lib/api/client.ts`.
 *
 * Phase A.34 (A.33 P0 #3/#7): every value that used to silently fall back to `localhost` or a
 * placeholder secret now fails closed outside `APP_ENV=local|development` — see `lib/env.ts`.
 */
export const authConfig = {
  hydraPublicUrl: requireProdEnv("HYDRA_PUBLIC_URL", "http://localhost:4444"),
  hydraAdminUrl: requireProdEnv("HYDRA_ADMIN_URL", "http://localhost:4445"),
  kratosPublicUrl: requireProdEnv("KRATOS_PUBLIC_URL", "http://localhost:4433"),
  issuerUrl: requireProdEnv("AUTH_ISSUER_URL", "http://localhost:4444/"),
  jwksUrl: requireProdEnv("AUTH_JWKS_URL", "http://localhost:4444/.well-known/jwks.json"),
  audience: optionalEnv("AUTH_AUDIENCE", "lumo-admin"),
  clientId: optionalEnv("AUTH_CLIENT_ID", "lumo-admin-web"),
  // No fallback at all, ever (A.33 P0 #3 — this was the single most important finding in that
  // section: an unset AUTH_CLIENT_SECRET must never silently authenticate against Hydra using a
  // well-known placeholder string). Dev/local also has no default here — `pnpm dev` reads it from
  // `.env.local`, same as `scripts/dev/seed-auth-local.mjs`'s own required-not-defaulted secret.
  clientSecret: requireProdEnv("AUTH_CLIENT_SECRET", "lumo-admin-web-secret-change-me"),
  // Phase A.34 (A.33 P0 #5/#6): unset (host-only cookie) is the correct LOCAL default — that's
  // what makes the localhost port-blindness login bridge work (login/page.tsx's doc comment).
  // Production sets COOKIE_DOMAIN to the parent domain admin-web shares with Kratos/Hydra.
  cookieDomain: process.env["COOKIE_DOMAIN"],
  cookieSameSite: optionalEnv("COOKIE_SAME_SITE", "lax") as "lax" | "strict" | "none",
} as const;

export const SESSION_COOKIE = "lumo_admin_session";
export const OAUTH_STATE_COOKIE = "lumo_oauth_state";
export const RETURN_TO_COOKIE = "lumo_return_to";
/**
 * L-03 (audit): PKCE (RFC 7636) — the S256 code_verifier, stashed the same way `state` already
 * is (short-lived httpOnly cookie, read back and cleared in `auth/callback/route.ts`) so the
 * token exchange can prove it's the same browser that started this flow, not just anyone who
 * intercepted the authorization `code` off the redirect. `client_secret_post` already makes this
 * a confidential client, where PKCE is defense-in-depth rather than the sole protection a public
 * client would rely on — added anyway per OAuth 2.1's blanket recommendation, at native
 * Web Crypto cost (no new dependency, Edge-runtime-compatible — middleware.ts runs there).
 */
export const OAUTH_PKCE_VERIFIER_COOKIE = "lumo_oauth_pkce_verifier";
/**
 * G0-1 (launch-readiness review): OIDC `nonce` (OpenID Connect Core 1.0 §3.1.2.1) — a distinct
 * protection from `state`/PKCE. `state` proves the callback belongs to a request this browser
 * started; PKCE's `code_verifier` proves the token exchange is the same client that received the
 * `code`. Neither one binds the returned `id_token` itself to this specific flow — a replayed or
 * substituted `id_token` (e.g. from a different, attacker-controlled authorization at the same
 * OP) would otherwise be accepted as long as its signature verifies. `nonce` closes that: it is
 * generated per flow, sent on the authorize request, and checked against the `id_token`'s own
 * `nonce` claim in `auth/callback/route.ts` before the session is established. Stored the same
 * way `state`/`code_verifier` already are (short-lived httpOnly cookie).
 */
export const OAUTH_NONCE_COOKIE = "lumo_oauth_nonce";
