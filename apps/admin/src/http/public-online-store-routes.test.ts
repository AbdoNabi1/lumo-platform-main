import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { logger } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import { publicOnlineStoreRoutes } from "./public-online-store-routes";
import {
  buildOnlineStoreApp,
  countingLimiter,
  fastHasher,
  headersFor,
} from "./testing/online-store-harness";

const anon = (tenant = "t-1", extra: Record<string, string | string[]> = {}) => ({
  "x-tenant-id": tenant,
  "content-type": "application/json",
  ...extra,
});
const UNLOCK_KEY = "rl:t-1:storefront-unlock";
const START = new Date("2026-10-27T10:00:00.000Z");
let key = 0;

/** Spec 1.10, one row per route. Every one is public; none may replay from the response cache. */
describe("the public online-store route table", () => {
  it("is the three rows of spec 1.10: public, and never idempotent", () => {
    const routes = publicOnlineStoreRoutes({} as WiredAdmin);
    expect(routes.map((r) => [r.method, r.path, r.public, r.idempotent ?? null])).toEqual([
      ["GET", "/public/online-store", true, null],
      ["GET", "/public/online-store/access", true, null],
      ["POST", "/public/online-store/unlock", true, null],
    ]);
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
      expect(body.header).toEqual({ sticky: false });
      expect(Object.keys(body.footer).sort()).toEqual(["note", "showSocial"]);
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

    it("refuses without hashing when the limiter itself is down", async () => {
      await setLock(true, "1234", 0);
      const verify = vi.spyOn(fastHasher, "verify");
      vi.spyOn(logger, "error").mockImplementation(() => undefined); // the expected 500
      const { consume } = limiter;
      vi.spyOn(limiter, "consume").mockImplementation((k, limit, windowMs) =>
        k === UNLOCK_KEY ? Promise.reject(new Error("redis is down")) : consume(k, limit, windowMs),
      );
      const res = await unlock("1234");
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(res.body).not.toContain("accessVersion");
      expect(verify).not.toHaveBeenCalled();
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
