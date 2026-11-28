import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import {
  API,
  FAKE_SECRET,
  FAKE_SECRET_B,
  GA4_ID,
  META_ID,
  SHOP_A,
  SNAP_ID,
  TIKTOK_CODE,
  authed,
  buildAdPlatformsApp,
  type AdPlatformsApp,
} from "./testing/ad-platforms-harness";

/**
 * Lead Site D1 Task 5: the admin API for ad platform connections through the real multi-mode pipeline
 * (claims tenants, the real role table, the real idempotency path). Only the vault and the Redis-shaped
 * ports are doubles. Layer under test: application (transport + composition); no RLS, no Postgres.
 */

interface View {
  platform: string;
  enabled: boolean;
  publicConfig: Record<string, unknown> | null;
  secret: { configured: boolean; last4: string | null };
  testEventCode: string | null;
  complete: boolean;
  live: boolean;
  version: number;
}

const metaBody = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  publicConfig: { pixelId: META_ID },
  secret: FAKE_SECRET,
  expectedVersion: 0,
  ...overrides,
});

describe("ad platform connections admin routes", () => {
  let harness: AdPlatformsApp;
  let app: FastifyInstance;

  beforeEach(async () => {
    expect.hasAssertions();
    harness = await buildAdPlatformsApp();
    app = harness.app;
  });
  afterEach(async () => {
    await app.close();
  });

  const get = (
    token: string,
    extra: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> =>
    app.inject({ method: "GET", url: `${API}/ad-platforms`, headers: authed(token, extra) });
  const put = (
    token: string,
    platform: string,
    payload: unknown,
    extra: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> =>
    app.inject({
      method: "PUT",
      url: `${API}/ad-platforms/${platform}`,
      headers: authed(token, extra),
      payload: payload as object,
    });
  const items = (res: LightMyRequestResponse): View[] => res.json<{ items: View[] }>().items;

  it("an admin lists the five platforms in order, all empty", async () => {
    const res = await get("a-admin");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: ["meta", "tiktok", "snap", "ga4", "google_ads"].map((platform) => ({
        platform,
        enabled: false,
        publicConfig: null,
        secret: { configured: false, last4: null },
        testEventCode: null,
        complete: false,
        live: false,
        version: 0,
      })),
    });
  });

  it("PUT meta with ids and a token answers the view and never the token", async () => {
    const res = await put("a-admin", "meta", metaBody({ testEventCode: "TEST12345" }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      platform: "meta",
      enabled: true,
      publicConfig: { platform: "meta", pixelId: META_ID },
      secret: { configured: true, last4: "1234" },
      testEventCode: "TEST12345",
      complete: true,
      live: true,
      version: 1,
    });
    expect(res.body).not.toContain(FAKE_SECRET);
    expect(res.body).not.toContain("sealed|");
  });

  it("GET afterwards shows configured and last4, and still no token", async () => {
    await put("a-admin", "meta", metaBody());
    const res = await get("a-admin");
    expect(res.statusCode).toBe(200);
    const meta = items(res).find((v) => v.platform === "meta");
    expect(meta).toMatchObject({
      enabled: true,
      secret: { configured: true, last4: "1234" },
      live: true,
      version: 1,
    });
    expect(res.body).not.toContain(FAKE_SECRET);
    expect(res.body).not.toContain("sealed|");
  });

  it("saves every platform's own public ids; google ads takes no token", async () => {
    const tiktok = await put("a-admin", "tiktok", {
      enabled: true,
      publicConfig: { pixelCode: TIKTOK_CODE },
      secret: FAKE_SECRET_B,
      expectedVersion: 0,
    });
    const snap = await put("a-admin", "snap", {
      enabled: false,
      publicConfig: { pixelId: SNAP_ID },
      expectedVersion: 0,
    });
    const ga4 = await put("a-admin", "ga4", {
      enabled: true,
      publicConfig: { measurementId: GA4_ID },
      secret: FAKE_SECRET,
      expectedVersion: 0,
    });
    const ads = await put("a-admin", "google_ads", {
      enabled: true,
      publicConfig: { conversionId: "AW-123456789", labels: { lead: "LeadLabel_1" } },
      expectedVersion: 0,
    });
    expect([tiktok.statusCode, snap.statusCode, ga4.statusCode, ads.statusCode]).toEqual([
      200, 200, 200, 200,
    ]);
    expect(snap.json()).toMatchObject({ complete: false, live: false, enabled: false });
    expect(ads.json()).toMatchObject({
      publicConfig: {
        platform: "google_ads",
        conversionId: "AW-123456789",
        labels: { lead: "LeadLabel_1" },
      },
      complete: true,
      live: true,
    });
    const withSecret = await put("a-admin", "google_ads", {
      enabled: true,
      publicConfig: { conversionId: "AW-123456789", labels: {} },
      secret: FAKE_SECRET,
      expectedVersion: 1,
    });
    expect(withSecret.statusCode).toBe(422);
  });

  it("an empty secret keeps the stored one; clearSecret removes it", async () => {
    await put("a-admin", "meta", metaBody());
    const kept = await put("a-admin", "meta", metaBody({ secret: "", expectedVersion: 1 }));
    expect(kept.json()).toMatchObject({ secret: { configured: true, last4: "1234" }, version: 2 });
    const cleared = await put(
      "a-admin",
      "meta",
      metaBody({ secret: undefined, clearSecret: true, expectedVersion: 2 }),
    );
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({
      secret: { configured: false, last4: null },
      complete: false,
      live: false,
      version: 3,
    });
  });

  it("a body that names a tenant (or anything unknown) is 422 VALIDATION", async () => {
    const withTenant = await put("a-admin", "meta", metaBody({ tenantId: "tenant-b" }));
    expect(withTenant.statusCode).toBe(422);
    expect(withTenant.json()).toMatchObject({ code: "VALIDATION" });
    const withPlatform = await put("a-admin", "meta", metaBody({ platform: "tiktok" }));
    expect(withPlatform.statusCode).toBe(422);
    expect(
      (await get("a-admin")).json<{ items: View[] }>().items.every((v) => v.version === 0),
    ).toBe(true);
  });

  it("a publicConfig that names another platform than the path is 422, never rewritten", async () => {
    const res = await put(
      "a-admin",
      "meta",
      metaBody({ publicConfig: { platform: "tiktok", pixelId: META_ID } }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json<{ fields: { field: string }[] }>().fields.map((f) => f.field)).toEqual([
      "publicConfig.platform",
    ]);
  });

  it("an unknown platform, a missing version and an oversized secret are 422", async () => {
    expect((await put("a-admin", "x", metaBody())).statusCode).toBe(422);
    const { expectedVersion: _drop, ...noVersion } = metaBody();
    expect((await put("a-admin", "meta", noVersion)).statusCode).toBe(422);
    expect((await put("a-admin", "meta", metaBody({ secret: "a".repeat(1025) }))).statusCode).toBe(
      422,
    );
    expect((await put("a-admin", "meta", metaBody({ expectedVersion: -1 }))).statusCode).toBe(422);
  });

  it("bad ids and a bad token answer field issues without echoing the token", async () => {
    const badId = await put("a-admin", "meta", metaBody({ publicConfig: { pixelId: "abc" } }));
    expect(badId.statusCode).toBe(422);
    expect(badId.json<{ fields: { field: string }[] }>().fields.map((f) => f.field)).toEqual([
      "publicConfig.pixelId",
    ]);
    const badSecret = await put("a-admin", "meta", metaBody({ secret: "has a space in it" }));
    expect(badSecret.statusCode).toBe(422);
    expect(badSecret.body).not.toContain("has a space in it");
    expect(badSecret.json<{ fields: { field: string }[] }>().fields.map((f) => f.field)).toEqual([
      "secret",
    ]);
  });

  it("a stale expectedVersion is 409 CONCURRENCY and changes nothing", async () => {
    await put("a-admin", "meta", metaBody());
    const stale = await put("a-admin", "meta", metaBody({ secret: FAKE_SECRET_B }));
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "CONCURRENCY" });
    const meta = items(await get("a-admin")).find((v) => v.platform === "meta");
    expect(meta).toMatchObject({ version: 1, secret: { last4: "1234" } });
  });

  it("only an admin may read or write: viewer and operator get 403 on both", async () => {
    for (const token of ["a-viewer", "a-operator"]) {
      expect((await get(token)).statusCode).toBe(403);
      const denied = await put(token, "meta", metaBody());
      expect(denied.statusCode).toBe(403);
      expect(denied.body).not.toContain(FAKE_SECRET);
    }
    expect((await get("a-admin")).statusCode).toBe(200);
    expect(items(await get("a-admin")).every((v) => v.version === 0)).toBe(true);
    expect(harness.synced).toEqual([]);
  });

  it("no token is 401", async () => {
    const res = await app.inject({ method: "GET", url: `${API}/ad-platforms` });
    expect(res.statusCode).toBe(401);
  });

  it("shop A never sees shop B's connections, and a forged tenant header moves nothing", async () => {
    await put("a-admin", "meta", metaBody());
    const bView = await get("b-admin");
    expect(items(bView).every((v) => v.version === 0 && !v.secret.configured)).toBe(true);
    const forged = await get("b-admin", { "x-tenant-id": SHOP_A });
    expect(items(forged).every((v) => v.version === 0)).toBe(true);
    // B saves its own meta at version 0: A's row does not collide, and A keeps its own.
    const bSave = await put("b-admin", "meta", metaBody({ secret: FAKE_SECRET_B }));
    expect(bSave.statusCode).toBe(200);
    expect(bSave.json()).toMatchObject({ secret: { last4: "5678" }, version: 1 });
    expect(items(await get("a-admin")).find((v) => v.platform === "meta")?.secret.last4).toBe(
      "1234",
    );
  });

  it("calls the delivery sync with the shop id after a successful save only", async () => {
    await get("a-admin");
    expect(harness.synced).toEqual([]);
    await put("a-admin", "meta", metaBody({ publicConfig: { pixelId: "abc" } }));
    expect(harness.synced).toEqual([]);
    await put("a-admin", "meta", metaBody());
    await put("b-admin", "tiktok", {
      enabled: true,
      publicConfig: { pixelCode: TIKTOK_CODE },
      secret: FAKE_SECRET,
      expectedVersion: 0,
    });
    expect(harness.synced).toEqual([SHOP_A, "tenant-b"]);
  });

  it("a failing delivery sync never fails or un-saves the connection", async () => {
    await app.close();
    harness = await buildAdPlatformsApp({
      deliverySync: { sync: () => Promise.reject(new Error("sync is down")) },
    });
    app = harness.app;
    const res = await put("a-admin", "meta", metaBody());
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("sync is down");
    expect(items(await get("a-admin")).find((v) => v.platform === "meta")?.version).toBe(1);
  });

  it("replays an Idempotency-Key: the second PUT is the first answer and syncs once", async () => {
    const key = { "idempotency-key": "ad-platform-key-0001" };
    const first = await put("a-admin", "meta", metaBody(), key);
    const second = await put("a-admin", "meta", metaBody(), key);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(harness.synced).toEqual([SHOP_A]);
    expect(items(await get("a-admin")).find((v) => v.platform === "meta")?.version).toBe(1);
  });

  describe("without a real credential vault (production policy)", () => {
    beforeEach(async () => {
      await app.close();
      harness = await buildAdPlatformsApp({
        vault: "none",
        credentialPolicy: "require_real_vault",
      });
      app = harness.app;
    });

    it("a PUT with a token is 503 UNAVAILABLE, stores nothing and syncs nothing", async () => {
      const res = await put("a-admin", "meta", metaBody());
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: "UNAVAILABLE" });
      expect(res.body).not.toContain(FAKE_SECRET);
      expect(items(await get("a-admin")).every((v) => v.version === 0)).toBe(true);
      expect(harness.synced).toEqual([]);
    });

    it("public ids without a token still save", async () => {
      const res = await put("a-admin", "meta", metaBody({ secret: undefined }));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        secret: { configured: false, last4: null },
        complete: false,
        version: 1,
      });
    });
  });
});
