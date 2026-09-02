import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const {
  fetchLocalesPage,
  fetchLocale,
  fetchTranslationSetsPage,
  fetchTranslationSet,
  createLocale,
  createTranslationSet,
  setTranslation,
  publishTranslation,
} = await import("./localization");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const LOCALE: unknown = {
  id: "locale-1",
  code: "en",
  name: "English",
  isDefault: true,
  fallbackLocaleRef: null,
  status: "active",
};

const TRANSLATION_SET: unknown = {
  id: "set-1",
  localeRef: "locale-1",
  namespace: "checkout",
  translations: [{ key: "cta.buy", value: "Buy now", status: "draft" }],
};

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchLocalesPage", () => {
  it("returns items and pageInfo on success", async () => {
    const page = { items: [LOCALE], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchLocalesPage({ first: 20 });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/locales?first=20");
  });

  it("surfaces unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLocalesPage({});

    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("fetchLocale", () => {
  it("returns the locale on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, LOCALE));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchLocale("locale-1");

    expect(result).toEqual({ outcome: "ok", locale: LOCALE });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/locales/locale-1");
  });

  it("surfaces not_found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLocale("missing");

    expect(result).toEqual({ outcome: "not_found" });
  });
});

describe("fetchTranslationSetsPage", () => {
  it("returns items and pageInfo on success", async () => {
    const page = { items: [TRANSLATION_SET], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchTranslationSetsPage({ first: 10 });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/translation-sets?first=10");
  });
});

describe("fetchTranslationSet", () => {
  it("returns the translation set on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, TRANSLATION_SET));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchTranslationSet("set-1");

    expect(result).toEqual({ outcome: "ok", translationSet: TRANSLATION_SET });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/translation-sets/set-1");
  });

  it("surfaces not_found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTranslationSet("missing");

    expect(result).toEqual({ outcome: "not_found" });
  });
});

describe("createLocale", () => {
  it("sends the right path, method, body and idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "locale-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { code: "fr", name: "French", isDefault: false };
    const result = await createLocale(input, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "locale-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/locales");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("maps a 422 to invalid, preserving the fields", async () => {
    const envelope = {
      message: "Invalid input",
      fields: [{ field: "code", message: "must not be empty" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createLocale({ code: "", name: "x", isDefault: false }, "key-1");

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "code", message: "must not be empty" }],
    });
  });
});

describe("createTranslationSet", () => {
  it("sends localeRef/namespace with the idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "set-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { localeRef: "locale-1", namespace: "checkout" };
    const result = await createTranslationSet(input, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "set-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/translation-sets");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});

describe("setTranslation", () => {
  it("posts key/value to the translations route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await setTranslation("set-1", { key: "cta.buy", value: "Buy now" }, "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/translation-sets/set-1/translations");
    expect(JSON.parse(init.body as string)).toEqual({ key: "cta.buy", value: "Buy now" });
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });
});

describe("publishTranslation", () => {
  it("posts key to the publish route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await publishTranslation("set-1", "cta.buy", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://runtime.test/api/v1/translation-sets/set-1/translations/publish",
    );
    expect(JSON.parse(init.body as string)).toEqual({ key: "cta.buy" });
  });
});
