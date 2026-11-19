import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));

const { fetchAbandonedCheckout, fetchAbandonedCheckouts, issueRecoveryLink } =
  await import("./abandoned-checkouts");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("abandoned checkouts API client (order operations Part 3)", () => {
  it("lists with the search, recovery filter and cursor in the query", async () => {
    const page = { items: [], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAbandonedCheckouts({
      first: 50,
      after: "c-1",
      q: "mona",
      recovery: "recovered",
    });
    expect(result).toEqual({ outcome: "ok", data: page });
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/api\/v1\/abandoned-checkouts\?first=50&after=c-1&q=mona&recovery=recovered$/,
    );
  });

  it("omits an empty search", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await fetchAbandonedCheckouts({ q: "" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/abandoned-checkouts$/);
  });

  it("reads one checkout, and a 404 is not_found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" })));
    expect(await fetchAbandonedCheckout("a b")).toEqual({ outcome: "not_found" });
  });

  it("issues a link with POST and sends no idempotency key (every call mints a new token)", async () => {
    const link = {
      url: null,
      path: "/c/tok",
      expiresAt: "2026-10-25T12:00:00.000Z",
      shopName: "Lumo",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, link));
    vi.stubGlobal("fetch", fetchMock);

    expect(await issueRecoveryLink("cs-1")).toEqual({ outcome: "ok", data: link });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/abandoned-checkouts\/cs-1\/recovery-link$/);
    expect(init.method).toBe("POST");
    expect(init.headers as Record<string, string>).not.toHaveProperty("idempotency-key");
  });

  it("an unexpected body shape is an error, never a half-read link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { path: 1 })));
    expect((await issueRecoveryLink("cs-1")).outcome).toBe("error");
  });
});
