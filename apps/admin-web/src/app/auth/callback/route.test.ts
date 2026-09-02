import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { jwtVerifyMock } = vi.hoisted(() => ({ jwtVerifyMock: vi.fn() }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const { GET } = await import("./route");

const ORIGIN = "https://admin.lumo.example.com";
const VALID_STATE = "state-abc";
const VALID_VERIFIER = "verifier-abc";
const VALID_NONCE = "nonce-abc";

function callbackRequest(opts: {
  readonly query?: string;
  readonly cookies?: Readonly<Record<string, string>>;
}): NextRequest {
  const headers = new Headers();
  const cookies = opts.cookies ?? {
    lumo_oauth_state: VALID_STATE,
    lumo_oauth_pkce_verifier: VALID_VERIFIER,
    lumo_oauth_nonce: VALID_NONCE,
  };
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (cookieHeader.length > 0) headers.set("cookie", cookieHeader);
  const query = opts.query ?? `code=auth-code&state=${VALID_STATE}`;
  return new NextRequest(new URL(`/auth/callback?${query}`, ORIGIN), { headers });
}

function mockTokenResponse(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: ok ? 200 : 400,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

/**
 * G0-2 (launch-readiness review) — the callback route had zero test coverage of its own request
 * validation (state/PKCE/nonce checks, token-exchange handling), the exact code that decides
 * whether a login attempt is accepted. Only the pure `safeReturnTo` helper it calls was tested.
 */
describe("GET /auth/callback", () => {
  it("passes an upstream `error` param straight through to /login", async () => {
    const response = await GET(callbackRequest({ query: "error=access_denied" }));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=access_denied`);
  });

  it("rejects a missing `code`", async () => {
    const response = await GET(callbackRequest({ query: `state=${VALID_STATE}` }));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid_state`);
  });

  it("rejects a `state` that doesn't match the cookie (CSRF guard)", async () => {
    const response = await GET(callbackRequest({ query: "code=auth-code&state=wrong-state" }));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid_state`);
  });

  it("rejects a missing PKCE verifier cookie (L-03)", async () => {
    const response = await GET(
      callbackRequest({
        cookies: { lumo_oauth_state: VALID_STATE, lumo_oauth_nonce: VALID_NONCE },
      }),
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid_state`);
  });

  it("rejects a missing nonce cookie (G0-1)", async () => {
    const response = await GET(
      callbackRequest({
        cookies: { lumo_oauth_state: VALID_STATE, lumo_oauth_pkce_verifier: VALID_VERIFIER },
      }),
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid_state`);
  });

  it("surfaces a failed token exchange distinctly from a validation failure", async () => {
    mockTokenResponse({ error: "invalid_grant" }, false);
    const response = await GET(callbackRequest({}));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=token_exchange_failed`);
  });

  it("rejects a token response with no id_token — never silently skips nonce verification (G0-1)", async () => {
    mockTokenResponse({ access_token: "at", expires_in: 3600 });
    const response = await GET(callbackRequest({}));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid_state`);
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("rejects an id_token whose signature/issuer/audience jwtVerify itself rejects", async () => {
    mockTokenResponse({ access_token: "at", expires_in: 3600, id_token: "bad.jwt.token" });
    jwtVerifyMock.mockRejectedValue(new Error("signature verification failed"));
    const response = await GET(callbackRequest({}));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid_state`);
  });

  it("rejects a validly-signed id_token whose nonce claim doesn't match this flow's (G0-1 — the replay case)", async () => {
    mockTokenResponse({ access_token: "at", expires_in: 3600, id_token: "good.jwt.token" });
    jwtVerifyMock.mockResolvedValue({ payload: { nonce: "some-other-flow's-nonce" } });
    const response = await GET(callbackRequest({}));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid_state`);
  });

  it("accepts a fully valid callback: exchanges the code, verifies the nonce, sets the session cookie, clears the flow cookies", async () => {
    mockTokenResponse({
      access_token: "real-access-token",
      expires_in: 3600,
      id_token: "good.jwt",
    });
    jwtVerifyMock.mockResolvedValue({ payload: { nonce: VALID_NONCE } });

    const response = await GET(callbackRequest({}));

    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(response.cookies.get("lumo_admin_session")?.value).toBe("real-access-token");
    expect(response.cookies.get("lumo_oauth_state")?.value).toBe("");
    expect(response.cookies.get("lumo_oauth_pkce_verifier")?.value).toBe("");
    expect(response.cookies.get("lumo_oauth_nonce")?.value).toBe("");
  });

  it("sends the stashed code_verifier to the token endpoint (L-03 — proves PKCE isn't just generated but actually used)", async () => {
    mockTokenResponse({ access_token: "at", expires_in: 3600, id_token: "good.jwt" });
    jwtVerifyMock.mockResolvedValue({ payload: { nonce: VALID_NONCE } });

    await GET(callbackRequest({}));

    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get("code_verifier")).toBe(VALID_VERIFIER);
  });
});
