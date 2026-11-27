import { beforeEach, describe, expect, it } from "vitest";

import { COOKIE_KEEPER_NAMES, restorableCookies } from "./cookie-keeper";
import { createProfile } from "./profile-merge";
import type { TrackingProfile } from "./tracking-profile";

beforeEach(() => {
  expect.hasAssertions();
});

const DAY = 24 * 60 * 60;
const NOW = new Date("2026-11-27T10:00:00.000Z");
const NOW_MS = NOW.getTime();
const FBC_MS = Date.parse("2026-11-20T10:00:00.000Z");

function profile(patch: Partial<TrackingProfile> = {}): TrackingProfile {
  const base = createProfile({
    tenantId: "t-1",
    visitorId: "v-1",
    at: "2026-11-20T10:00:00.000Z",
    now: "2026-11-20T10:00:00.000Z",
  });
  return { ...base, ...patch };
}

const full = (): TrackingProfile =>
  profile({
    browser: {
      fbp: "fb.1.1763000000000.1234567890",
      fbc: `fb.1.${String(FBC_MS)}.IwAR-abc_DEF`,
      fbcCapturedAt: new Date(FBC_MS).toISOString(),
      ttp: "ttp-value-1",
      scid: "scid-value-1",
      gaClientId: "1111111111.1763000000",
    },
    clickIds: {
      ttclid: { value: "E.C.P.tt-click", capturedAt: "2026-11-20T10:00:00.000Z" },
      scclid: { value: "sc-click-1", capturedAt: "2026-11-20T10:00:00.000Z" },
      gclid: { value: "Cj0KCQ-gclid_1", capturedAt: "2026-11-20T10:00:00.000Z" },
      li_fat_id: { value: "li-uuid-1", capturedAt: "2026-11-20T10:00:00.000Z" },
      epik: { value: "dj0yJnU9epik", capturedAt: "2026-11-20T10:00:00.000Z" },
    },
  });

const byName = (cookies: ReturnType<typeof restorableCookies>) =>
  Object.fromEntries(cookies.map((c) => [c.name, c]));

describe("restorableCookies", () => {
  it("restores every cookie the browser lost, with the documented lifetimes", () => {
    const cookies = byName(
      restorableCookies({ tenantId: "t-1", profile: full(), present: new Set(), now: NOW }),
    );

    expect(Object.keys(cookies).sort()).toEqual([...COOKIE_KEEPER_NAMES].sort());
    expect(cookies["_fbp"]).toEqual({
      name: "_fbp",
      value: "fb.1.1763000000000.1234567890",
      maxAgeSeconds: 90 * DAY,
    });
    expect(cookies["_ttp"]?.maxAgeSeconds).toBe(395 * DAY);
    expect(cookies["_ga"]).toEqual({
      name: "_ga",
      value: "GA1.1.1111111111.1763000000",
      maxAgeSeconds: 395 * DAY,
    });
    expect(cookies["_scid"]?.maxAgeSeconds).toBe(400 * DAY);
    expect(cookies["ttclid"]?.maxAgeSeconds).toBe(30 * DAY);
    // Captured 7 days earlier: the 90-day cookie may only live for the 83 days the click window has left.
    expect(cookies["li_fat_id"]?.maxAgeSeconds).toBe(83 * DAY);
    expect(cookies["_epik"]?.maxAgeSeconds).toBe(83 * DAY);
    expect(cookies["_gcl_aw"]?.value).toBe(
      `GCL.${String(Math.floor(Date.parse("2026-11-20T10:00:00.000Z") / 1000))}.Cj0KCQ-gclid_1`,
    );
  });

  it("clamps a lifetime to the platform's own attribution window", () => {
    const cookies = byName(
      restorableCookies({ tenantId: "t-1", profile: full(), present: new Set(), now: NOW }),
    );
    // Snap's click window is 28 days: 7 days have passed, 21 remain (< the 90-day cookie lifetime).
    expect(cookies["_scclid"]?.maxAgeSeconds).toBe(21 * DAY);
    // Meta's window is 90 days from the click time stamped in the value: 83 days remain.
    expect(cookies["_fbc"]?.maxAgeSeconds).toBe(
      Math.floor((FBC_MS + 90 * DAY * 1000 - NOW_MS) / 1000),
    );
  });

  it("never touches a cookie the request still carries", () => {
    const cookies = restorableCookies({
      tenantId: "t-1",
      profile: full(),
      present: new Set(["_fbp", "_ga", "ttclid"]),
      now: NOW,
    });
    const names = cookies.map((c) => c.name);

    expect(names).not.toContain("_fbp");
    expect(names).not.toContain("_ga");
    expect(names).not.toContain("ttclid");
    expect(names).toContain("_ttp");
  });

  it("restores nothing when the browser has everything", () => {
    expect(
      restorableCookies({
        tenantId: "t-1",
        profile: full(),
        present: new Set(COOKIE_KEEPER_NAMES),
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("does not invent a cookie the profile never saw", () => {
    const sparse = profile({ browser: { fbp: "fb.1.1763000000000.99" } });
    expect(
      restorableCookies({ tenantId: "t-1", profile: sparse, present: new Set(), now: NOW }).map(
        (c) => c.name,
      ),
    ).toEqual(["_fbp"]);
  });

  it("drops an _fbc and click ids past their windows", () => {
    const old = profile({
      browser: {
        fbc: "fb.1.1740000000000.OldClick",
        fbcCapturedAt: "2025-02-19T20:00:00.000Z",
      },
      clickIds: {
        ttclid: { value: "old-tt", capturedAt: "2026-05-01T00:00:00.000Z" },
        gclid: { value: "old-g", capturedAt: "2026-05-01T00:00:00.000Z" },
      },
    });
    expect(
      restorableCookies({ tenantId: "t-1", profile: old, present: new Set(), now: NOW }),
    ).toEqual([]);
  });

  it("restores nothing for another tenant's profile or an expired one", () => {
    expect(
      restorableCookies({ tenantId: "t-2", profile: full(), present: new Set(), now: NOW }),
    ).toEqual([]);
    expect(
      restorableCookies({
        tenantId: "t-1",
        profile: { ...full(), expiresAt: "2026-11-01T00:00:00.000Z" },
        present: new Set(),
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("refuses values that could break out of a Set-Cookie header", () => {
    const hostile = profile({
      browser: {
        fbp: "fb.1.1; Domain=evil.example",
        ttp: "a b",
        scid: "x\r\nSet-Cookie: y=z",
        gaClientId: "1.2; Path=/",
      },
      clickIds: { ttclid: { value: "a".repeat(1001), capturedAt: "2026-11-20T10:00:00.000Z" } },
    });
    expect(
      restorableCookies({ tenantId: "t-1", profile: hostile, present: new Set(), now: NOW }),
    ).toEqual([]);
  });

  it("keeps a 1000-character ttclid whole", () => {
    const long = "T".repeat(1000);
    const p = profile({
      clickIds: { ttclid: { value: long, capturedAt: "2026-11-20T10:00:00.000Z" } },
    });
    expect(
      restorableCookies({ tenantId: "t-1", profile: p, present: new Set(), now: NOW })[0]?.value,
    ).toBe(long);
  });
});
