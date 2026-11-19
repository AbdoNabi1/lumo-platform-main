import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@platform/http";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { DEFAULT_THEME_DOCUMENT, newSection } from "@platform/storefront-content";
import { logger } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import { publicOnlineStoreRoutes } from "./public-online-store-routes";
import {
  buildOnlineStoreApp,
  countingLimiter,
  fastHasher,
  headersFor,
  recordingStorage,
} from "./testing/online-store-harness";

const anon = (tenant = "t-1", extra: Record<string, string | string[]> = {}) => ({
  "x-tenant-id": tenant,
  "content-type": "application/json",
  ...extra,
});
const UNLOCK_KEY = "rl:t-1:storefront-unlock";
const START = new Date("2026-10-27T10:00:00.000Z");
const NOT_STORED = "private, no-store";
let key = 0;

/** A PNG header is all the upload path reads: the signature and the IHDR width and height. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(29);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

/** Every object key anywhere in a JSON value (arrays and nested objects included). */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
}

/** Spec 1.10, one row per route. Every one is public; none may replay from the response cache. */
describe("the public online-store route table", () => {
  it("is spec 1.10's three rows plus Part 3's home: public, and never idempotent", () => {
    const routes = publicOnlineStoreRoutes({} as WiredAdmin);
    expect(routes.map((r) => [r.method, r.path, r.public, r.idempotent ?? null])).toEqual([
      ["GET", "/public/online-store", true, null],
      ["GET", "/public/online-store/home", true, null],
      ["GET", "/public/online-store/access", true, null],
      ["POST", "/public/online-store/unlock", true, null],
    ]);
  });

  it("refuses unlock when it was given no limiter: the check never runs without one", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const unlock = vi.fn();
    const admin = { publicReads: { onlineStore: { unlock } } } as unknown as WiredAdmin;
    const route = publicOnlineStoreRoutes(admin).find((r) => r.method === "POST");
    const res = await route?.handle({
      body: { password: "1234" },
      params: undefined,
      query: undefined,
      context: { tenantId: "t-1", requestId: "r-1" } as RequestContext,
    });
    expect(res).toMatchObject({
      status: 503,
      body: { code: "UNAVAILABLE", retryable: true },
      headers: { "retry-after": "5" },
    });
    expect(unlock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("public online-store routes (spec 1.10)", () => {
  let app: FastifyInstance;
  let limiter: ReturnType<typeof countingLimiter>;
  let responseStore: Map<string, unknown>;
  let now: Date;
  beforeEach(async () => {
    now = START;
    limiter = countingLimiter();
    responseStore = new Map();
    app = await buildOnlineStoreApp({
      serializer: new InMemoryEventSerializer(),
      rateLimiter: limiter,
      responseStore,
      clock: { now: () => now },
      objectStorage: recordingStorage([]),
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  const admin = (method: "PUT" | "POST", url: string, payload: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: headersFor("admin", { "idempotency-key": `p-${(key += 1)}` }),
      payload,
    });
  const home = (tenant = "t-1", extra: Record<string, string | string[]> = {}) =>
    app.inject({
      method: "GET",
      url: "/api/v1/public/online-store/home",
      headers: anon(tenant, extra),
    });
  const shell = (tenant = "t-1", extra: Record<string, string | string[]> = {}) =>
    app.inject({
      method: "GET",
      url: "/api/v1/public/online-store",
      headers: anon(tenant, extra),
    });
  const access = (tenant = "t-1") =>
    app.inject({
      method: "GET",
      url: "/api/v1/public/online-store/access",
      headers: anon(tenant),
    });
  const unlock = (password: unknown, tenant = "t-1", extra: Record<string, string> = {}) =>
    app.inject({
      method: "POST",
      url: "/api/v1/public/online-store/unlock",
      headers: anon(tenant, extra),
      payload: { password },
    });
  const setLock = (locked: boolean, password: string | undefined, expectedVersion: number) =>
    admin("PUT", "/online-store/access", {
      locked,
      ...(password === undefined ? {} : { password }),
      message: {},
      expectedVersion,
    });
  const uploadImage = async (purpose: string, bytes: Buffer) => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/online-store/images?purpose=${purpose}`,
      headers: headersFor("admin", {
        "idempotency-key": `p-${(key += 1)}`,
        "content-type": "image/png",
      }),
      payload: bytes,
    });
    expect(res.statusCode, purpose).toBe(201);
    return res.json<{ id: string }>().id;
  };
  const mintToken = async () =>
    (await admin("POST", "/online-store/preview-tokens", {})).json<{
      token: string;
      expiresAt: string;
    }>();

  describe("the shell", () => {
    it("serves the live shell anonymously with no internals (leak test)", async () => {
      await admin("PUT", "/online-store/access", {
        locked: true,
        password: "open sesame",
        message: { ar: "قريبًا" },
        expectedVersion: 0,
      });
      const res = await shell();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        mode: "live",
        branded: false,
        locked: true,
        defaultLocale: "ar",
      });
      for (const leak of [
        "t-1",
        "tenant",
        "version",
        "Revision",
        "hash",
        "fake$",
        "sesame",
        "storageKey",
        "tenants/",
        "imageRef",
        "accessVersion",
      ]) {
        expect(res.body, leak).not.toContain(leak);
      }
    });

    it("lists exactly the spec's fields, at every level the shell owns", async () => {
      const body = (await shell()).json<{
        preferences: object;
        brand: { logo: object };
        header: object;
        footer: object;
      }>();
      expect(Object.keys(body).sort()).toEqual([
        "brand",
        "branded",
        "defaultLocale",
        "footer",
        "header",
        "locked",
        "mode",
        "preferences",
        "previewExpiresAt",
        "storeName",
      ]);
      expect(Object.keys(body.preferences).sort()).toEqual([
        "homeMetaDescription",
        "homeTitle",
        "shareImage",
      ]);
      expect(Object.keys(body.brand).sort()).toEqual([
        "colors",
        "corners",
        "favicon",
        "logo",
        "social",
        "typography",
      ]);
      expect(Object.keys(body.brand.logo).sort()).toEqual(["image", "widthPx"]);
      // Part 2: an untouched shop serves the default menus, resolved; no policy is set yet.
      // Part 3: the header lists exactly sticky, menu and announcement (no bar yet: null).
      expect(Object.keys(body.header).sort()).toEqual(["announcement", "menu", "sticky"]);
      expect(body.header).toEqual({
        sticky: false,
        announcement: null,
        menu: [
          { label: { ar: "الرئيسية", en: "Home" }, href: "/", external: false, children: [] },
          { label: { ar: "البحث", en: "Search" }, href: "/search", external: false, children: [] },
        ],
      });
      expect(body.footer).toEqual({
        note: {},
        showSocial: true,
        menu: [
          { label: { ar: "البحث", en: "Search" }, href: "/search", external: false, children: [] },
        ],
        policies: [],
      });
    });

    it("a real image carries only url, alt, width and height, and no key outside its url", async () => {
      const [logo, favicon, share] = [
        await uploadImage("logo", png(64, 64)),
        await uploadImage("favicon", png(64, 64)),
        await uploadImage("share_image", png(640, 320)),
      ];
      const document = {
        ...DEFAULT_THEME_DOCUMENT,
        brand: {
          ...DEFAULT_THEME_DOCUMENT.brand,
          logo: { ...DEFAULT_THEME_DOCUMENT.brand.logo, imageRef: logo },
          favicon: { imageRef: favicon },
        },
      };
      await admin("PUT", "/online-store/theme/draft", { document, expectedVersion: 0 });
      await admin("POST", "/online-store/theme/publish", { expectedDraftRevision: 1 });
      await admin("PUT", "/online-store/preferences", {
        homeTitle: {},
        homeMetaDescription: {},
        shareImageId: share,
        defaultLocale: "ar",
        expectedVersion: 0,
      });

      const res = await shell();
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        preferences: { shareImage: { url: string } };
        brand: { logo: { image: { url: string } }; favicon: { url: string } };
      }>();
      for (const image of [
        body.brand.logo.image,
        body.brand.favicon,
        body.preferences.shareImage,
      ]) {
        expect(Object.keys(image).sort()).toEqual(["alt", "height", "url", "width"]);
        expect(image.url.startsWith("https://cdn.example.test/media/tenants/t-1/")).toBe(true);
      }
      // A menu item's `href` is its public link, not an internal reference such as `imageRef`, so
      // the menus are checked on their own (exact item keys) and the scan runs on the rest.
      type Item = { children: Item[] };
      const shellMenus = body as unknown as {
        header: { menu: Item[] };
        footer: { menu: Item[] };
      };
      const items = [...shellMenus.header.menu, ...shellMenus.footer.menu].flatMap((item) => [
        item,
        ...item.children,
      ]);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(["children", "external", "href", "label"]);
      }
      const withoutMenus = JSON.parse(JSON.stringify(body)) as {
        header: { menu?: unknown };
        footer: { menu?: unknown };
      };
      delete withoutMenus.header.menu;
      delete withoutMenus.footer.menu;
      const keys = keysOf(withoutMenus);
      for (const internal of [/storage/i, /key$/i, /tenant/i, /ref$/i, /^id$/i]) {
        expect(
          keys.filter((k) => internal.test(k)),
          String(internal),
        ).toEqual([]);
      }
      // The public url is the CDN path, which holds the key, as for product images. Nothing else may.
      const withoutUrls = JSON.stringify(body, (k, v: unknown) => (k === "url" ? undefined : v));
      for (const leak of [
        "t-1",
        "tenants/",
        "storageKey",
        "signed.example",
        logo,
        favicon,
        share,
      ]) {
        expect(withoutUrls, leak).not.toContain(leak);
      }
    });

    it("answers for a shop with no rows at all, on every read", async () => {
      const res = await shell("t-no-rows");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        mode: "live",
        previewExpiresAt: null,
        branded: false,
        storeName: "",
        locked: false,
      });
      expect((await access("t-no-rows")).json()).toEqual({
        locked: false,
        accessVersion: 1,
        message: {},
      });
    });
  });

  it("no anonymous read may be stored by a shared cache: live, draft, refused or access", async () => {
    const { token } = await mintToken();
    for (const res of [
      await shell(),
      await shell("t-1", { "x-preview-token": token }),
      await shell("t-1", { "x-preview-token": "nope" }),
      await access(),
      await home(),
      await home("t-1", { "x-preview-token": token }),
      await home("t-1", { "x-preview-token": "nope" }),
    ]) {
      expect(res.headers["cache-control"]).toBe(NOT_STORED);
    }
  });

  describe("the home (Part 3, spec 3.4)", () => {
    beforeEach(() => {
      expect.hasAssertions();
    });
    const SECTION = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const richText = (n: number, heading: string, hidden = false) => ({
      id: SECTION(n),
      type: "rich_text",
      hidden,
      settings: {
        heading: { en: heading },
        body: {},
        buttonLabel: {},
        buttonLink: null,
        align: "start",
      },
    });
    const future = {
      id: SECTION(9),
      type: "countdown_timer",
      hidden: false,
      settings: { secret: "UNKNOWN-CONTENT", endsAt: "2027-01-01" },
    };
    const saveDraft = (sections: unknown[]) =>
      admin("PUT", "/online-store/theme/draft", {
        document: { ...DEFAULT_THEME_DOCUMENT, homepage: { sections } },
        expectedVersion: 0,
      });

    it("serves the live home anonymously, listing exactly mode and sections", async () => {
      const res = await home();
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe(NOT_STORED);
      const body = res.json<{ mode: string; sections: { id: string; type: string }[] }>();
      expect(Object.keys(body).sort()).toEqual(["mode", "sections"]);
      expect(body.mode).toBe("live");
      expect(body.sections.map((s) => [s.id, s.type])).toEqual([
        ["00000000-0000-4000-8000-000000000101", "featured_products"],
        ["00000000-0000-4000-8000-000000000102", "collection_list"],
      ]);
      for (const section of body.sections) {
        expect(Object.keys(section).sort()).toEqual(["id", "settings", "type"]);
      }
    });

    it("preview with a valid token serves the draft with hidden flags; live stays published", async () => {
      expect(
        (await saveDraft([richText(1, "Shown"), richText(2, "Tucked", true)])).statusCode,
      ).toBe(200);
      const { token } = await mintToken();
      const preview = await home("t-1", { "x-preview-token": token });
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({
        mode: "preview",
        sections: [
          { id: SECTION(1), hidden: false, settings: { heading: { en: "Shown" } } },
          { id: SECTION(2), hidden: true, settings: { heading: { en: "Tucked" } } },
        ],
      });
      expect(preview.body).not.toContain(token);
      const live = await home();
      expect(live.body).not.toMatch(/Shown|Tucked/);
      expect(live.json<{ mode: string }>().mode).toBe("live");
    });

    it("a bad, foreign or repeated token is 401 PREVIEW_INVALID, never the live home", async () => {
      await saveDraft([richText(1, "Secret draft")]);
      const { token } = await mintToken();
      for (const [tenant, bad] of [
        ["t-1", "nope"],
        ["t-1", ""],
        ["t-1", "u".repeat(43)],
        ["t-2", token],
        ["t-1", [token, token]],
      ] as const) {
        const res = await home(tenant, { "x-preview-token": bad as string | string[] });
        expect(res.statusCode, JSON.stringify(bad)).toBe(401);
        expect(res.json()).toEqual({
          code: "PREVIEW_INVALID",
          message: "Preview link is invalid or expired",
          retryable: false,
          fields: [],
        });
        expect(res.body).not.toMatch(/Secret|sections/);
      }
    });

    it("serves no tenant, image ref, storage key or unknown-type section (leak test)", async () => {
      // A section WITH an image: the checks below are about a real image, not an image-free page.
      const image = await uploadImage("section_image", png(640, 320));
      const hero = newSection("hero", SECTION(2));
      const withImage = { ...hero, settings: { ...hero.settings, image } };
      expect((await saveDraft([richText(1, "Visible"), withImage, future])).statusCode).toBe(200);
      await admin("POST", "/online-store/theme/publish", { expectedDraftRevision: 1 });
      const { token } = await mintToken();
      for (const res of [await home(), await home("t-1", { "x-preview-token": token })]) {
        expect(res.statusCode).toBe(200);
        const sections = res.json<{ sections: { id: string; settings: { image: unknown } }[] }>()
          .sections;
        expect(sections.map((s) => s.id)).toEqual([SECTION(1), SECTION(2)]);
        // The image is exactly url, alt, width and height; its url (the public CDN path, which
        // holds tenants/<id>/ as for the shell and product images) is the only place a key may be.
        const shown = sections[1]!.settings.image as Record<string, string>;
        expect(Object.keys(shown).sort()).toEqual(["alt", "height", "url", "width"]);
        expect(shown["url"]!.startsWith("https://cdn.example.test/media/tenants/t-1/")).toBe(true);
        const outsideUrl = res.body.replace(shown["url"]!, "");
        for (const leak of [
          "t-1",
          "tenant",
          "imageRef",
          "storageKey",
          "tenants/",
          "countdown_timer",
          "UNKNOWN-CONTENT",
          image,
          SECTION(9),
          token,
        ]) {
          expect(outsideUrl, leak).not.toContain(leak);
        }
      }
    });
  });

  describe("preview", () => {
    it("serves the draft with a valid preview token and 401 PREVIEW_INVALID otherwise", async () => {
      await admin("PUT", "/online-store/theme/draft", {
        document: { ...DEFAULT_THEME_DOCUMENT, header: { sticky: true } },
        expectedVersion: 0,
      });
      const { token, expiresAt } = await mintToken();
      const preview = await shell("t-1", { "x-preview-token": token });
      expect(preview.json()).toMatchObject({
        mode: "preview",
        previewExpiresAt: expiresAt,
        branded: true,
        header: { sticky: true },
      });
      expect(preview.body).not.toContain(token);
      const live = await shell();
      expect(live.json<{ header: { sticky: boolean } }>().header.sticky).toBe(false);
      for (const bad of ["nope", "x".repeat(101), token.slice(1)]) {
        const res = await shell("t-1", { "x-preview-token": bad });
        expect(res.statusCode, bad).toBe(401);
        expect(res.json<{ code: string }>().code).toBe("PREVIEW_INVALID");
      }
      expect((await shell("t-2", { "x-preview-token": token })).statusCode).toBe(401);
    });

    it("gives one answer for an unknown, expired, foreign or malformed token", async () => {
      const { token, expiresAt } = await mintToken();
      const unknown = await shell("t-1", { "x-preview-token": "u".repeat(43) });
      expect(unknown.statusCode).toBe(401);
      expect(unknown.json()).toEqual({
        code: "PREVIEW_INVALID",
        message: "Preview link is invalid or expired",
        retryable: false,
        fields: [],
      });

      const foreign = await shell("t-2", { "x-preview-token": token });
      const malformed = await shell("t-1", { "x-preview-token": "nope" });
      now = new Date(Date.parse(expiresAt) + 1);
      const expired = await shell("t-1", { "x-preview-token": token });
      for (const res of [foreign, malformed, expired]) {
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual(unknown.json());
      }
    });

    it("never treats a present but unusable header as no header (live, 200)", async () => {
      const { token } = await mintToken();
      for (const bad of ["", [token, token]]) {
        const res = await shell("t-1", { "x-preview-token": bad });
        expect(res.statusCode, JSON.stringify(bad)).toBe(401);
        expect(res.json<{ code: string }>().code).toBe("PREVIEW_INVALID");
      }
    });

    it("on a locked store, 200 means a valid token: the read the middleware gate relies on", async () => {
      await setLock(true, "1234", 0);
      const { token } = await mintToken();
      const valid = await shell("t-1", { "x-preview-token": token });
      expect(valid.statusCode).toBe(200);
      expect(valid.json()).toMatchObject({ mode: "preview", locked: true });
      const unknown = await shell("t-1", { "x-preview-token": "u".repeat(43) });
      expect(unknown.statusCode).toBe(401);
      expect(unknown.body).not.toContain("locked");
    });
  });

  describe("access", () => {
    it("access carries exactly locked, accessVersion and the visitor message", async () => {
      await admin("PUT", "/online-store/access", {
        locked: true,
        password: "1234",
        message: { en: "Soon" },
        expectedVersion: 0,
      });
      expect((await access()).json()).toEqual({
        locked: true,
        accessVersion: 2,
        message: { en: "Soon" },
      });
    });
  });

  describe("unlock", () => {
    it("uniform 401 for no lock and wrong password; 200 with the access version", async () => {
      const noLock = await unlock("1234");
      expect(noLock.statusCode).toBe(401);
      await setLock(true, "1234", 0);
      const wrong = await unlock("4321");
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json()).toEqual(noLock.json());
      expect((await unlock("1234")).json()).toEqual({ accessVersion: 2 });
      expect(limiter.keys.filter((k) => k === UNLOCK_KEY)).toHaveLength(3);
    });

    it("never reveals whether a password is set, and costs one verify every time", async () => {
      const verify = vi.spyOn(fastHasher, "verify");
      const noRows = await unlock("1234");
      expect(noRows.json()).toEqual({
        code: "PASSWORD_INCORRECT",
        message: "Incorrect password",
        retryable: false,
        fields: [],
      });
      await setLock(true, "1234", 0);
      const wrong = await unlock("4321");
      await setLock(false, undefined, 1);
      const rightButUnlocked = await unlock("1234");
      for (const res of [wrong, rightButUnlocked]) {
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual(noRows.json());
      }
      expect(verify).toHaveBeenCalledTimes(3);
    });

    it("a password change retires the old password; unlock and /access report one version", async () => {
      const version = async () => (await access()).json<{ accessVersion: number }>().accessVersion;
      const unlocked = async (password: string) => {
        const res = await unlock(password);
        expect(res.statusCode, password).toBe(200);
        return res.json<{ accessVersion: number }>().accessVersion;
      };

      await setLock(true, "1234", 0);
      const first = await version();
      expect(await unlocked("1234")).toBe(first);

      await setLock(true, "5678", 1);
      const second = await version();
      expect(second).toBeGreaterThan(first);
      expect((await unlock("1234")).statusCode).toBe(401);
      expect(await unlocked("5678")).toBe(second);

      await setLock(false, undefined, 2);
      expect(await version()).toBe(second);
      expect((await unlock("5678")).statusCode).toBe(401);

      await setLock(true, undefined, 3);
      const third = await version();
      expect(third).toBeGreaterThan(second);
      expect(await unlocked("5678")).toBe(third);
    });

    it("the limit is per shop, 20 per 10 minutes, under the spec's key", async () => {
      const consume = vi.spyOn(limiter, "consume");
      await unlock("1234");
      expect(consume).toHaveBeenCalledWith(UNLOCK_KEY, 20, 10 * 60 * 1000);
    });

    it("the 21st attempt in 10 minutes is 429 with retry-after, even with the right password (Review Focus 9)", async () => {
      await setLock(true, "1234", 0);
      const verify = vi.spyOn(fastHasher, "verify");
      for (let i = 0; i < 20; i += 1) expect((await unlock("wrong")).statusCode).toBe(401);
      const limited = await unlock("1234");
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 120_000 });
      expect(limited.headers["retry-after"]).toBe("120");
      expect(verify).toHaveBeenCalledTimes(20); // refused before hashing
      // another shop has its own bucket
      expect((await unlock("x", "t-2")).statusCode).toBe(401);
    });

    it("answers 503 with retry-after, nothing hashed, when the limiter itself is down", async () => {
      await setLock(true, "1234", 0);
      const verify = vi.spyOn(fastHasher, "verify");
      const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
      const { consume } = limiter;
      vi.spyOn(limiter, "consume").mockImplementation((k, limit, windowMs) =>
        k === UNLOCK_KEY ? Promise.reject(new Error("redis is down")) : consume(k, limit, windowMs),
      );
      const res = await unlock("1234");
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        code: "UNAVAILABLE",
        message: "Service temporarily unavailable",
        retryable: true,
        fields: [],
        retryAfterMs: 5_000,
      });
      expect(res.headers["retry-after"]).toBe("5");
      expect(verify).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        "rate limiter unavailable; failing closed",
        expect.objectContaining({ error: "redis is down" }),
      );
    });

    it("refuses an over-long password before the limiter and before hashing", async () => {
      await setLock(true, "1234", 0);
      const verify = vi.spyOn(fastHasher, "verify");
      const hash = vi.spyOn(fastHasher, "hash");
      // The cap is on the raw value: the right password padded past it is still refused.
      for (const tooLong of ["p".repeat(201), " ".repeat(201), "1234".padEnd(201)]) {
        const res = await unlock(tooLong);
        expect(res.statusCode).toBe(422);
        expect(res.json()).toMatchObject({ code: "VALIDATION" });
        expect(res.body).not.toContain(tooLong);
      }
      expect(verify).not.toHaveBeenCalled();
      expect(hash).not.toHaveBeenCalled();
      expect(limiter.keys).not.toContain(UNLOCK_KEY);

      const atTheCap = await unlock("p".repeat(200));
      expect(atTheCap.statusCode).toBe(401);
      expect(verify).toHaveBeenCalledTimes(1);
    });

    it("refuses unknown body keys and a non-string password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/public/online-store/unlock",
        headers: anon(),
        payload: { password: "1234", remember: true },
      });
      expect(res.statusCode).toBe(422);
      expect((await unlock(1234)).statusCode).toBe(422);
      expect((await unlock(undefined)).statusCode).toBe(422);
    });

    it("is not idempotent: one key never replays a result for another password", async () => {
      await setLock(true, "1234", 0);
      const cachedBefore = responseStore.size;
      expect(cachedBefore).toBeGreaterThan(0);
      const sameKey = { "idempotency-key": "guess-1" };
      expect((await unlock("1234", "t-1", sameKey)).statusCode).toBe(200);
      expect((await unlock("4321", "t-1", sameKey)).statusCode).toBe(401);
      expect(responseStore.size).toBe(cachedBefore);
    });
  });

  it("a password and a preview token reach neither the response cache nor a log line", async () => {
    const logged: unknown[] = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, level).mockImplementation((...args) => void logged.push(args));
    }
    await setLock(true, "open sesame", 0);
    const { token } = await mintToken();
    await shell("t-1", { "x-preview-token": token });
    await unlock("open sesame");
    await vi.waitFor(() =>
      expect(JSON.stringify(logged)).toContain("/api/v1/public/online-store/unlock"),
    );
    for (const secret of [token, "open sesame", "fake$"]) {
      expect(JSON.stringify(logged), secret).not.toContain(secret);
      expect(JSON.stringify([...responseStore.entries()]), secret).not.toContain(secret);
    }
  });
});
