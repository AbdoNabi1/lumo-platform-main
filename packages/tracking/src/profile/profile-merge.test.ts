import { beforeEach, describe, expect, it } from "vitest";

import {
  applyObservation,
  createProfile,
  mergeProfileClickIds,
  mergeProfiles,
  pruneClickIds,
} from "./profile-merge";
import { PROFILE_TTL_MS, type ProfileObservation, type TrackingProfile } from "./tracking-profile";

beforeEach(() => {
  expect.hasAssertions();
});

const T0 = "2026-11-01T10:00:00.000Z";
const T1 = "2026-11-10T10:00:00.000Z";
const T2 = "2026-11-20T10:00:00.000Z";
const NOW = "2026-11-27T10:00:00.000Z";

function profile(overrides: Partial<TrackingProfile> = {}): TrackingProfile {
  return {
    ...createProfile({ tenantId: "t-1", visitorId: "v-1", at: T0, now: T0 }),
    ...overrides,
  };
}

function observation(overrides: Partial<ProfileObservation> = {}): ProfileObservation {
  return {
    tenantId: "t-1",
    visitorId: "v-1",
    at: T1,
    hashes: {},
    clickIds: {},
    browser: {},
    leadIds: [],
    orderIds: [],
    ...overrides,
  };
}

describe("applyObservation", () => {
  it("stores hashes, ids and the last network data, and rolls expiry from the last sighting", () => {
    const updated = applyObservation(
      profile(),
      observation({
        hashes: { emailStd: "e-hash", phoneE164: "p-hash", phoneDigits: "pd-hash" },
        browser: { fbp: "fb.1.1.1", ttp: "ttp-1", gaClientId: "111.222" },
        ip: "203.0.113.7",
        userAgent: "UA/1",
        pageUrl: "https://shop.example/p/1",
      }),
      NOW,
    );

    expect(updated.hashes).toEqual({
      emailStd: "e-hash",
      phoneE164: "p-hash",
      phoneDigits: "pd-hash",
    });
    expect(updated.browser).toEqual({ fbp: "fb.1.1.1", ttp: "ttp-1", gaClientId: "111.222" });
    expect(updated.lastIp).toBe("203.0.113.7");
    expect(updated.lastUserAgent).toBe("UA/1");
    expect(updated.lastPageUrl).toBe("https://shop.example/p/1");
    expect(updated.lastSeenAt).toBe(T1);
    expect(Date.parse(updated.expiresAt)).toBe(Date.parse(T1) + PROFILE_TTL_MS);
    expect(updated.updatedAt).toBe(NOW);
    expect(updated.createdAt).toBe(T0);
  });

  it("an event that carries nothing new never erases what the profile already holds", () => {
    const stored = applyObservation(
      profile(),
      observation({
        hashes: { emailStd: "e-hash" },
        clickIds: { ttclid: { value: "tt-1", capturedAt: T0 } },
        browser: { fbp: "fb.1.1.1" },
        ip: "203.0.113.7",
      }),
      NOW,
    );
    const next = applyObservation(stored, observation({ at: T2 }), NOW);

    expect(next.hashes).toEqual({ emailStd: "e-hash" });
    expect(next.clickIds).toEqual({ ttclid: { value: "tt-1", capturedAt: T0 } });
    expect(next.browser.fbp).toBe("fb.1.1.1");
    expect(next.lastIp).toBe("203.0.113.7");
    expect(next.lastSeenAt).toBe(T2);
  });

  it("keeps the newest click id per platform; a TikTok ttclid overrides the older one untruncated", () => {
    const longTtclid = `E.C.P.${"x".repeat(900)}`;
    const first = applyObservation(
      profile(),
      observation({ clickIds: { ttclid: { value: "old-click", capturedAt: T0 } } }),
      NOW,
    );
    const second = applyObservation(
      first,
      observation({ at: T2, clickIds: { ttclid: { value: longTtclid, capturedAt: T2 } } }),
      NOW,
    );

    expect(second.clickIds.ttclid).toEqual({ value: longTtclid, capturedAt: T2 });
    expect(second.clickIds.ttclid?.value).toHaveLength(longTtclid.length);
  });

  it("a redelivered older event cannot push a newer click id or newer values out", () => {
    const current = applyObservation(
      profile({ lastSeenAt: T2 }),
      observation({
        at: T2,
        hashes: { emailStd: "new-email" },
        clickIds: { gclid: { value: "G-new", capturedAt: T2 } },
        ip: "198.51.100.9",
      }),
      NOW,
    );
    const replay = applyObservation(
      current,
      observation({
        at: T1,
        hashes: { emailStd: "old-email", phoneE164: "p-hash" },
        clickIds: { gclid: { value: "G-old", capturedAt: T1 } },
        ip: "203.0.113.7",
      }),
      NOW,
    );

    expect(replay.clickIds.gclid?.value).toBe("G-new");
    expect(replay.hashes.emailStd).toBe("new-email");
    expect(replay.hashes.phoneE164).toBe("p-hash"); // a stale event may still FILL a gap
    expect(replay.lastIp).toBe("198.51.100.9");
    expect(replay.lastSeenAt).toBe(T2);
  });

  it("drops click ids past their platform window (Snap 28 days, Meta/Google/TikTok 90)", () => {
    const at = "2026-11-27T10:00:00.000Z";
    const pruned = pruneClickIds(
      {
        scclid: { value: "sc-old", capturedAt: "2026-10-20T10:00:00.000Z" }, // 38 d > 28
        gclid: { value: "g-ok", capturedAt: "2026-10-20T10:00:00.000Z" }, // 38 d < 90
        fbclid: { value: "fb-old", capturedAt: "2026-07-01T10:00:00.000Z" }, // 149 d > 90
        ttclid: { value: "tt-ok", capturedAt: "2026-11-26T10:00:00.000Z" },
      },
      at,
    );
    expect(Object.keys(pruned).sort()).toEqual(["gclid", "ttclid"]);
  });

  it("unions lead and order ids, sorted, without duplicates", () => {
    const first = applyObservation(
      profile(),
      observation({ leadIds: ["b", "a"], orderIds: ["o-2"] }),
      NOW,
    );
    const second = applyObservation(
      first,
      observation({ leadIds: ["a", "c"], orderIds: ["o-1"] }),
      NOW,
    );
    expect(second.leadIds).toEqual(["a", "b", "c"]);
    expect(second.orderIds).toEqual(["o-1", "o-2"]);
  });

  it("only a landing that carries a campaign signal replaces the landing touch", () => {
    const landed = applyObservation(
      profile(),
      observation({ landing: { utmSource: "meta", utmCampaign: "spring", at: T1 } }),
      NOW,
    );
    const plainPageView = applyObservation(landed, observation({ at: T2 }), NOW);
    expect(plainPageView.landing).toEqual({ utmSource: "meta", utmCampaign: "spring", at: T1 });

    const newCampaign = applyObservation(
      plainPageView,
      observation({ at: T2, landing: { utmSource: "tiktok", at: T2 } }),
      NOW,
    );
    expect(newCampaign.landing?.utmSource).toBe("tiktok");
  });

  it("adopts the customer id the event names; an existing one is never replaced", () => {
    const adopted = applyObservation(profile(), observation({ customerId: "c-1" }), NOW);
    expect(adopted.customerId).toBe("c-1");
    const kept = applyObservation(adopted, observation({ customerId: "c-2" }), NOW);
    expect(kept.customerId).toBe("c-1");
  });
});

