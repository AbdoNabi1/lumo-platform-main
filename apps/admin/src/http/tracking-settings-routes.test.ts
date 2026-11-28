import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import {
  API,
  SHOP_A,
  SHOP_B,
  authed,
  buildTrackingSettingsApp,
  type TrackingSettingsApp,
} from "./testing/tracking-settings-harness";

/**
 * Tracking P2-D1: the tracking settings admin API and the public notice switch through the real multi-mode pipeline
 * (claims tenants, the real role table, the real idempotency path). Only the Redis-shaped ports and the settings
 * store are doubles.
 */

interface Settings {
  consentPolicy: string;
  cookieNoticeEnabled: boolean;
  version: number;
  updatedAt: string | null;
}

describe("tracking settings routes", () => {
  let harness: TrackingSettingsApp;
  let app: FastifyInstance;

  beforeEach(async () => {
    expect.hasAssertions();
    harness = await buildTrackingSettingsApp();
    app = harness.app;
  });
  afterEach(async () => {
    await app.close();
  });

  const read = (token: string): Promise<LightMyRequestResponse> =>
    app.inject({ method: "GET", url: `${API}/tracking/settings`, headers: authed(token) });
  const save = (
    token: string,
    payload: unknown,
    extra: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> =>
    app.inject({
      method: "PUT",
      url: `${API}/tracking/settings`,
      headers: authed(token, extra),
      payload: payload as object,
    });
  const publicRead = (headers: Record<string, string>): Promise<LightMyRequestResponse> =>
    app.inject({ method: "GET", url: `${API}/public/tracking/settings`, headers });

  const body = (over: Record<string, unknown> = {}) => ({
    consentPolicy: "opt_in",
    cookieNoticeEnabled: false,
    expectedVersion: 0,
    ...over,
  });

  it("a store that never saved gets the defaults at version 0", async () => {
    const res = await read("a-admin");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      consentPolicy: "notice_only",
      cookieNoticeEnabled: true,
      version: 0,
      updatedAt: null,
    });
  });

  it("saves the whole document (first save is expectedVersion 0 -> version 1) and reads it back", async () => {
    const res = await save("a-admin", body());
    expect(res.statusCode).toBe(200);
    expect(res.json<Settings>()).toEqual({
      consentPolicy: "opt_in",
      cookieNoticeEnabled: false,
      version: 1,
      updatedAt: "2026-11-28T10:00:00.000Z",
    });
    expect((await read("a-admin")).json<Settings>()).toMatchObject({
      consentPolicy: "opt_in",
      version: 1,
    });
    // the consent policy the ingest runtime reads is the saved one
    expect(await harness.service.consentPolicyFor(SHOP_A)).toBe("opt_in");
  });

  it("a stale expectedVersion is 409 CONFLICT carrying the current settings, and writes nothing", async () => {
    await save("a-admin", body());
    const stale = await save("a-admin", body({ consentPolicy: "notice_only", expectedVersion: 0 }));
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "CONFLICT",
      retryable: false,
      current: { consentPolicy: "opt_in", version: 1 },
    });
    expect((await read("a-admin")).json<Settings>().consentPolicy).toBe("opt_in");
    const next = await save("a-admin", body({ consentPolicy: "notice_only", expectedVersion: 1 }));
    expect(next.statusCode).toBe(200);
    expect(next.json<Settings>().version).toBe(2);
  });

  it("is 422 VALIDATION for a bad body: unknown policy, wrong types, missing fields, a tenant or an unknown key", async () => {
    const bad: unknown[] = [
      body({ consentPolicy: "banner_with_reject" }),
      body({ consentPolicy: 1 }),
      body({ cookieNoticeEnabled: "yes" }),
      body({ expectedVersion: -1 }),
      body({ expectedVersion: 1.5 }),
      body({ expectedVersion: "0" }),
      { consentPolicy: "opt_in", cookieNoticeEnabled: true },
      { cookieNoticeEnabled: true, expectedVersion: 0 },
      body({ tenantId: SHOP_B }),
      body({ extra: true }),
      {},
    ];
    for (const payload of bad) {
      const res = await save("a-admin", payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
      expect(res.json()).toMatchObject({ code: "VALIDATION" });
    }
    expect((await read("a-admin")).json<Settings>().version).toBe(0);
    expect((await read("b-admin")).json<Settings>().version).toBe(0);
  });

  it("replays an Idempotency-Key: the second PUT is the first answer, one save", async () => {
    const key = { "idempotency-key": "tracking-settings-key-0001" };
    const first = await save("a-admin", body(), key);
    const second = await save("a-admin", body(), key);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect((await read("a-admin")).json<Settings>().version).toBe(1);
  });

  it("is per store: another store neither sees nor overwrites this store's settings", async () => {
    await save("a-admin", body());
    expect((await read("b-admin")).json<Settings>()).toMatchObject({
      consentPolicy: "notice_only",
      version: 0,
    });
    // B's first save is its own version 1, whatever A holds
    const b = await save(
      "b-admin",
      body({ consentPolicy: "notice_only", cookieNoticeEnabled: true }),
    );
    expect(b.statusCode).toBe(200);
    expect(b.json<Settings>().version).toBe(1);
    expect((await read("a-admin")).json<Settings>().consentPolicy).toBe("opt_in");
    expect(await harness.service.consentPolicyFor(SHOP_B)).toBe("notice_only");
    expect(await harness.service.consentPolicyFor(SHOP_A)).toBe("opt_in");
  });

  it("only an admin may read or write: viewer and operator get 403 on both admin routes", async () => {
    for (const token of ["a-viewer", "a-operator"]) {
      expect((await read(token)).statusCode).toBe(403);
      expect((await save(token, body())).statusCode).toBe(403);
    }
    expect((await read("a-admin")).json<Settings>().version).toBe(0);
  });

  it("no token is 401", async () => {
    const res = await app.inject({ method: "GET", url: `${API}/tracking/settings` });
    expect(res.statusCode).toBe(401);
    const put = await app.inject({
      method: "PUT",
      url: `${API}/tracking/settings`,
      headers: { "content-type": "application/json" },
      payload: body(),
    });
    expect(put.statusCode).toBe(401);
  });

  it("the public read answers ONLY the notice switch, uncached, per request tenant", async () => {
    const defaults = await publicRead({ "x-tenant-id": SHOP_A });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.headers["cache-control"]).toBe("private, no-store");
    expect(defaults.json()).toEqual({ cookieNoticeEnabled: true });

    await save("a-admin", body({ cookieNoticeEnabled: false }));
    const off = await publicRead({ "x-tenant-id": SHOP_A });
    expect(off.json()).toEqual({ cookieNoticeEnabled: false });
    for (const hidden of ["consentPolicy", "opt_in", "version", "tenant", "updatedAt"]) {
      expect(off.body).not.toContain(hidden);
    }
    // another shop is unaffected
    expect((await publicRead({ "x-tenant-id": SHOP_B })).json()).toEqual({
      cookieNoticeEnabled: true,
    });
  });

  it("the public read refuses a request that names no shop, never defaulting one", async () => {
    expect((await publicRead({})).statusCode).toBe(403);
  });

  it("the public read fails open to 'show the notice' when the settings cannot be read", async () => {
    harness.store.failWith = new Error("db is down");
    const res = await publicRead({ "x-tenant-id": SHOP_A });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cookieNoticeEnabled: true });
  });
});
