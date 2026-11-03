import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));
const api = await import("./online-store");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const preferences = {
  homeTitle: { ar: "متجر" },
  homeMetaDescription: {},
  shareImage: null,
  shareImageId: "img-archived",
  defaultLocale: "ar",
  storeName: "Nour",
  version: 4,
};

describe("online-store API client", () => {
  it("reads the theme state and canonicalises both documents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) =>
        json(200, {
          draft: { garbage: true },
          published: null,
          draftRevision: 0,
          draftSavedAt: null,
          publishedDraftRevision: null,
          releaseNumber: 0,
          publishedAt: null,
          publishedBy: null,
          hasUnpublishedChanges: false,
          images: {},
          version: 0,
        }),
      ),
    );
    const result = await api.fetchThemeState();
    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") expect(result.data.draft.schemaVersion).toBe(1);
  });

  it("mints a preview token WITHOUT an idempotency key", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(201, { token: "t".repeat(43), expiresAt: "2026-10-27T11:00:00.000Z", url: null }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect((await api.issuePreviewToken()).outcome).toBe("ok");
    const init = fetchMock.mock.calls[0]?.[1] as {
      headers: Record<string, string>;
      method: string;
    };
    expect(init.method).toBe("POST");
    expect(init.headers["idempotency-key"]).toBeUndefined();
  });

  it("uploads with the purpose in the query and maps 422 to invalid with its code", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(422, {
        code: "BAD_DIMENSIONS",
        min: { width: 32, height: 32 },
        max: 1024,
        square: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await api.uploadOnlineStoreImage({
      bytes: new Uint8Array([1]),
      contentType: "image/png",
      fileName: "f.png",
      purpose: "favicon",
      idempotencyKey: "k",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://runtime.test/api/v1/online-store/images?purpose=favicon",
    );
    expect(result).toEqual({
      outcome: "invalid",
      code: "BAD_DIMENSIONS",
      detail: { code: "BAD_DIMENSIONS", min: { width: 32, height: 32 }, max: 1024, square: true },
    });
  });

  it("maps a duplicate in-flight upload (409 CONFLICT) to conflict, not to a generic error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) =>
        json(409, {
          code: "CONFLICT",
          message: "A request with this Idempotency-Key is in flight",
        }),
      ),
    );
    const result = await api.uploadOnlineStoreImage({
      bytes: new Uint8Array([1]),
      contentType: "image/png",
      fileName: "f.png",
      purpose: "logo",
      idempotencyKey: "k",
    });
    expect(result).toEqual({ outcome: "conflict" });
  });

  it("keeps the stored share image id even when the image itself no longer resolves (F4)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) => json(200, preferences)),
    );
    const result = await api.fetchPreferences();
    expect(result).toEqual({ outcome: "ok", data: preferences });
  });

  it("refuses a preferences body without the share image id field", async () => {
    const { shareImageId: _dropped, ...withoutId } = preferences;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) => json(200, withoutId)),
    );
    expect((await api.fetchPreferences()).outcome).toBe("error");
  });

  it("sends the preferences with the expected version and one idempotency key", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(200, preferences));
    vi.stubGlobal("fetch", fetchMock);
    const body = {
      homeTitle: { ar: "متجر" },
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar" as const,
      expectedVersion: 4,
    };
    expect((await api.updatePreferences(body, "key-1")).outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe("http://runtime.test/api/v1/online-store/preferences");
    expect(init.method).toBe("PUT");
    expect(init.headers["idempotency-key"]).toBe("key-1");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });
});
