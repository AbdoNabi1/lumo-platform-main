import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import {
  API,
  FAKE_SECRET,
  FAKE_SECRET_B,
  GA4_ID,
  META_ID,
  SHOP_A,
  SHOP_B,
  SNAP_ID,
  TIKTOK_CODE,
  authed,
  buildAdPlatformsApp,
} from "./testing/ad-platforms-harness";

/**
 * Lead Site D1 Task 5: `GET /public/ad-platforms` (consumed by the storefront in D2) returns only the
 * enabled platforms' public ids for the request's shop. No token, no test event code, no sealed value.
 */

describe("public ad platforms route", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    expect.hasAssertions();
    app = (await buildAdPlatformsApp()).app;
  });
  afterEach(async () => {
    await app.close();
  });

  const save = (token: string, platform: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "PUT",
      url: `${API}/ad-platforms/${platform}`,
      headers: authed(token),
      payload,
    });
  const publicGet = (headers: Record<string, string>): Promise<LightMyRequestResponse> =>
    app.inject({ method: "GET", url: `${API}/public/ad-platforms`, headers });

  it("answers an anonymous caller the shop's enabled public ids, uncached", async () => {
    await save("a-admin", "meta", {
      enabled: true,
      publicConfig: { pixelId: META_ID },
      secret: FAKE_SECRET,
      testEventCode: "TEST12345",
      expectedVersion: 0,
    });
    await save("a-admin", "tiktok", {
      enabled: true,
      publicConfig: { pixelCode: TIKTOK_CODE },
      secret: FAKE_SECRET_B,
      expectedVersion: 0,
    });
    await save("a-admin", "snap", {
      enabled: false,
      publicConfig: { pixelId: SNAP_ID },
      expectedVersion: 0,
    });
    await save("a-admin", "ga4", {
      enabled: true,
      publicConfig: { measurementId: GA4_ID },
      expectedVersion: 0,
    });
    await save("a-admin", "google_ads", {
      enabled: true,
      publicConfig: { conversionId: "AW-123456789", labels: { lead: "LeadLabel_1" } },
      expectedVersion: 0,
    });
    const res = await publicGet({ "x-tenant-id": SHOP_A });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.json()).toEqual({
      meta: { pixelId: META_ID },
      tiktok: { pixelCode: TIKTOK_CODE },
      snap: null,
      ga4: { measurementId: GA4_ID },
      googleAds: { conversionId: "AW-123456789", labels: { lead: "LeadLabel_1" } },
    });
    for (const hidden of [FAKE_SECRET, FAKE_SECRET_B, "TEST12345", "sealed|", "secret", "last4"]) {
      expect(res.body).not.toContain(hidden);
    }
  });

  it("is all null for a shop with no connections, and never shows another shop's ids", async () => {
    await save("a-admin", "meta", {
      enabled: true,
      publicConfig: { pixelId: META_ID },
      secret: FAKE_SECRET,
      expectedVersion: 0,
    });
    const other = await publicGet({ "x-tenant-id": SHOP_B });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual({
      meta: null,
      tiktok: null,
      snap: null,
      ga4: null,
      googleAds: null,
    });
  });

  it("a request that names no shop is refused, never defaulted", async () => {
    const res = await publicGet({});
    expect(res.statusCode).toBe(403);
  });
});
