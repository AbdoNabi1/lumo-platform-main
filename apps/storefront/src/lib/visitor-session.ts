import { type NextResponse, type NextRequest } from "next/server";

/**
 * The visitor's session on the merchant's own domain (Part C, D1). Same name and sliding 30-minute
 * lifetime as the collector's `morbeh_sid`, but first-party: the collector's cookie is third-party on
 * a custom domain. Readable by scripts on purpose (the browser SDK of Plan D reads it).
 *
 * Imported by the middleware, so it stays Edge-light: no `@platform/tracking` here (a test pins
 * the TTL to `LEAD_CLAIM_TTL_SECONDS` instead).
 */
export const VISITOR_SESSION_COOKIE = "morbeh_sid";
/** HttpOnly marker: the session that already had a lead forwarded; the next lead in it is suppressed. */
export const LEAD_SENT_COOKIE = "morbeh_lead_sent";
export const VISITOR_SESSION_TTL_SECONDS = 1800;

const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

export function isSessionId(value: string | undefined): value is string {
  return value !== undefined && SESSION_ID.test(value);
}

export interface VisitorCookieOptions {
  readonly path: "/";
  readonly maxAge: number;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly httpOnly: boolean;
}

/** `morbeh_sid`: sliding 30 minutes, not HttpOnly. */
export function visitorSessionCookieOptions(): VisitorCookieOptions {
  return {
    path: "/",
    maxAge: VISITOR_SESSION_TTL_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  };
}

/** `morbeh_lead_sent`: the same lifetime as the session it names, HttpOnly. */
export function leadSentCookieOptions(): VisitorCookieOptions {
  return { ...visitorSessionCookieOptions(), httpOnly: true };
}

/**
 * Stamps the session cookie on EVERY response the middleware returns (pages, redirects, refusals):
 * the cookie value if it is a valid id, else a new UUID, re-issued with a fresh 30 minutes.
 * The sent marker slides with it while it names this session, and is deleted when it names another
 * one or the id was just minted (an expired session can never inherit a marker).
 */
export function withVisitorSession(request: NextRequest, response: NextResponse): NextResponse {
  const existing = request.cookies.get(VISITOR_SESSION_COOKIE)?.value;
  const minted = !isSessionId(existing);
  const sid = minted ? crypto.randomUUID() : existing;
  response.cookies.set(VISITOR_SESSION_COOKIE, sid, visitorSessionCookieOptions());

  const marker = request.cookies.get(LEAD_SENT_COOKIE)?.value;
  if (marker !== undefined) {
    if (!minted && marker === sid) {
      response.cookies.set(LEAD_SENT_COOKIE, marker, leadSentCookieOptions());
    } else {
      response.cookies.set(LEAD_SENT_COOKIE, "", { ...leadSentCookieOptions(), maxAge: 0 });
    }
  }
  return response;
}
