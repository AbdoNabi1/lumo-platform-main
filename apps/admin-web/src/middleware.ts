import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { optionalEnv, requireProdEnv } from "@/lib/env";
import { deriveCodeChallenge, generateCodeVerifier } from "@/lib/auth/pkce";

/**
 * Admin route gate (Phase A.32) + role gate (Phase A.34). Runs on the Edge runtime, so it reads
 * `process.env` (via `lib/env.ts`, which has zero Node dependencies — safe for Edge) rather than
 * importing `lib/auth/config.ts` — these are the same env vars with the same defaults, kept as two
 * reads deliberately so this file's dependency graph stays minimal and Edge-safe by inspection,
 * not by convention.
 *
 * Unauthenticated / expired / invalid session cookie -> redirect to Hydra's authorize endpoint,
 * which is the actual entry point of the OAuth2 authorization_code flow (Hydra then bounces the
 * browser to `/login` with a `login_challenge` if there's no active Hydra session yet). Required
 * behavior per the phase brief: unauthenticated -> login, expired/invalid token -> login.
 *
 * Phase A.34 (A.33 P0 #4): authenticated but under-privileged -> `/forbidden`, never silently
 * through. `roles`/`kind` were parsed since Phase A.32 but never checked anywhere — "valid JWT ==
 * full admin access" regardless of role. `ROUTE_ROLE_REQUIREMENTS` maps each screen to the lowest
 * role tier allowed in (admin ⊇ operator ⊇ viewer, `ROLE_RANK` below), reusing the existing
 * `roles` JWT claim — no new authorization architecture, no new claim shape.
 */
const HYDRA_PUBLIC_URL = requireProdEnv("HYDRA_PUBLIC_URL", "http://localhost:4444");
const AUTH_ISSUER_URL = requireProdEnv("AUTH_ISSUER_URL", "http://localhost:4444/");
const AUTH_JWKS_URL = requireProdEnv(
  "AUTH_JWKS_URL",
  "http://localhost:4444/.well-known/jwks.json",
);
const AUTH_AUDIENCE = optionalEnv("AUTH_AUDIENCE", "lumo-admin");
const AUTH_CLIENT_ID = optionalEnv("AUTH_CLIENT_ID", "lumo-admin-web");
const COOKIE_DOMAIN = process.env["COOKIE_DOMAIN"];
const COOKIE_SAME_SITE = optionalEnv("COOKIE_SAME_SITE", "lax") as "lax" | "strict" | "none";

const SESSION_COOKIE = "lumo_admin_session";
const OAUTH_STATE_COOKIE = "lumo_oauth_state";
const RETURN_TO_COOKIE = "lumo_return_to";
/** L-03 (audit) — see lib/auth/config.ts's OAUTH_PKCE_VERIFIER_COOKIE (same value, redefined
 * locally here for the same Edge-safe-by-inspection reason as the three constants above). */
const PKCE_VERIFIER_COOKIE = "lumo_oauth_pkce_verifier";
/** G0-1 (launch-readiness review) — see lib/auth/config.ts's OAUTH_NONCE_COOKIE (same value,
 * redefined locally here for the same Edge-safe-by-inspection reason as the constants above). */
const NONCE_COOKIE = "lumo_oauth_nonce";

// Hydra's own login/consent callbacks, the token-exchange callback, and the dependency-free health
// probe must never be gated — gating them would create a redirect loop back into themselves (or,
// for /api/healthz, make container/k8s health checks depend on the auth backend being reachable).
const PUBLIC_PREFIXES = ["/login", "/consent", "/auth/callback", "/logout", "/api/healthz"];

// Authenticated-but-role-exempt: reachable by ANY authenticated session regardless of role, so
// `/forbidden` itself can never redirect-loop into another `/forbidden`.
const ROLE_EXEMPT_PREFIXES = ["/forbidden"];

type Role = "viewer" | "operator" | "admin";
const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

