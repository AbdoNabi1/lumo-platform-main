import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import {
  authConfig,
  OAUTH_NONCE_COOKIE,
  OAUTH_PKCE_VERIFIER_COOKIE,
  OAUTH_STATE_COOKIE,
  RETURN_TO_COOKIE,
  SESSION_COOKIE,
} from "@/lib/auth/config";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { safeReturnTo } from "@/lib/auth/safe-return-to";

// Module-level cache (mirrors middleware.ts's own `jwks` singleton) — createRemoteJWKSet keeps
// its own internal key cache keyed by this instance, so reusing it across requests is what
// actually avoids re-fetching Hydra's JWKS document on every callback.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  jwks ??= createRemoteJWKSet(new URL(authConfig.jwksUrl));
  return jwks;
}

/**
 * OAuth2 authorization_code callback (Phase A.32) — the `redirect_uri` registered on the
 * `lumo-admin-web` Hydra client. Exchanges the code for a real RS256 JWT at Hydra's token
 * endpoint and stores it as an httpOnly session cookie; nothing else in the app ever sees a
 * client secret or talks to Hydra's token endpoint directly.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const error = searchParams.get("error");
  if (error !== null) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, origin));
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  // L-03 (audit): PKCE — the code_verifier middleware.ts stashed alongside `state` when it built
  // the authorize redirect. Missing here means either a forged/replayed callback (no verifier was
  // ever set for it) or an expired flow (the cookie's 300s maxAge lapsed) — same failure posture
  // as a missing/mismatched `state`, not a silent PKCE-skip.
  const codeVerifier = request.cookies.get(OAUTH_PKCE_VERIFIER_COOKIE)?.value;
  // G0-1 (launch-readiness review): the OIDC nonce middleware.ts stashed alongside `state`/
  // `code_verifier`. Checked against the id_token's own `nonce` claim below, once the token
  // exchange returns one — same missing-cookie failure posture as state/PKCE above.
  const expectedNonce = request.cookies.get(OAUTH_NONCE_COOKIE)?.value;
  if (
    code === null ||
    state === null ||
    expectedState === undefined ||
    state !== expectedState ||
    codeVerifier === undefined ||
    expectedNonce === undefined
  ) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", origin));
  }

  const tokenResponse = await fetchWithTimeout(`${authConfig.hydraPublicUrl}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: new URL("/auth/callback", origin).toString(),
      client_id: authConfig.clientId,
      client_secret: authConfig.clientSecret,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenResponse.ok) {
    return NextResponse.redirect(new URL("/login?error=token_exchange_failed", origin));
  }
  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    expires_in: number;
    id_token?: string;
  };

  // G0-1 (launch-readiness review): OIDC Core 1.0 §3.1.2.1 — a returned id_token whose `nonce`
  // claim doesn't match the value this exact flow generated is either replayed from a different
  // authorization or substituted from another OP entirely; `jwtVerify` already confirms the
  // signature/issuer/audience, but none of those catch a *replayed, validly-signed* id_token.
  // `openid` is always in the requested scope (middleware.ts), so a compliant OP always returns
  // one — treating a missing id_token as a failure, not a silent skip, is the point.
  if (tokens.id_token === undefined) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", origin));
  }
  try {
    const { payload } = await jwtVerify(tokens.id_token, getJwks(), {
      issuer: authConfig.issuerUrl,
      audience: authConfig.clientId,
    });
    if (payload["nonce"] !== expectedNonce) {
      return NextResponse.redirect(new URL("/login?error=invalid_state", origin));
    }
  } catch {
    return NextResponse.redirect(new URL("/login?error=invalid_state", origin));
  }

  const response = NextResponse.redirect(
    new URL(safeReturnTo(request.cookies.get(RETURN_TO_COOKIE)?.value, origin), origin),
  );
  response.cookies.set(SESSION_COOKIE, tokens.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: authConfig.cookieSameSite,
    domain: authConfig.cookieDomain,
    path: "/",
    maxAge: tokens.expires_in,
  });
  // Same domain/path the state/return-to cookies were set with (middleware.ts) — delete() with
  // mismatched attributes silently no-ops instead of clearing them.
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: authConfig.cookieSameSite,
    domain: authConfig.cookieDomain,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(RETURN_TO_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: authConfig.cookieSameSite,
    domain: authConfig.cookieDomain,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(OAUTH_PKCE_VERIFIER_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: authConfig.cookieSameSite,
    domain: authConfig.cookieDomain,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(OAUTH_NONCE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: authConfig.cookieSameSite,
    domain: authConfig.cookieDomain,
    path: "/",
    maxAge: 0,
  });
  return response;
}
