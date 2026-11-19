import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));
const api = await import("./pages");

type Call = [string, RequestInit & { headers: Record<string, string> }];
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

const page = {
  id: "p-1",
  name: "About",
  routePath: "/pages/about",
  templateRef: null,
  experienceRef: null,
  seoProfileRef: null,
  localeRef: null,
  status: "draft",
  title: { en: "About us" },
  metaDescription: {},
  body: { en: "## Hello" },
  publishedAt: null,
  updatedAt: "2026-11-01T10:00:00.000Z",
  version: 2,
};

describe("pages API client (Part 2, spec 2.4)", () => {
  it("reads one page with its body, version and update time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, page)),
    );
    expect(await api.fetchPage("p-1")).toEqual({ outcome: "ok", page });
  });

  it("refuses a page without a numeric version (a save could not be guarded)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { ...page, version: undefined })),
    );
    expect((await api.fetchPage("p-1")).outcome).toBe("error");
  });

  it("creates with the title, body and route path in one call and reads the new page id", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(201, { pageId: "p-9", status: "draft" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      name: "About us",
      routePath: "/pages/about-us",
      title: { en: "About us" },
      body: { en: "Hi" },
    };
    expect(await api.createPage(input, "key-c")).toEqual({ outcome: "ok", data: { id: "p-9" } });
    const [url, init] = fetchMock.mock.calls[0] as Call;
    expect(url).toBe("http://runtime.test/api/v1/pages");
    expect(init.headers["idempotency-key"]).toBe("key-c");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("saves content with PUT /pages/:id/content, the version and one idempotency key", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(200, { pageId: "p 1", version: 3 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = {
      title: { en: "About" },
      body: { ar: "نص" },
      metaDescription: {},
      expectedVersion: 2,
    };
    expect(await api.updatePageContent("p 1", body, "key-u")).toEqual({
      outcome: "ok",
      data: { pageId: "p 1", version: 3 },
    });
    const [url, init] = fetchMock.mock.calls[0] as Call;
    expect(url).toBe("http://runtime.test/api/v1/pages/p%201/content");
    expect(init.method).toBe("PUT");
    expect(init.headers["idempotency-key"]).toBe("key-u");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it("maps a lost race to conflict with its code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(409, { code: "VERSION_CONFLICT", message: "VERSION_CONFLICT: changed elsewhere" }),
      ),
    );
    expect(
      await api.updatePageContent(
        "p-1",
        { title: {}, body: {}, metaDescription: {}, expectedVersion: 1 },
        "k",
      ),
    ).toEqual({
      outcome: "conflict",
      message: "VERSION_CONFLICT: changed elsewhere",
      code: "VERSION_CONFLICT",
    });
  });
});
