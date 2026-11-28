// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { LEAD_CLAIM_TTL_SECONDS } from "@platform/tracking";
import {
  isSessionId,
  LEAD_SENT_COOKIE,
  VISITOR_SESSION_COOKIE,
  VISITOR_SESSION_TTL_SECONDS,
  withVisitorSession,
} from "./visitor-session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function requestWith(cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", cookie);
  return new NextRequest("https://shop.example/", { headers });
}

beforeEach(() => {
  expect.hasAssertions();
});

describe("VISITOR_SESSION_TTL_SECONDS", () => {
  it("equals the lead claim lifetime, so the cookie and the Redis claim expire together", () => {
    expect(VISITOR_SESSION_TTL_SECONDS).toBe(LEAD_CLAIM_TTL_SECONDS);
    expect(VISITOR_SESSION_TTL_SECONDS).toBe(1800);
  });
});

describe("isSessionId", () => {
  it("accepts 1-64 letters, digits and hyphens only", () => {
    expect(isSessionId("abc-123")).toBe(true);
    expect(isSessionId("a".repeat(64))).toBe(true);
    expect(isSessionId("a".repeat(65))).toBe(false);
    expect(isSessionId("")).toBe(false);
    expect(isSessionId("bad id!")).toBe(false);
    expect(isSessionId(undefined)).toBe(false);
  });
});

describe("withVisitorSession", () => {
  it("re-issues a valid session id unchanged, 30 minutes, readable by scripts", () => {
    const response = withVisitorSession(requestWith("morbeh_sid=abc-123"), NextResponse.next());

    expect(response.cookies.get(VISITOR_SESSION_COOKIE)).toMatchObject({
      value: "abc-123",
      path: "/",
      maxAge: 1800,
      sameSite: "lax",
      secure: false,
    });
    const header = response.headers.getSetCookie().find((c) => c.startsWith("morbeh_sid="));
    expect(header).toBeDefined();
    expect(header).not.toMatch(/httponly/i);
  });

  it.each([[undefined], ["morbeh_sid=bad%20id!"], ["morbeh_sid="]])(
    "mints a new UUID when the cookie is %s",
    (cookie) => {
      const response = withVisitorSession(requestWith(cookie), NextResponse.next());
      expect(response.cookies.get(VISITOR_SESSION_COOKIE)?.value).toMatch(UUID);
    },
  );

  it("mints a different id for every new visitor", () => {
    const a = withVisitorSession(requestWith(), NextResponse.next());
    const b = withVisitorSession(requestWith(), NextResponse.next());
    expect(a.cookies.get(VISITOR_SESSION_COOKIE)?.value).not.toBe(
      b.cookies.get(VISITOR_SESSION_COOKIE)?.value,
    );
  });

  it("marks the cookie secure in production", () => {
    const previous = process.env.NODE_ENV;
    try {
      Object.assign(process.env, { NODE_ENV: "production" });
      const response = withVisitorSession(requestWith("morbeh_sid=abc-123"), NextResponse.next());
      expect(response.cookies.get(VISITOR_SESSION_COOKIE)?.secure).toBe(true);
    } finally {
      Object.assign(process.env, { NODE_ENV: previous });
    }
  });

  it("returns the response it was given, redirects and refusals included", () => {
    const redirect = NextResponse.redirect("https://shop.example/password", 302);
    const refusal = new NextResponse("no", { status: 403 });
    for (const response of [redirect, refusal]) {
      const wrapped = withVisitorSession(requestWith(), response);
      expect(wrapped).toBe(response);
      expect(wrapped.cookies.get(VISITOR_SESSION_COOKIE)?.maxAge).toBe(1800);
    }
    expect(redirect.status).toBe(302);
    expect(refusal.status).toBe(403);
  });

  describe("the sent marker", () => {
    it("slides with the session when it names the current session", () => {
      const response = withVisitorSession(
        requestWith("morbeh_sid=abc-123; morbeh_lead_sent=abc-123"),
        NextResponse.next(),
      );
      expect(response.cookies.get(LEAD_SENT_COOKIE)).toMatchObject({
        value: "abc-123",
        path: "/",
        maxAge: 1800,
        sameSite: "lax",
        httpOnly: true,
        secure: false,
      });
    });

    it("is deleted when it names a different session", () => {
      const response = withVisitorSession(
        requestWith("morbeh_sid=abc-123; morbeh_lead_sent=other-sid"),
        NextResponse.next(),
      );
      expect(response.cookies.get(LEAD_SENT_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
    });

    it("is deleted when the session id was just minted", () => {
      const response = withVisitorSession(
        requestWith("morbeh_lead_sent=abc-123"),
        NextResponse.next(),
      );
      expect(response.cookies.get(VISITOR_SESSION_COOKIE)?.value).not.toBe("abc-123");
      expect(response.cookies.get(LEAD_SENT_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
    });

    it("is not touched when the visitor has none", () => {
      const response = withVisitorSession(requestWith("morbeh_sid=abc-123"), NextResponse.next());
      expect(response.cookies.get(LEAD_SENT_COOKIE)).toBeUndefined();
    });
  });
});