describe("mergeProfiles", () => {
  const a = profile({
    visitorId: "v-a",
    createdAt: T0,
    lastSeenAt: T1,
    hashes: { emailStd: "email-a", phoneE164: "phone-a" },
    clickIds: {
      fbclid: { value: "fb-a", capturedAt: T1 },
      ttclid: { value: "tt-a", capturedAt: T0 },
    },
    browser: { fbp: "fbp-a", ttp: "ttp-a" },
    lastIp: "203.0.113.1",
    leadIds: ["l-1"],
    version: 3,
  });
  const b = profile({
    visitorId: "v-b",
    createdAt: T1,
    lastSeenAt: T2,
    hashes: { emailStd: "email-b" },
    clickIds: {
      ttclid: { value: "tt-b", capturedAt: T2 },
      gclid: { value: "g-b", capturedAt: T2 },
    },
    browser: { fbp: "fbp-b" },
    lastIp: "203.0.113.2",
    orderIds: ["o-1"],
    version: 7,
  });

  it("is deterministic: merging in either order gives the same profile", () => {
    expect(mergeProfiles(a, b)).toEqual(mergeProfiles(b, a));
  });

  it("the oldest profile survives with its cookie id and version; the newest value wins per field", () => {
    const merged = mergeProfiles(a, b);
    expect(merged.visitorId).toBe("v-a");
    expect(merged.version).toBe(3);
    expect(merged.createdAt).toBe(T0);
    expect(merged.hashes).toEqual({ emailStd: "email-b", phoneE164: "phone-a" });
    expect(merged.browser).toEqual({ fbp: "fbp-b", ttp: "ttp-a" });
    expect(merged.lastIp).toBe("203.0.113.2");
    expect(merged.lastSeenAt).toBe(T2);
    expect(merged.leadIds).toEqual(["l-1"]);
    expect(merged.orderIds).toEqual(["o-1"]);
  });

  it("the newest click id wins per platform and platforms accumulate", () => {
    const merged = mergeProfiles(a, b);
    expect(merged.clickIds.ttclid?.value).toBe("tt-b");
    expect(merged.clickIds.fbclid?.value).toBe("fb-a");
    expect(merged.clickIds.gclid?.value).toBe("g-b");
  });

  it("an exact tie on time is broken by the value, never by argument order", () => {
    const tie1 = mergeProfileClickIds(
      { gclid: { value: "AAA", capturedAt: T1 } },
      { gclid: { value: "ZZZ", capturedAt: T1 } },
    );
    const tie2 = mergeProfileClickIds(
      { gclid: { value: "ZZZ", capturedAt: T1 } },
      { gclid: { value: "AAA", capturedAt: T1 } },
    );
    expect(tie1).toEqual(tie2);
    expect(tie1.gclid?.value).toBe("ZZZ");
  });

  it("refuses to mix tenants", () => {
    expect(() => mergeProfiles(a, { ...b, tenantId: "t-2" })).toThrow(/different tenants/u);
  });

  it("refuses to join two different customers, and joins an anonymous profile into a customer's", () => {
    expect(() => mergeProfiles({ ...a, customerId: "c-1" }, { ...b, customerId: "c-2" })).toThrow(
      /different customers/u,
    );
    expect(mergeProfiles({ ...a, customerId: "c-1" }, b).customerId).toBe("c-1");
  });
});
