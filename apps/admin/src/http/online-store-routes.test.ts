import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { DEFAULT_THEME_DOCUMENT, MENU_MAX_BYTES } from "@platform/storefront-content";
import { logger } from "@platform/utils";
import { wireAdmin, type WiredAdmin } from "../composition";
import { onlineStoreRoutes } from "./online-store-routes";
import {
  buildOnlineStoreApp,
  headersFor,
  recordingStorage,
  type StaffRole,
} from "./testing/online-store-harness";

const PNG_64 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64,
  0, 0, 0, 64, 8, 6, 0, 0, 0,
]);
const JPEG_64 = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 64, 0, 64, 3, 0, 0, 0, 0,
]);
const MB = 1024 * 1024;

let key = 0;
const idem = () => ({ "idempotency-key": `os-${(key += 1)}` });

function caller(app: () => FastifyInstance) {
  return (
    role: StaffRole,
    method: "GET" | "PUT" | "POST" | "DELETE",
    url: string,
    payload?: unknown,
    tenantId = "t-1",
  ) =>
    app().inject({
      method,
      url: `/api/v1${url}`,
      headers: headersFor(role, {
        ...(method === "GET" ? {} : idem()),
        "x-tenant-id": tenantId,
      }),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
}

function uploader(app: () => FastifyInstance) {
  return (
    role: StaffRole,
    purpose: string,
    bytes: Uint8Array,
    contentType: string,
    extra: Record<string, string> = {},
  ) =>
    app().inject({
      method: "POST",
      url: `/api/v1/online-store/images?purpose=${purpose}`,
      headers: { ...headersFor(role, idem()), "content-type": contentType, ...extra },
      payload: Buffer.from(bytes),
    });
}

/** Every object key anywhere in a JSON value (arrays and nested objects included). */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
}

describe("online-store admin routes (spec 1.9)", () => {
  let app: FastifyInstance;
  const keys: string[] = [];
  beforeAll(async () => {
    app = await buildOnlineStoreApp({
      serializer: new InMemoryEventSerializer(),
      objectStorage: recordingStorage(keys),
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const call = caller(() => app);

  it("viewers read everything and mint preview tokens, but write nothing", async () => {
    for (const url of [
      "/online-store/preferences",
      "/online-store/access",
      "/online-store/theme",
      "/online-store/theme/releases",
    ]) {
      expect((await call("viewer", "GET", url)).statusCode, url).toBe(200);
    }
    expect((await call("viewer", "POST", "/online-store/preview-tokens", {})).statusCode).toBe(201);
    const writes: [string, string, unknown][] = [
      [
        "PUT",
        "/online-store/preferences",
        {
          homeTitle: {},
          homeMetaDescription: {},
          shareImageId: null,
          defaultLocale: "ar",
          expectedVersion: 0,
        },
      ],
      [
        "PUT",
        "/online-store/theme/draft",
        { document: DEFAULT_THEME_DOCUMENT, expectedVersion: 0 },
      ],
      ["POST", "/online-store/theme/discard-draft", { expectedVersion: 0 }],
      ["POST", "/online-store/theme/publish", { expectedDraftRevision: 1 }],
      ["PUT", "/online-store/access", { locked: false, message: {}, expectedVersion: 0 }],
    ];
    for (const [method, url, body] of writes) {
      expect((await call("viewer", method as "PUT", url, body)).statusCode, url).toBe(403);
    }
  });

  it("operators edit the draft and preferences but cannot publish, restore or lock", async () => {
    const saved = await call("operator", "PUT", "/online-store/theme/draft", {
      document: { ...DEFAULT_THEME_DOCUMENT, header: { sticky: true } },
      expectedVersion: 0,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ draftRevision: 1, version: 1, warnings: [] });
    expect(
      (await call("operator", "POST", "/online-store/theme/publish", { expectedDraftRevision: 1 }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call("operator", "POST", "/online-store/theme/releases/1/restore", {
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call("operator", "PUT", "/online-store/access", {
          locked: true,
          password: "1234",
          message: {},
          expectedVersion: 0,
        })
      ).statusCode,
    ).toBe(403);
    const prefs = await call("operator", "PUT", "/online-store/preferences", {
      homeTitle: { en: "Nour" },
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "en",
      expectedVersion: 0,
    });
    expect(prefs.statusCode).toBe(200);
  });

  it("admins publish the previewed revision; a stale one is 409 DRAFT_CHANGED", async () => {
    const stale = await call("admin", "POST", "/online-store/theme/publish", {
      expectedDraftRevision: 0,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "DRAFT_CHANGED" });
    const published = await call("admin", "POST", "/online-store/theme/publish", {
      expectedDraftRevision: 1,
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toEqual({ releaseNumber: 1, publishedAt: "2026-10-27T10:00:00.000Z" });
    const releases = await call("viewer", "GET", "/online-store/theme/releases");
    expect(releases.json()).toEqual({
      releases: [
        { releaseNumber: 1, publishedAt: "2026-10-27T10:00:00.000Z", publishedByName: null },
      ],
    });
  });

  it("admins lock with a password; the response never carries it", async () => {
    const res = await call("admin", "PUT", "/online-store/access", {
      locked: true,
      password: "open sesame",
      message: { ar: "قريبًا" },
      expectedVersion: 0,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/sesame|fake\$/);
    expect(res.json()).toMatchObject({ locked: true, passwordSet: true, version: 1 });
  });

  it("bodies are strict: unknown keys are 422 before any handler runs", async () => {
    const res = await call("admin", "PUT", "/online-store/preferences", {
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar",
      expectedVersion: 0,
      storeName: "x",
    });
    expect(res.statusCode).toBe(422);
  });

  it("a preview token is never replayed from the idempotency cache (binding lesson)", async () => {
    const headers = headersFor("viewer", { "idempotency-key": "same-key" });
    const a = await app.inject({
      method: "POST",
      url: "/api/v1/online-store/preview-tokens",
      headers,
      payload: {},
    });
    const b = await app.inject({
      method: "POST",
      url: "/api/v1/online-store/preview-tokens",
      headers,
      payload: {},
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().token).not.toBe(b.json().token);
    expect(a.json()).toEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: "2026-10-27T11:00:00.000Z",
      url: null,
    });
  });

  it("uploads a logo for operators; refuses a JPEG favicon and viewers; never returns a storage key", async () => {
    const upload = uploader(() => app);
    const ok = await upload("operator", "logo", PNG_64, "image/png");
    expect(ok.statusCode).toBe(201);
    expect(Object.keys(ok.json()).sort()).toEqual(["alt", "height", "id", "url", "width"]);
    expect(keys.at(-1)).toMatch(/^tenants\/t-1\/brand-assets\//);
    expect((await upload("operator", "favicon", JPEG_64, "image/png")).statusCode).toBe(415);
    expect((await upload("operator", "logo", PNG_64, "image/gif")).statusCode).toBe(415);
    expect((await upload("viewer", "logo", PNG_64, "image/png")).statusCode).toBe(403);
    expect((await upload("operator", "product", PNG_64, "image/png")).statusCode).toBe(422);
  });
});

/** Spec 1.9, one row per route. `null` means the route is deliberately not idempotent. */
const ROUTE_TABLE: readonly (readonly [string, string, string, boolean | null])[] = [
  ["GET", "/online-store/preferences", "online_store:read", null],
  ["PUT", "/online-store/preferences", "online_store:update_preferences", true],
  ["GET", "/online-store/access", "online_store:read", null],
  ["PUT", "/online-store/access", "online_store_admin:update_access", true],
  ["GET", "/online-store/theme", "online_store:read", null],
  ["PUT", "/online-store/theme/draft", "online_store:edit_theme", true],
  ["POST", "/online-store/theme/discard-draft", "online_store:edit_theme", true],
  ["POST", "/online-store/theme/publish", "online_store_admin:publish_theme", true],
  ["GET", "/online-store/theme/releases", "online_store:read", null],
  [
    "POST",
    "/online-store/theme/releases/:releaseNumber/restore",
    "online_store_admin:publish_theme",
    true,
  ],
  ["POST", "/online-store/images", "online_store:upload_image", true],
  ["POST", "/online-store/preview-tokens", "online_store:read", null],
  // Part 2 (spec 2.6): menus, the link picker and policies.
  ["GET", "/online-store/menus", "online_store:read", null],
  ["GET", "/online-store/menus/:handle", "online_store:read", null],
  ["POST", "/online-store/menus", "online_store:manage_menus", true],
  ["PUT", "/online-store/menus/:handle", "online_store:manage_menus", true],
  ["DELETE", "/online-store/menus/:handle", "online_store:manage_menus", true],
  ["GET", "/online-store/link-targets", "online_store:read", null],
  ["GET", "/online-store/policies", "online_store:read", null],
  ["GET", "/online-store/policies/:type", "online_store:read", null],
  ["PUT", "/online-store/policies/:type", "online_store:manage_policies", true],
  ["POST", "/online-store/policies/:type/template", "online_store:manage_policies", null],
];

/** A concrete URL for a route-table path. */
const concrete = (path: string) =>
  path.replace(":releaseNumber", "1").replace(":handle", "main-menu").replace(":type", "refund");

describe("the online-store route table", () => {
  const routes = onlineStoreRoutes({} as WiredAdmin);

  it("is the rows of spec 1.9 and 2.6, with each row's permission and idempotency", () => {
    expect(routes.map((r) => [r.method, r.path, r.permission, r.idempotent ?? null])).toEqual(
      ROUTE_TABLE,
    );
  });

  it("does not mark the preview-token route idempotent (a replay would hand a token back)", () => {
    const route = routes.find((r) => r.path === "/online-store/preview-tokens");
    expect(route?.idempotent).toBeUndefined();
  });

  it("caps the image body at 8 MB and takes the purpose from a strict enum", () => {
    const route = routes.find((r) => r.path === "/online-store/images");
    expect(route?.binaryBody?.maxBytes).toBeLessThanOrEqual(8 * MB);
    expect(route?.binaryBody?.contentTypes).not.toContain("image/gif");
    expect(route?.schema.querystring?.safeParse({ purpose: "logo" }).success).toBe(true);
    for (const query of [{ purpose: "product" }, { purpose: "logo", extra: "1" }, {}]) {
      expect(route?.schema.querystring?.safeParse(query).success, JSON.stringify(query)).toBe(
        false,
      );
    }
  });
});

describe("who may call each route", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildOnlineStoreApp({
      serializer: new InMemoryEventSerializer(),
      objectStorage: recordingStorage([]),
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const call = caller(() => app);
  const upload = uploader(() => app);

  const prefsBody = {
    homeTitle: {},
    homeMetaDescription: {},
    shareImageId: null,
    defaultLocale: "ar",
    expectedVersion: 99,
  };
  const everyone: readonly StaffRole[] = ["viewer", "operator", "admin"];
  const editors: readonly StaffRole[] = ["operator", "admin"];
  const adminOnly: readonly StaffRole[] = ["admin"];
  // The writes carry a stale version on purpose: an allowed role gets past the guard, reaches the
  // use case and stops at 409, so no row changes the state the next row reads.
  const matrix: readonly (readonly [
    string,
    readonly StaffRole[],
    number,
    (role: StaffRole) => Promise<LightMyRequestResponse>,
  ])[] = [
    ["read preferences", everyone, 200, (r) => call(r, "GET", "/online-store/preferences")],
    ["read access", everyone, 200, (r) => call(r, "GET", "/online-store/access")],
    ["read theme", everyone, 200, (r) => call(r, "GET", "/online-store/theme")],
    ["read releases", everyone, 200, (r) => call(r, "GET", "/online-store/theme/releases")],
    ["mint preview", everyone, 201, (r) => call(r, "POST", "/online-store/preview-tokens", {})],
    [
      "save preferences",
      editors,
      409,
      (r) => call(r, "PUT", "/online-store/preferences", prefsBody),
    ],
    [
      "save draft",
      editors,
      409,
      (r) =>
        call(r, "PUT", "/online-store/theme/draft", {
          document: DEFAULT_THEME_DOCUMENT,
          expectedVersion: 99,
        }),
    ],
    [
      "discard draft",
      editors,
      409,
      (r) => call(r, "POST", "/online-store/theme/discard-draft", { expectedVersion: 99 }),
    ],
    ["upload image", editors, 201, (r) => upload(r, "logo", PNG_64, "image/png")],
    [
      "publish",
      adminOnly,
      409,
      (r) => call(r, "POST", "/online-store/theme/publish", { expectedDraftRevision: 99 }),
    ],
    [
      "restore",
      adminOnly,
      409,
      (r) => call(r, "POST", "/online-store/theme/releases/1/restore", { expectedVersion: 99 }),
    ],
    ["read menus", everyone, 200, (r) => call(r, "GET", "/online-store/menus")],
    ["read a menu", everyone, 200, (r) => call(r, "GET", "/online-store/menus/footer")],
    [
      "search link targets",
      everyone,
      200,
      (r) => call(r, "GET", "/online-store/link-targets?type=policy"),
    ],
    ["read policies", everyone, 200, (r) => call(r, "GET", "/online-store/policies")],
    ["read a policy", everyone, 200, (r) => call(r, "GET", "/online-store/policies/privacy")],
    [
      "create a menu",
      editors,
      422,
      (r) => call(r, "POST", "/online-store/menus", { handle: "new", title: "N", items: [] }),
    ],
    [
      "save a menu",
      editors,
      409,
      (r) =>
        call(r, "PUT", "/online-store/menus/main-menu", {
          title: "M",
          items: [],
          expectedVersion: 99,
        }),
    ],
    ["delete a menu", editors, 404, (r) => call(r, "DELETE", "/online-store/menus/gone")],
    [
      "save a policy",
      editors,
      409,
      (r) => call(r, "PUT", "/online-store/policies/privacy", { body: {}, expectedVersion: 99 }),
    ],
    [
      "generate a policy template",
      editors,
      200,
      (r) =>
        call(r, "POST", "/online-store/policies/refund/template", { locale: "en", inputs: {} }),
    ],
    [
      "lock",
      adminOnly,
      409,
      (r) =>
        call(r, "PUT", "/online-store/access", {
          locked: false,
          message: {},
          expectedVersion: 99,
        }),
    ],
  ];

  it.each(matrix)("%s", async (_name, allowed, status, send) => {
    for (const role of everyone) {
      const res = await send(role);
      expect(res.statusCode, role).toBe(allowed.includes(role) ? status : 403);
    }
  });

  it("refuses a request with no credentials on every route", async () => {
    for (const [method, path] of ROUTE_TABLE) {
      const res = await app.inject({
        method: method as "GET",
        url: `/api/v1${concrete(path)}`,
        headers: { "x-tenant-id": "t-1" },
      });
      expect(res.statusCode, path).toBe(401);
    }
  });
});

describe("online-store error codes (Ruling 9)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildOnlineStoreApp({ serializer: new InMemoryEventSerializer() });
  });
  afterAll(async () => {
    await app.close();
  });

  const call = caller(() => app);

  it("NOTHING_TO_PUBLISH: a shop with no unpublished changes", async () => {
    const res = await call("admin", "POST", "/online-store/theme/publish", {
      expectedDraftRevision: 0,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "NOTHING_TO_PUBLISH" });
  });

  it("VERSION_CONFLICT: on the draft, discard, restore, preferences and access", async () => {
    const stale: readonly (readonly ["PUT" | "POST", string, unknown])[] = [
      [
        "PUT",
        "/online-store/theme/draft",
        { document: DEFAULT_THEME_DOCUMENT, expectedVersion: 7 },
      ],
      ["POST", "/online-store/theme/discard-draft", { expectedVersion: 7 }],
      ["POST", "/online-store/theme/releases/1/restore", { expectedVersion: 7 }],
      [
        "PUT",
        "/online-store/preferences",
        {
          homeTitle: {},
          homeMetaDescription: {},
          shareImageId: null,
          defaultLocale: "ar",
          expectedVersion: 7,
        },
      ],
      ["PUT", "/online-store/access", { locked: false, message: {}, expectedVersion: 7 }],
    ];
    for (const [method, url, body] of stale) {
      const res = await call("admin", method, url, body);
      expect(res.statusCode, url).toBe(409);
      expect(res.json(), url).toMatchObject({ code: "VERSION_CONFLICT" });
    }
  });

  it("the release, password, document and image refusals keep their codes", async () => {
    const missing = await call("admin", "POST", "/online-store/theme/releases/9/restore", {
      expectedVersion: 0,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "RELEASE_NOT_FOUND" });

    const password = await call("admin", "PUT", "/online-store/access", {
      locked: true,
      message: {},
      expectedVersion: 0,
    });
    expect(password.statusCode).toBe(422);
    expect(password.json()).toMatchObject({ code: "PASSWORD_REQUIRED" });

    const short = await call("admin", "PUT", "/online-store/access", {
      locked: true,
      password: "123",
      message: {},
      expectedVersion: 0,
    });
    expect(short.statusCode).toBe(422);
    expect(short.json()).toMatchObject({ code: "PASSWORD_LENGTH" });

    const document = await call("admin", "PUT", "/online-store/theme/draft", {
      document: { ...DEFAULT_THEME_DOCUMENT, header: { sticky: "yes" } },
      expectedVersion: 0,
    });
    expect(document.statusCode).toBe(422);
    expect(document.json()).toMatchObject({
      code: "INVALID_CONTENT",
      fields: [{ field: "header.sticky" }],
    });

    const tooLarge = await call("admin", "PUT", "/online-store/theme/draft", {
      document: { pad: "x".repeat(300_000) },
      expectedVersion: 0,
    });
    expect(tooLarge.statusCode).toBe(422);
    expect(tooLarge.json()).toMatchObject({ code: "DOCUMENT_TOO_LARGE" });

    const image = await call("admin", "PUT", "/online-store/preferences", {
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: "not-an-image",
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    expect(image.statusCode).toBe(422);
    expect(image.json()).toMatchObject({ code: "IMAGE_NOT_FOUND" });

    const withLogo = structuredClone(DEFAULT_THEME_DOCUMENT) as {
      brand: { logo: { imageRef: string | null } };
    };
    withLogo.brand.logo.imageRef = "0192f0aa-0000-7000-8000-000000009999";
    const logo = await call("admin", "PUT", "/online-store/theme/draft", {
      document: withLogo,
      expectedVersion: 0,
    });
    expect(logo.statusCode).toBe(422);
    expect(logo.json()).toMatchObject({
      code: "IMAGE_NOT_FOUND",
      fields: [{ field: "brand.logo.imageRef" }],
    });
  });

  it("a release number the database column cannot hold is 422, never a 500", async () => {
    const restore = (releaseNumber: string) =>
      call("admin", "POST", `/online-store/theme/releases/${releaseNumber}/restore`, {
        expectedVersion: 0,
      });
    const largest = await restore("2147483647");
    expect(largest.statusCode).toBe(404);
    expect(largest.json()).toMatchObject({ code: "RELEASE_NOT_FOUND" });
    for (const tooLarge of ["2147483648", "3000000000"]) {
      const res = await restore(tooLarge);
      expect(res.statusCode, tooLarge).toBe(422);
      expect(res.json(), tooLarge).toMatchObject({ code: "VALIDATION" });
    }
  });
});

describe("what an online-store response may carry", () => {
  let app: FastifyInstance;
  const responseStore = new Map<string, unknown>();
  beforeAll(async () => {
    app = await buildOnlineStoreApp({
      serializer: new InMemoryEventSerializer(),
      objectStorage: recordingStorage([]),
      responseStore,
    });
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const call = caller(() => app);

  it("no response body has a hash key, nor the password or its hash as a value", async () => {
    const responses = [
      await call("admin", "PUT", "/online-store/access", {
        locked: true,
        password: "open sesame",
        message: {},
        expectedVersion: 0,
      }),
      await call("viewer", "GET", "/online-store/access"),
      await call("viewer", "GET", "/online-store/preferences"),
      await call("viewer", "GET", "/online-store/theme"),
      await call("viewer", "GET", "/online-store/theme/releases"),
      await call("viewer", "POST", "/online-store/preview-tokens", {}),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBeLessThan(300);
      expect(keysOf(res.json()).filter((k) => /hash/i.test(k))).toEqual([]);
      expect(res.body).not.toMatch(/sesame|fake\$/);
    }
    expect(responses[1]?.json()).toMatchObject({ locked: true, passwordSet: true });
  });

  it("the plaintext token reaches neither the response cache nor a log line", async () => {
    const logged: unknown[] = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, level).mockImplementation((...args) => void logged.push(args));
    }
    // A write that IS idempotent lands in the store, so an empty result below means something.
    await call("operator", "PUT", "/online-store/preferences", {
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    const cachedBefore = responseStore.size;
    expect(cachedBefore).toBeGreaterThan(0);

    const res = await call("viewer", "POST", "/online-store/preview-tokens", {});
    const token = res.json<{ token: string }>().token;
    expect(token.length).toBeGreaterThan(0);
    const pattern = "/api/v1/online-store/preview-tokens";
    await vi.waitFor(() => expect(JSON.stringify(logged)).toContain(pattern));

    expect(responseStore.size).toBe(cachedBefore);
    expect(JSON.stringify([...responseStore.entries()])).not.toContain(token);
    expect(JSON.stringify(logged)).not.toContain(token);
  });
});

describe("online-store images", () => {
  let app: FastifyInstance;
  const keys: string[] = [];
  beforeAll(async () => {
    app = await buildOnlineStoreApp({
      serializer: new InMemoryEventSerializer(),
      objectStorage: recordingStorage(keys),
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const call = caller(() => app);
  const upload = uploader(() => app);

  function padded(size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    bytes.set(PNG_64);
    return bytes;
  }

  it("refuses a body over 8 MB at the door, and a smaller one over the purpose's cap", async () => {
    const before = keys.length;
    const overRoute = await upload("operator", "section_image", padded(8 * MB + 1), "image/png");
    expect(overRoute.statusCode).toBe(413);
    const overLogo = await upload("operator", "logo", padded(2 * MB + 1), "image/png");
    expect(overLogo.statusCode).toBe(413);
    expect(overLogo.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(keys.length).toBe(before);
  });

  it("an image too small for its purpose is 422 BAD_DIMENSIONS, and nothing is stored", async () => {
    const before = keys.length;
    const res = await upload("operator", "share_image", PNG_64, "image/png");
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "BAD_DIMENSIONS" });
    expect(keys.length).toBe(before);
  });

  it("a purpose outside the enum is 422 before the handler, and nothing is stored", async () => {
    const before = keys.length;
    for (const purpose of ["product", "svg", ""]) {
      const res = await upload("operator", purpose, PNG_64, "image/png");
      expect(res.statusCode, purpose).toBe(422);
    }
    expect(keys.length).toBe(before);
  });

  it("the use case's 422 INVALID_PURPOSE passes through the guarded controller", async () => {
    const admin = wireAdmin({
      serializer: new InMemoryEventSerializer(),
      idGenerator: { generate: () => "id" },
      clock: { now: () => new Date("2026-10-27T10:00:00.000Z") },
    });
    const res = await admin.mediaLibrary.uploadImage(
      { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: "t-1" },
      { bytes: PNG_64, purpose: "product" as never, tenantId: "t-1" },
    );
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "INVALID_PURPOSE" });
  });

  it("keeps working with a decoded file name and with a malformed one", async () => {
    const named = await upload("operator", "logo", PNG_64, "image/png", {
      "x-file-name": encodeURIComponent("لوجو.png"),
    });
    expect(named.statusCode).toBe(201);
    const malformed = await upload("operator", "logo", PNG_64, "image/png", {
      "x-file-name": "%E0%A4%A",
    });
    expect(malformed.statusCode).toBe(201);
  });

  it("an uploaded image resolves through preferences and the theme, per tenant", async () => {
    const logo = (await upload("operator", "logo", PNG_64, "image/png")).json<{
      id: string;
      url: string;
    }>();

    const saved = await call("operator", "PUT", "/online-store/preferences", {
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: logo.id,
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      shareImageId: logo.id,
      shareImage: { url: logo.url, width: 64, height: 64 },
    });

    const elsewhere = await call(
      "operator",
      "PUT",
      "/online-store/preferences",
      {
        homeTitle: {},
        homeMetaDescription: {},
        shareImageId: logo.id,
        defaultLocale: "ar",
        expectedVersion: 0,
      },
      "t-2",
    );
    expect(elsewhere.statusCode).toBe(422);
    expect(elsewhere.json()).toMatchObject({ code: "IMAGE_NOT_FOUND" });
    const theirs = await call("viewer", "GET", "/online-store/preferences", undefined, "t-2");
    expect(theirs.json()).toMatchObject({ shareImageId: null, version: 0 });

    const document = structuredClone(DEFAULT_THEME_DOCUMENT) as {
      brand: { logo: { imageRef: string | null } };
    };
    document.brand.logo.imageRef = logo.id;
    const draft = await call("operator", "PUT", "/online-store/theme/draft", {
      document,
      expectedVersion: 0,
    });
    expect(draft.statusCode).toBe(200);
    const theme = await call("viewer", "GET", "/online-store/theme");
    expect(theme.json()).toMatchObject({ images: { [logo.id]: { url: logo.url } } });
    expect(keysOf(theme.json().images[logo.id]).sort()).toEqual(["alt", "height", "url", "width"]);
  });
});

describe("with no object storage configured", () => {
  it("an image upload is an honest 503", async () => {
    const app = await buildOnlineStoreApp({ serializer: new InMemoryEventSerializer() });
    const res = await uploader(() => app)("operator", "logo", PNG_64, "image/png");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "UNAVAILABLE" });
    await app.close();
  });
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("menus routes (spec 2.6)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildOnlineStoreApp({ serializer: new InMemoryEventSerializer() });
  });
  afterAll(async () => {
    await app.close();
  });

  const call = caller(() => app);

  it("viewers read; operators write; viewers are refused every write", async () => {
    expect((await call("viewer", "GET", "/online-store/menus")).statusCode).toBe(200);
    expect((await call("viewer", "GET", "/online-store/menus/main-menu")).statusCode).toBe(200);
    expect(
      (await call("viewer", "POST", "/online-store/menus", { handle: "v", title: "V", items: [] }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call("operator", "POST", "/online-store/menus", {
          handle: "sale",
          title: "Sale",
          items: [],
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call("operator", "PUT", "/online-store/menus/sale", {
          title: "S",
          items: [],
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/v1/online-store/menus/sale",
          headers: headersFor("viewer", idem()),
        })
      ).statusCode,
    ).toBe(403);
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/v1/online-store/menus/sale",
      headers: headersFor("operator", idem()),
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ handle: "sale" });
    expect((await call("viewer", "GET", "/online-store/menus/sale")).statusCode).toBe(404);
  });

  it("the menu DTO carries no tenant and no internals", async () => {
    const res = await call("admin", "PUT", "/online-store/menus/main-menu", {
      title: "Main",
      expectedVersion: 0,
      items: [{ id: ID(1), label: { en: "Home" }, link: { type: "home" }, children: [] }],
    });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual([
      "handle",
      "id",
      "isDefault",
      "items",
      "title",
      "version",
    ]);
    expect(JSON.stringify(res.json())).not.toContain("t-1");
    const read = await call("viewer", "GET", "/online-store/menus/main-menu");
    expect(Object.keys(read.json()).sort()).toEqual(Object.keys(res.json()).sort());
    expect(read.json()).toMatchObject({ handle: "main-menu", isDefault: true, version: 1 });
  });

  it("refuses unknown keys and a bad link-target type", async () => {
    expect(
      (
        await call("admin", "POST", "/online-store/menus", {
          handle: "a",
          title: "A",
          items: [],
          x: 1,
        })
      ).statusCode,
    ).toBe(422);
    expect((await call("viewer", "GET", "/online-store/link-targets?type=menu")).statusCode).toBe(
      422,
    );
    expect(
      (await call("viewer", "GET", `/online-store/link-targets?type=policy&q=${"a".repeat(101)}`))
        .statusCode,
    ).toBe(422);
    expect(
      (await call("viewer", "GET", "/online-store/link-targets?type=policy&x=1")).statusCode,
    ).toBe(422);
  });

  it("the link-target type and query reach the use case unchanged", async () => {
    const policies = await call("viewer", "GET", "/online-store/link-targets?type=policy&q=refund");
    expect(policies.statusCode).toBe(200);
    expect(policies.json()).toEqual({
      targets: [{ id: "refund", title: expect.any(String), subtitle: "/policies/refund-policy" }],
    });
    const all = await call("viewer", "GET", "/online-store/link-targets?type=policy");
    expect(all.json().targets).toHaveLength(5);
    const pages = await call("viewer", "GET", "/online-store/link-targets?type=page");
    expect(pages.statusCode).toBe(200);
    expect(pages.json()).toEqual({ targets: [] });
  });

  it("expectedVersion is a non-negative integer, refused at the schema otherwise", async () => {
    for (const expectedVersion of [-1, 1.5, "1", null]) {
      const res = await call("admin", "PUT", "/online-store/menus/main-menu", {
        title: "M",
        items: [],
        expectedVersion,
      });
      expect(res.statusCode, String(expectedVersion)).toBe(422);
      expect(res.json(), String(expectedVersion)).toMatchObject({ code: "VALIDATION" });
    }
    const missing = await call("admin", "PUT", "/online-store/menus/main-menu", {
      title: "M",
      items: [],
    });
    expect(missing.statusCode).toBe(422);
  });

  it("the handle comes from the path and the use case judges it", async () => {
    const bad = await call("admin", "PUT", "/online-store/menus/Bad_Handle", {
      title: "M",
      items: [],
      expectedVersion: 0,
    });
    expect(bad.statusCode).toBe(404);
    expect(bad.json()).toMatchObject({ code: "MENU_NOT_FOUND" });
    const reserved = await call("admin", "POST", "/online-store/menus", {
      handle: "new",
      title: "N",
      items: [],
    });
    expect(reserved.statusCode).toBe(422);
    expect(reserved.json()).toMatchObject({ code: "INVALID_HANDLE" });
    const protectedMenu = await call("admin", "DELETE", "/online-store/menus/footer");
    expect(protectedMenu.statusCode).toBe(409);
    expect(protectedMenu.json()).toMatchObject({ code: "MENU_PROTECTED" });
  });

  it("an oversized menu reaches the use case: 422 MENU_TOO_LARGE, never a 413", async () => {
    const label = "x".repeat(MENU_MAX_BYTES + 1024);
    const res = await call("admin", "POST", "/online-store/menus", {
      handle: "big",
      title: "Big",
      items: [{ id: ID(2), label: { en: label }, link: { type: "home" }, children: [] }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().fields).toEqual([{ field: "items", message: "MENU_TOO_LARGE" }]);
  });

  it("a stale save is 409 VERSION_CONFLICT", async () => {
    const res = await call("admin", "PUT", "/online-store/menus/footer", {
      title: "F",
      items: [],
      expectedVersion: 3,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("DELETE takes no body", () => {
    const route = onlineStoreRoutes({} as WiredAdmin).find(
      (r) => r.method === "DELETE" && r.path === "/online-store/menus/:handle",
    );
    expect(route).toBeDefined();
    expect(route?.schema.body).toBeUndefined();
  });
});

describe("policies routes (spec 2.6)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildOnlineStoreApp({ serializer: new InMemoryEventSerializer() });
  });
  afterAll(async () => {
    await app.close();
  });

  const call = caller(() => app);

  it("operators save; viewers read and are refused writes; a bad type is refused", async () => {
    expect(
      (
        await call("viewer", "PUT", "/online-store/policies/refund", {
          body: { en: "x" },
          expectedVersion: 0,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call("operator", "PUT", "/online-store/policies/refund", {
          body: { en: "x" },
          expectedVersion: 0,
        })
      ).json(),
    ).toMatchObject({ type: "refund", version: 1 });
    expect((await call("viewer", "GET", "/online-store/policies/refund")).statusCode).toBe(200);
    expect((await call("viewer", "GET", "/online-store/policies/cookies")).statusCode).toBe(422);
    const list = await call("viewer", "GET", "/online-store/policies");
    expect(list.statusCode).toBe(200);
    expect(list.json().policies).toHaveLength(5);
  });

  it("the template route is not idempotent and stores nothing", async () => {
    const route = onlineStoreRoutes({} as WiredAdmin).find(
      (r) => r.path === "/online-store/policies/:type/template",
    );
    expect(route).toBeDefined();
    expect(route?.idempotent).not.toBe(true);
    const res = await call("operator", "POST", "/online-store/policies/shipping/template", {
      locale: "ar",
      inputs: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().body).toContain("2");
    expect((await call("viewer", "GET", "/online-store/policies/shipping")).json().version).toBe(0);
  });

  it("the template body is strict and its locale an enum", async () => {
    for (const body of [
      { locale: "fr", inputs: {} },
      { locale: "en", inputs: {}, extra: 1 },
      { inputs: {} },
    ]) {
      const res = await call("operator", "POST", "/online-store/policies/refund/template", body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
    }
  });

  it("an unsafe link is 422 UNSAFE_LINK on the locale's field", async () => {
    const res = await call("operator", "PUT", "/online-store/policies/terms", {
      body: { ar: "[x](javascript:alert(1))" },
      expectedVersion: 0,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().fields).toEqual([{ field: "body.ar", message: "UNSAFE_LINK" }]);
  });

  it("the body is strict, capped per locale, and expectedVersion is a non-negative integer", async () => {
    const bodies: unknown[] = [
      { body: { en: "x", fr: "y" }, expectedVersion: 0 },
      { body: { en: "x".repeat(120_001) }, expectedVersion: 0 },
      { body: { en: "x" }, expectedVersion: -1 },
      { body: { en: "x" }, expectedVersion: 0.5 },
      { body: { en: "x" }, expectedVersion: "0" },
      { body: { en: "x" }, expectedVersion: 0, by: "someone" },
    ];
    for (const body of bodies) {
      const res = await call("admin", "PUT", "/online-store/policies/privacy", body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(422);
    }
    expect((await call("viewer", "GET", "/online-store/policies/privacy")).json().version).toBe(0);
  });

  it("no policy response names the staff member who saved it", async () => {
    const saved = await call("operator", "PUT", "/online-store/policies/contact", {
      body: { en: "Call us" },
      expectedVersion: 0,
    });
    expect(saved.statusCode).toBe(200);
    for (const res of [
      saved,
      await call("viewer", "GET", "/online-store/policies/contact"),
      await call("viewer", "GET", "/online-store/policies"),
    ]) {
      expect(res.body).not.toContain("updatedBy");
      expect(res.body).not.toContain("staff-operator");
    }
    expect(Object.keys(saved.json()).sort()).toEqual(["body", "type", "updatedAt", "version"]);
  });

  it("a stale save is 409 VERSION_CONFLICT", async () => {
    const res = await call("admin", "PUT", "/online-store/policies/refund", {
      body: { en: "y" },
      expectedVersion: 0,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "VERSION_CONFLICT" });
  });
});
