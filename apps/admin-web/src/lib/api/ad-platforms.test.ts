import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: jwtVerifyMock }));

const { fetchAdPlatforms, saveAdPlatform } = await import("./ad-platforms");

const ORDER = ["meta", "tiktok", "snap", "ga4", "google_ads"] as const;

function emptyView(platform: string) {
  return {
    platform,
    enabled: false,
    publicConfig: null,
    secret: { configured: false, last4: null },
    testEventCode: null,
    complete: false,
    live: false,
    version: 0,
  };
}

const LIST = { items: ORDER.map(emptyView) };

const META_VIEW = {
  ...emptyView("meta"),
  enabled: true,
  publicConfig: { platform: "meta", pixelId: "12345678901234" },
  secret: { configured: true, last4: "1234" },
  complete: true,
  live: true,
  version: 3,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchAdPlatforms", () => {
  it("reads the five connections in the platform order, whatever order the API used", async () => {
    expect.hasAssertions();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { items: [...LIST.items].reverse() }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAdPlatforms();

    expect(result.outcome).toBe("ok");
    expect(result.outcome === "ok" ? result.items.map((item) => item.platform) : []).toEqual([
      ...ORDER,
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://runtime.test/api/v1/ad-platforms");
  });

  it("keeps the secret summary (configured + last4) and the version", async () => {
    expect.hasAssertions();
    const items = [META_VIEW, ...ORDER.slice(1).map(emptyView)];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { items })));

    const result = await fetchAdPlatforms();

    expect(result.outcome === "ok" ? result.items[0] : null).toEqual(META_VIEW);
  });

  it("maps 401 and 403 to unauthorized and a 404 to not_found", async () => {
    expect.hasAssertions();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(401, {})));
    expect(await fetchAdPlatforms()).toEqual({ outcome: "unauthorized" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(403, {})));
    expect(await fetchAdPlatforms()).toEqual({ outcome: "unauthorized" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(404, {})));
    expect(await fetchAdPlatforms()).toEqual({ outcome: "not_found" });
  });

  it("maps a 500, a network failure and a body that is not the contract to error", async () => {
    expect.hasAssertions();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(500, {})));
    expect((await fetchAdPlatforms()).outcome).toBe("error");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
    expect(await fetchAdPlatforms()).toEqual({ outcome: "error", message: "offline" });
    for (const body of [
      { items: ORDER.slice(1).map(emptyView) },
      { items: [...LIST.items, emptyView("meta")] },
      { items: [{ ...emptyView("meta"), version: -1 }, ...ORDER.slice(1).map(emptyView)] },
      { items: [{ ...emptyView("meta"), platform: "x" }, ...ORDER.slice(1).map(emptyView)] },
      {
        items: [
          { ...emptyView("meta"), publicConfig: { platform: "tiktok", pixelCode: "ABCDEFGHIJ" } },
          ...ORDER.slice(1).map(emptyView),
        ],
      },
      LIST.items,
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(200, body)));
      expect((await fetchAdPlatforms()).outcome).toBe("error");
    }
  });
});

describe("saveAdPlatform", () => {
  it("PUTs exactly the body fields with the idempotency key", async () => {
    expect.hasAssertions();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, META_VIEW));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveAdPlatform(
      "meta",
      {
        enabled: true,
        publicConfig: { pixelId: "12345678901234" },
        secret: "fake-secret-value-1234",
        testEventCode: "TEST123",
        expectedVersion: 2,
      },
      "key-1",
    );

    expect(result).toEqual({ outcome: "ok", data: META_VIEW });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/ad-platforms/meta");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
    expect(sentBody(fetchMock)).toEqual({
      enabled: true,
      publicConfig: { pixelId: "12345678901234" },
      secret: "fake-secret-value-1234",
      testEventCode: "TEST123",
      expectedVersion: 2,
    });
  });

  it("never sends secret when it is empty or absent, nor clearSecret unless true", async () => {
    expect.hasAssertions();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, META_VIEW));
    vi.stubGlobal("fetch", fetchMock);

    await saveAdPlatform(
      "meta",
      {
        enabled: false,
        publicConfig: null,
        secret: "",
        clearSecret: false,
        expectedVersion: 0,
      },
      "k",
    );
    await saveAdPlatform("meta", { enabled: false, publicConfig: null, expectedVersion: 0 }, "k");

    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
      expect(body).toEqual({ enabled: false, publicConfig: null, expectedVersion: 0 });
      expect("secret" in body).toBe(false);
      expect("clearSecret" in body).toBe(false);
      expect("testEventCode" in body).toBe(false);
    }
  });

  it("sends clearSecret true, and a null test event code to remove it", async () => {
    expect.hasAssertions();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, META_VIEW));
    vi.stubGlobal("fetch", fetchMock);

    await saveAdPlatform(
      "tiktok",
      {
        enabled: true,
        publicConfig: { pixelCode: "ABCDEFGHIJ" },
        clearSecret: true,
        testEventCode: null,
        expectedVersion: 5,
      },
      "k",
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://runtime.test/api/v1/ad-platforms/tiktok");
    expect(sentBody(fetchMock)).toEqual({
      enabled: true,
      publicConfig: { pixelCode: "ABCDEFGHIJ" },
      clearSecret: true,
      testEventCode: null,
      expectedVersion: 5,
    });
  });

  it("returns a 409 as conflict and a 422 with its field issues", async () => {
    expect.hasAssertions();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(409, { code: "CONCURRENCY", message: "stale" }))
        .mockResolvedValueOnce(
          jsonResponse(422, {
            code: "VALIDATION",
            message: "Invalid ad platform connection",
            fields: [{ field: "publicConfig.pixelId", message: "invalid value" }],
          }),
        ),
    );
    const input = { enabled: true, publicConfig: { pixelId: "x" }, expectedVersion: 1 };

    expect(await saveAdPlatform("meta", input, "k")).toMatchObject({ outcome: "conflict" });
    expect(await saveAdPlatform("meta", input, "k")).toMatchObject({
      outcome: "invalid",
      fields: [{ field: "publicConfig.pixelId", message: "invalid value" }],
    });
  });

  it("keeps the 503 status and the UNAVAILABLE code of a server with no token vault", async () => {
    expect.hasAssertions();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(503, { code: "UNAVAILABLE", message: "no vault" })),
    );

    expect(
      await saveAdPlatform(
        "meta",
        { enabled: true, publicConfig: null, secret: "fake-secret-value-1234", expectedVersion: 0 },
        "k",
      ),
    ).toMatchObject({ outcome: "error", status: 503, code: "UNAVAILABLE" });
  });

  it("refuses an answer that is not a connection view", async () => {
    expect.hasAssertions();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));

    expect(
      (
        await saveAdPlatform(
          "meta",
          { enabled: false, publicConfig: null, expectedVersion: 0 },
          "k",
        )
      ).outcome,
    ).toBe("error");
  });
});