// Every admin-web screen (Phase A.30/A.31's operator surface), mapped to its minimum required
// role. Config/security-adjacent screens require admin; write-capable operational screens require
// operator; read-only operational screens require viewer. Longest-prefix match; unlisted routes
// (public auth routes aside) default to "admin" — deny-by-default rather than accidentally open.
const ROUTE_ROLE_REQUIREMENTS: readonly (readonly [string, Role])[] = [
  ["/settings", "admin"],
  ["/integrations", "admin"],
  ["/security", "admin"],
  ["/finance", "admin"],
  ["/feature-registry", "admin"],
  ["/feature-flags/new", "operator"],
  ["/feature-flags", "viewer"],
  ["/experiments/new", "operator"],
  ["/experiments", "viewer"],
  ["/automations", "operator"],
  ["/discounts", "operator"],
  ["/promotions/new", "operator"],
  ["/promotions", "viewer"],
  ["/content", "operator"],
  ["/pages/new", "operator"],
  ["/pages", "viewer"],
  ["/templates/new", "operator"],
  ["/templates", "viewer"],
  ["/seo/profiles/new", "operator"],
  ["/seo/redirects/new", "operator"],
  ["/seo/sitemaps/new", "operator"],
  ["/seo/robots-policies/new", "operator"],
  ["/seo", "viewer"],
  ["/theme/new", "operator"],
  ["/theme", "viewer"],
  ["/components-library/new", "operator"],
  ["/components-library", "viewer"],
  ["/marketing", "operator"],
  ["/customers", "viewer"],
  ["/reviews/new", "operator"],
  ["/reviews", "viewer"],
  ["/notifications/new", "operator"],
  ["/notifications", "viewer"],
  ["/locales/new", "operator"],
  ["/locales", "viewer"],
  ["/translation-sets/new", "operator"],
  ["/translation-sets", "viewer"],
  ["/orders/new", "operator"],
  ["/orders/from-checkout", "operator"],
  ["/orders", "viewer"],
  ["/products/new", "operator"],
  ["/products", "viewer"],
  ["/categories", "viewer"],
  ["/brands", "viewer"],
  ["/inventory", "operator"],
  ["/pricing", "operator"],
  ["/analytics", "viewer"],
  ["/", "viewer"],
];

function requiredRoleFor(pathname: string): Role {
  let best: readonly [string, Role] | undefined;
  for (const entry of ROUTE_ROLE_REQUIREMENTS) {
    const [prefix] = entry;
    const matches =
      prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (matches && (best === undefined || prefix.length > best[0].length)) {
      best = entry;
    }
  }
  return best?.[1] ?? "admin";
}

function highestRole(roles: readonly unknown[]): Role | undefined {
  const known = roles.filter(
    (role): role is Role => role === "admin" || role === "operator" || role === "viewer",
  );
  if (known.length === 0) return undefined;
  return known.reduce((highest, role) => (ROLE_RANK[role] > ROLE_RANK[highest] ? role : highest));
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks() {
  jwks ??= createRemoteJWKSet(new URL(AUTH_JWKS_URL));
  return jwks;
}

function clearAuthCookies(response: NextResponse): void {
  // A cookie set with a `domain` attribute is a distinct cookie from one without — deleting must
  // pass the same `domain` (and `path`) it was set with, or the browser keeps the original.
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: COOKIE_SAME_SITE,
    domain: COOKIE_DOMAIN,
    path: "/",
    maxAge: 0,
  });
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search, origin } = request.nextUrl;

  if (
    PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token !== undefined && token.length > 0) {
    try {
      const { payload } = await jwtVerify(token, getJwks(), {
        issuer: AUTH_ISSUER_URL,
        audience: AUTH_AUDIENCE,
      });

      if (
        ROLE_EXEMPT_PREFIXES.some(
          (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
        )
      ) {
        return NextResponse.next();
      }

      const rolesClaim = payload["roles"];
      const roles = Array.isArray(rolesClaim) ? rolesClaim : [];
      const role = highestRole(roles);
      const required = requiredRoleFor(pathname);
      if (role === undefined || ROLE_RANK[role] < ROLE_RANK[required]) {
        return NextResponse.redirect(new URL("/forbidden", origin));
      }
      return NextResponse.next();
    } catch {
      // expired / invalid / wrong-issuer token -> fall through and re-authenticate
    }
  }

  const state = crypto.randomUUID();
  // L-03 (audit): PKCE (RFC 7636, S256) — see lib/auth/pkce.ts's own doc comment for why this is
  // added even for this confidential (client_secret-bearing) client.
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);
  // G0-1 (launch-readiness review): OIDC `nonce` — see lib/auth/config.ts's OAUTH_NONCE_COOKIE
  // doc comment for why this is a distinct protection from `state`/PKCE, not a duplicate of them.
  const nonce = crypto.randomUUID();
  const authorizeUrl = new URL("/oauth2/auth", HYDRA_PUBLIC_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", AUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", new URL("/auth/callback", origin).toString());
  authorizeUrl.searchParams.set("scope", "openid lumo.admin");
  authorizeUrl.searchParams.set("audience", AUTH_AUDIENCE);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("nonce", nonce);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: COOKIE_SAME_SITE,
    domain: COOKIE_DOMAIN,
    path: "/",
    maxAge: 300,
  });
  response.cookies.set(PKCE_VERIFIER_COOKIE, codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: COOKIE_SAME_SITE,
    domain: COOKIE_DOMAIN,
    path: "/",
    maxAge: 300,
  });
  response.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: COOKIE_SAME_SITE,
    domain: COOKIE_DOMAIN,
    path: "/",
    maxAge: 300,
  });
  response.cookies.set(RETURN_TO_COOKIE, `${pathname}${search}`, {
    httpOnly: true,
    secure: true,
    sameSite: COOKIE_SAME_SITE,
    domain: COOKIE_DOMAIN,
    path: "/",
    maxAge: 300,
  });
  clearAuthCookies(response);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
