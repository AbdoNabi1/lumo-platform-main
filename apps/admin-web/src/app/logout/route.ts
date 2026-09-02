import { NextResponse, type NextRequest } from "next/server";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/**
 * Clears the local admin session (Phase A.32). Best-effort also starts a Kratos self-service
 * logout so the underlying Kratos SSO session doesn't silently re-authenticate the next login
 * attempt; failures there are non-fatal — the local session cookie is what `middleware.ts`
 * actually checks, so clearing it alone already satisfies "logout -> unauthenticated".
 *
 * Known local-dev limitation (documented, not fixed here): Hydra's own remembered login session
 * (`remember_for: 3600` in `/login`'s accept call) can still let Hydra skip re-prompting within
 * that window even after this logout — out of scope for the smallest-possible-integration bar.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  try {
    const logoutFlow = await fetchWithTimeout(
      `${authConfig.kratosPublicUrl}/self-service/logout/browser`,
      {
        headers: cookieHeader.length > 0 ? { cookie: cookieHeader } : {},
        cache: "no-store",
      },
    );
    if (logoutFlow.ok) {
      const { logout_url: logoutUrl } = (await logoutFlow.json()) as { logout_url?: string };
      if (logoutUrl !== undefined) {
        await fetchWithTimeout(logoutUrl, {
          headers: cookieHeader.length > 0 ? { cookie: cookieHeader } : {},
        });
      }
    }
  } catch {
    // best-effort only — see doc comment above
  }

  const response = NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  // Same domain/path the session cookie was set with (auth/callback/route.ts) — delete() with
  // mismatched attributes silently no-ops instead of clearing it.
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: authConfig.cookieSameSite,
    domain: authConfig.cookieDomain,
    path: "/",
    maxAge: 0,
  });
  return response;
}
