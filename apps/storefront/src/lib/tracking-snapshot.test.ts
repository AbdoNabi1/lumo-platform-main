// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeClickJar } from "./edge-capture";

let jar = new Map<string, string>();
let requestHeaders = new Map<string, string>();
let failHeaders = false;
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = jar.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
  headers: () => {
    if (failHeaders) return Promise.reject(new Error("headers() outside a request"));
    return Promise.resolve({ get: (name: string) => requestHeaders.get(name) ?? null });
  },
}));

const { readTrackingSnapshot, trackingSnapshotFrom } = await import("./tracking-snapshot");

const NOW = Date.parse("2026-12-01T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const VISITOR = "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b";

const cookieSource = (entries: Record<string, string>) => ({
  get: (name: string) => (name in entries ? { value: entries[name] as string } : undefined),
});
const headerSource = (entries: Record<string, string>) => ({
  get: (name: string) => entries[name] ?? null,
});

beforeEach(() => {
  expect.hasAssertions();
  jar = new Map();
  requestHeaders = new Map();
  failHeaders = false;
  vi.unstubAllEnvs();
});

describe("trackingSnapshotFrom", () => {
  it("reads the visitor, session, vendor cookies, click jar, trusted address, agent and page", () => {
    const clk = writeClickJar({
      gclid: { v: "Cj0KCQ-abc", t: NOW - 2 * DAY },
      ttclid: { v: "tt-click", t: NOW - 1 * DAY },
    });
    const snapshot = trackingSnapshotFrom(
      cookieSource({
        _mb_id: VISITOR,
        morbeh_sid: "sid-1",
        _mb_clk: clk,
        _fbp: "fb.1.1.2",
        _fbc: "fb.1.1700000000000.abc",
        _ttp: "ttp-1",
        _scid: "scid-1",
        _ga: "GA1.1.123.456",
      }),
      headerSource({
        "x-forwarded-for": "198.51.100.1, 203.0.113.9",
        "user-agent": "Mozilla/5.0 (Android)",
        referer: "https://shop.example/checkout?utm_source=facebook&utm_campaign=eid",
      }),
      NOW,
    );
    expect(snapshot).toEqual({
      visitorId: VISITOR,
      sessionId: "sid-1",
      // default trusted-proxy count 1: the LAST entry, never the spoofable left-most one
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0 (Android)",
      pageUrl: "https://shop.example/checkout?utm_source=facebook&utm_campaign=eid",
      cookies: {
        fbp: "fb.1.1.2",
        fbc: "fb.1.1700000000000.abc",
        ttp: "ttp-1",
        scid: "scid-1",
        ga: "GA1.1.123.456",
      },
      clickIds: expect.arrayContaining([
        { name: "gclid", value: "Cj0KCQ-abc", capturedAt: new Date(NOW - 2 * DAY).toISOString() },
        { name: "ttclid", value: "tt-click", capturedAt: new Date(NOW - 1 * DAY).toISOString() },
      ]) as unknown[],
      utm: { source: "facebook", campaign: "eid" },
    });
    expect(snapshot?.clickIds).toHaveLength(2);
  });

  it("returns undefined when the request carried nothing", () => {
    expect(trackingSnapshotFrom(cookieSource({}), headerSource({}), NOW)).toBeUndefined();
  });

  it("leaves out a malformed visitor id, session id and over-long cookie values (never truncates)", () => {
    const snapshot = trackingSnapshotFrom(
      cookieSource({
        _mb_id: "short",
        morbeh_sid: "bad session!",
        _fbp: "f".repeat(513),
        _ga: "GA1.1.1.2",
        _ttp: "",
      }),
      headerSource({}),
      NOW,
    );
    expect(snapshot).toEqual({ cookies: { ga: "GA1.1.1.2" } });
  });

  it("drops click ids past their platform window, in the future, malformed or hand-edited", () => {
    const clk = JSON.stringify({
      gclid: { v: "fresh", t: NOW - 1 * DAY },
      scclid: { v: "stale", t: NOW - 30 * DAY },
      fbclid: { v: "future", t: NOW + DAY },
      wbraid: { v: "bad value!", t: NOW - DAY },
      mystery: { v: "abc", t: NOW - DAY },
    });
    const snapshot = trackingSnapshotFrom(cookieSource({ _mb_clk: clk }), headerSource({}), NOW);
    expect(snapshot?.clickIds?.map((click) => click.name)).toEqual(["gclid"]);
    expect(
      trackingSnapshotFrom(cookieSource({ _mb_clk: "not json" }), headerSource({}), NOW),
    ).toBeUndefined();
  });

  it("ignores a spoofed left-most X-Forwarded-For, honours STOREFRONT_TRUSTED_PROXIES=0 (no address)", () => {
    const only = trackingSnapshotFrom(
      cookieSource({}),
      headerSource({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }),
      NOW,
    );
    expect(only?.ip).toBe("203.0.113.9");
    vi.stubEnv("STOREFRONT_TRUSTED_PROXIES", "0");
    expect(
      trackingSnapshotFrom(
        cookieSource({}),
        headerSource({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }),
        NOW,
      ),
    ).toBeUndefined();
  });

  it("leaves out an agent or page URL past the route's caps, and a non-http referer", () => {
    const snapshot = trackingSnapshotFrom(
      cookieSource({ _mb_id: VISITOR }),
      headerSource({
        "user-agent": "u".repeat(513),
        referer: `https://shop.example/${"r".repeat(2100)}`,
      }),
      NOW,
    );
    expect(snapshot).toEqual({ visitorId: VISITOR });
    expect(
      trackingSnapshotFrom(
        cookieSource({ _mb_id: VISITOR }),
        headerSource({ referer: "android-app://com.example" }),
        NOW,
      ),
    ).toEqual({ visitorId: VISITOR });
  });

  it("cleans and caps UTM labels", () => {
    const snapshot = trackingSnapshotFrom(
      cookieSource({}),
      headerSource({
        referer: `https://shop.example/?utm_source=${"s".repeat(300)}&utm_medium=%01%02&utm_term=a%20b`,
      }),
      NOW,
    );
    expect(snapshot?.utm?.source).toHaveLength(200);
    expect(snapshot?.utm).not.toHaveProperty("medium");
    expect(snapshot?.utm?.term).toBe("a b");
  });

  it("the body it builds is only ever the keys the route's strict schema allows", () => {
    const snapshot = trackingSnapshotFrom(
      cookieSource({
        _mb_id: VISITOR,
        morbeh_sid: "sid-1",
        _mb_clk: writeClickJar({ gclid: { v: "abc", t: NOW - DAY } }),
        _fbp: "x",
      }),
      headerSource({
        "x-forwarded-for": "203.0.113.9",
        "user-agent": "UA",
        referer: "https://shop.example/",
      }),
      NOW,
    );
    const allowed = new Set([
      "visitorId",
      "sessionId",
      "ip",
      "userAgent",
      "pageUrl",
      "referrer",
      "cookies",
      "clickIds",
      "utm",
    ]);
    for (const key of Object.keys(snapshot ?? {})) expect(allowed.has(key)).toBe(true);
  });
});

describe("readTrackingSnapshot (the cookie jar and headers of the current request)", () => {
  it("reads from next/headers", async () => {
    jar.set("_mb_id", VISITOR);
    requestHeaders.set("x-forwarded-for", "203.0.113.9");
    expect(await readTrackingSnapshot(NOW)).toEqual({ visitorId: VISITOR, ip: "203.0.113.9" });
  });

  it("never throws: a failed read is undefined", async () => {
    jar.set("_mb_id", VISITOR);
    failHeaders = true;
    expect(await readTrackingSnapshot(NOW)).toBeUndefined();
  });
});
