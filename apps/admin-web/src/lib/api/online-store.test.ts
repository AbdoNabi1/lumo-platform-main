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

const ITEM_ID = "0b0e7a3c-4f6a-4c1e-9d55-6f1a2b3c4d5e";
const menuView = {
  id: null,
  handle: "main-menu",
  title: "Main menu",
  isDefault: true,
  version: 0,
  items: [
    {
      id: ITEM_ID,
      label: { en: "Sale" },
      link: { type: "collection", id: "c-1" },
      broken: false,
      targetTitle: "Sale",
      children: [
        {
          id: "1b0e7a3c-4f6a-4c1e-9d55-6f1a2b3c4d5e",
          label: { ar: "الشروط" },
          link: { type: "policy", policy: "terms" },
          broken: false,
          targetTitle: "terms",
          children: [],
        },
      ],
    },
  ],
};
type Call = [string, RequestInit & { headers: Record<string, string> }];

describe("online-store menus API client (Part 2, spec 2.6)", () => {
  it("lists the menus off GET /online-store/menus (online_store:read)", async () => {
    const summary = {
      id: null,
      handle: "main-menu",
      title: "Main menu",
      itemCount: 1,
      isDefault: true,
      topLabels: [{ en: "Home" }],
    };
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(200, { menus: [summary] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.fetchMenus()).toEqual({ outcome: "ok", data: [summary] });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://runtime.test/api/v1/online-store/menus",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { menus: [{ handle: "x" }] })),
    );
    expect((await api.fetchMenus()).outcome).toBe("error");
  });

  it("reads one menu by its encoded handle and guards the view's exact shape", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(200, menuView));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.fetchMenu("main-menu")).toEqual({ outcome: "ok", data: menuView });
    await api.fetchMenu("a/../b");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "http://runtime.test/api/v1/online-store/menus/a%2F..%2Fb",
    );
    const { isDefault: _dropped, ...withoutDefault } = menuView;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, withoutDefault)),
    );
    expect((await api.fetchMenu("main-menu")).outcome).toBe("error");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, { ...menuView, items: [{ ...menuView.items[0], broken: "no" }] }),
      ),
    );
    expect((await api.fetchMenu("main-menu")).outcome).toBe("error");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(404, { code: "MENU_NOT_FOUND" })),
    );
    expect(await api.fetchMenu("gone")).toEqual({ outcome: "not_found" });
  });

  it("creates with POST and one key", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(201, { ...menuView, handle: "sale", isDefault: false, id: "m-1", version: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = { handle: "sale", title: "Sale", items: [] };
    expect((await api.createMenu(body, "key-c")).outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as Call;
    expect(url).toBe("http://runtime.test/api/v1/online-store/menus");
    expect(init.method).toBe("POST");
    expect(init.headers["idempotency-key"]).toBe("key-c");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it("updates with PUT on the encoded handle, with the expected version and one key", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(200, menuView));
    vi.stubGlobal("fetch", fetchMock);
    const body = { title: "Main", items: [], expectedVersion: 0 };
    expect((await api.updateMenu("main-menu", body, "key-u")).outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as Call;
    expect(url).toBe("http://runtime.test/api/v1/online-store/menus/main-menu");
    expect(init.method).toBe("PUT");
    expect(init.headers["idempotency-key"]).toBe("key-u");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it("maps an oversized menu (422 INVALID_CONTENT, items: MENU_TOO_LARGE) to invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(422, {
          code: "INVALID_CONTENT",
          message: "INVALID_CONTENT: Check the highlighted fields.",
          fields: [{ field: "items", message: "MENU_TOO_LARGE" }],
        }),
      ),
    );
    expect(
      await api.updateMenu("footer", { title: "F", items: [], expectedVersion: 1 }, "k"),
    ).toEqual({
      outcome: "invalid",
      message: "INVALID_CONTENT: Check the highlighted fields.",
      fields: [{ field: "items", message: "MENU_TOO_LARGE" }],
    });
  });

  it("deletes with DELETE on the encoded handle, a key and no body", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(200, { handle: "summer sale" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.deleteMenu("summer sale", "key-d")).toEqual({
      outcome: "ok",
      data: { handle: "summer sale" },
    });
    const [url, init] = fetchMock.mock.calls[0] as Call;
    expect(url).toBe("http://runtime.test/api/v1/online-store/menus/summer%20sale");
    expect(init.method).toBe("DELETE");
    expect(init.headers["idempotency-key"]).toBe("key-d");
    expect(init.body).toBeUndefined();
    expect(init.headers["content-type"]).toBeUndefined();
  });

  it("searches link targets with the type passed through and the query encoded", async () => {
    const targets = [{ id: "c-1", title: "Sale", subtitle: "/collections/sale" }];
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(200, { targets }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.searchLinkTargets("collection", "تخفيض & co")).toEqual({
      outcome: "ok",
      data: targets,
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v1/online-store/link-targets");
    expect(url.searchParams.get("type")).toBe("collection");
    expect(url.searchParams.get("q")).toBe("تخفيض & co");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("تخفيض");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { targets: [{ id: 1 }] })),
    );
    expect((await api.searchLinkTargets("page", "")).outcome).toBe("error");
  });
});
